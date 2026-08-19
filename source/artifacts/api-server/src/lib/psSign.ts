import forge from "node-forge";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// Microsoft Authenticode OIDs for PowerShell scripts
const OID_SPC_INDIRECT_DATA   = "1.3.6.1.4.1.311.2.1.4";
const OID_SPC_SIPINFO         = "1.3.6.1.4.1.311.2.1.30";  // used for scripts (not PE)
const OID_SPC_SP_OPUS_INFO    = "1.3.6.1.4.1.311.2.1.12";
const OID_SPC_STATEMENT_TYPE  = "1.3.6.1.4.1.311.2.1.11";
const OID_INDIVIDUAL_SIGN     = "1.3.6.1.4.1.311.2.1.21";
const OID_SHA256              = "2.16.840.1.101.3.4.2.1";
const OID_RSA                 = "1.2.840.113549.1.1.1";
const OID_PKCS7_SIGNED        = "1.2.840.113549.1.7.2";
const OID_CONTENT_TYPE        = "1.2.840.113549.1.9.3";
const OID_MESSAGE_DIGEST      = "1.2.840.113549.1.9.4";

// PowerShell Script SIP GUID (little-endian mixed, as stored in WINCRYPT)
// {603BCC1F-4B59-4E08-B724-D2C6297EF351}
const PS_SIP_GUID = Buffer.from("1FCC3B60594B084EB724D2C6297EF351", "hex");

let pfxCache: { key: forge.pki.rsa.PrivateKey; cert: forge.pki.Certificate } | null = null;

async function loadPfx() {
  if (pfxCache) return pfxCache;
  const pfxPath = process.env.CODESIGN_PFX ?? "/etc/wnraudit/codesign.pfx";
  const pfxPass = process.env.CODESIGN_PASSWORD ?? "WNRAuditSign2026!";
  const pfxBuf  = await readFile(pfxPath);
  const pfxAsn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuf));
  const pfx     = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, false, pfxPass);

  const keyBags  = pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const certBags = pfx.getBags({ bagType: forge.pki.oids.certBag });

  const bag    = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  const cBag   = certBags[forge.pki.oids.certBag]?.[0];
  if (!bag?.key || !cBag?.cert) throw new Error("Certificado de assinatura não encontrado no PFX");

  pfxCache = { key: bag.key as forge.pki.rsa.PrivateKey, cert: cBag.cert };
  return pfxCache;
}

function oid(s: string): forge.asn1.Asn1 {
  return forge.asn1.create(
    forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
    forge.asn1.oidToDer(s).getBytes(),
  );
}

function seq(...children: forge.asn1.Asn1[]): forge.asn1.Asn1 {
  return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, children);
}

function set_(...children: forge.asn1.Asn1[]): forge.asn1.Asn1 {
  return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, children);
}

function ctx(n: number, constructed: boolean, ...children: forge.asn1.Asn1[]): forge.asn1.Asn1 {
  return forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, n, constructed,
    constructed ? children : (children[0] as unknown as string));
}

function int_(hex: string): forge.asn1.Asn1 {
  return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false,
    forge.util.hexToBytes(hex));
}

function octet(buf: Buffer): forge.asn1.Asn1 {
  return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false,
    buf.toString("binary"));
}

function algSha256(): forge.asn1.Asn1 {
  return seq(oid(OID_SHA256), forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ""));
}

/** Build SpcIndirectDataContent DER for a PS1 file */
function buildSpcIndirectDataContent(contentHash: Buffer): forge.asn1.Asn1 {
  const sipInfo = seq(
    int_("010000"),                                            // dwSIPversion = 65536
    octet(PS_SIP_GUID),                                        // gSIPguid (PS1 GUID)
    int_("00"), int_("00"), int_("00"), int_("00"), int_("00"), // reserved ×5
  );

  return seq(
    seq(oid(OID_SPC_SIPINFO), sipInfo),                        // data
    seq(algSha256(), octet(contentHash)),                      // messageDigest
  );
}

/** DER-encode, then hash with SHA256 */
function sha256Der(node: forge.asn1.Asn1): Buffer {
  const der = forge.asn1.toDer(node).getBytes();
  return createHash("sha256").update(Buffer.from(der, "binary")).digest();
}

export async function signPowerShellScript(scriptContent: string): Promise<string> {
  const { key, cert } = await loadPfx();

  // 1. Hash the script content encoded as UTF-16LE with BOM
  const bom       = Buffer.from([0xff, 0xfe]);
  const u16le     = Buffer.from(scriptContent, "utf16le");
  const withBom   = Buffer.concat([bom, u16le]);
  const contentHash = createHash("sha256").update(withBom).digest();

  // 2. Build SpcIndirectDataContent and hash its DER for the messageDigest attribute
  const spcContent = buildSpcIndirectDataContent(contentHash);
  const spcHash    = sha256Der(spcContent);

  // 3. Build signed attributes (fixed values from analysis of real PS1 signatures)
  //    Order must match DER-SET canonical order (sorted by OID then by encoding)
  //    Observed order: opus_info, contentType, statement_type, messageDigest
  const opusInfoValue = Buffer.from("3008A00280 00A1028000".replace(/\s/g, ""), "hex");
  const statementTypeValue = Buffer.from("300C060A2B0601040182370201 15".replace(/\s/g, ""), "hex");

  const signedAttrsChildren: forge.asn1.Asn1[] = [
    // SPC_SP_OPUS_INFO — raw value as observed in existing signature
    seq(oid(OID_SPC_SP_OPUS_INFO),
      set_(forge.asn1.fromDer(opusInfoValue.toString("binary")))),
    // contentType = SPC_INDIRECT_DATA
    seq(oid(OID_CONTENT_TYPE),
      set_(oid(OID_SPC_INDIRECT_DATA))),
    // SPC_STATEMENT_TYPE = INDIVIDUAL_CODE_SIGNING
    seq(oid(OID_SPC_STATEMENT_TYPE),
      set_(forge.asn1.fromDer(statementTypeValue.toString("binary")))),
    // messageDigest = SHA256 of DER(SpcIndirectDataContent)
    seq(oid(OID_MESSAGE_DIGEST),
      set_(octet(spcHash))),
  ];

  // Tag as [0] IMPLICIT for inclusion in SignerInfo
  const signedAttrsImplicit = forge.asn1.create(
    forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, signedAttrsChildren,
  );

  // To compute the signature, re-tag as SET (0x31)
  const signedAttrsSet = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, signedAttrsChildren,
  );
  const signedAttrsDer = forge.asn1.toDer(signedAttrsSet).getBytes();

  // 4. RSA-SHA256 sign the DER-encoded signed attributes
  const md = forge.md.sha256.create();
  md.update(signedAttrsDer, "raw");
  const rawSig = (key as unknown as { sign(md: forge.md.MessageDigest): string }).sign(md);

  // 5. Build SignerInfo
  const issuerAsn1 = forge.pki.distinguishedNameToAsn1(cert.issuer);
  const serialHex  = cert.serialNumber.replace(/^0+/, "") || "00";
  const serialBytes = serialHex.length % 2 ? "0" + serialHex : serialHex;

  const signerInfo = seq(
    int_("01"),                                          // version
    seq(issuerAsn1, int_(serialBytes)),                  // issuerAndSerialNumber
    algSha256(),                                         // digestAlgorithm
    signedAttrsImplicit,                                 // authenticatedAttributes [0]
    seq(oid(OID_RSA),                                    // digestEncryptionAlgorithm
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, "")),
    forge.asn1.create(                                   // encryptedDigest
      forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, rawSig),
  );

  // 6. Build SignedData
  const certAsn1 = forge.pki.certificateToAsn1(cert);
  const certsCxt = forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [certAsn1]);

  const signedData = seq(
    int_("01"),                                          // version
    set_(algSha256()),                                   // digestAlgorithms
    seq(                                                 // contentInfo
      oid(OID_SPC_INDIRECT_DATA),
      ctx(0, true, spcContent),                          // [0] EXPLICIT content
    ),
    certsCxt,                                            // [0] certificates (IMPLICIT)
    set_(signerInfo),                                    // signerInfos
  );

  // 7. Wrap in ContentInfo
  const contentInfo = seq(
    oid(OID_PKCS7_SIGNED),
    ctx(0, true, signedData),
  );

  // 8. DER encode and format as PS1 signature block
  const derBytes  = forge.asn1.toDer(contentInfo).getBytes();
  const b64       = Buffer.from(derBytes, "binary").toString("base64");
  const sigLines  = (b64.match(/.{1,64}/g) ?? []).map(l => `# ${l}`);

  const crlf = "\r\n";
  return [
    scriptContent,
    "",
    "# SIG # Begin signature block",
    ...sigLines,
    "# SIG # End signature block",
  ].join(crlf);
}
