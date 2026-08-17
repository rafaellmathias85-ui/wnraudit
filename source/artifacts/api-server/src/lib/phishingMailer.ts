import nodemailer from "nodemailer";
import { logger } from "./logger";

export type SmtpCredentials = {
  host: string;
  port: number;
  user: string;
  pass: string;
};

function buildTransport(creds: SmtpCredentials) {
  const dkimDomain = process.env.PHISHING_DKIM_DOMAIN;
  const dkimSelector = process.env.PHISHING_DKIM_SELECTOR;
  const dkimKey = process.env.PHISHING_DKIM_PRIVATE_KEY?.replace(/\\n/g, "\n");

  const dkim =
    dkimDomain && dkimSelector && dkimKey
      ? { domainName: dkimDomain, keySelector: dkimSelector, privateKey: dkimKey }
      : undefined;

  return nodemailer.createTransport({
    host: creds.host,
    port: creds.port,
    secure: creds.port === 465,
    auth: { user: creds.user, pass: creds.pass },
    ...(dkim ? { dkim } : {}),
  });
}

function getEnvCredentials(): SmtpCredentials {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "Nenhuma configuração SMTP encontrada. Cadastre um e-mail SMTP em Simulação de Phishing → SMTP.",
    );
  }
  return { host, port, user, pass };
}

export function createSmtpTransport(creds?: SmtpCredentials) {
  return buildTransport(creds ?? getEnvCredentials());
}

export async function verifySmtpCredentials(creds: SmtpCredentials): Promise<void> {
  const transport = buildTransport(creds);
  await transport.verify();
  transport.close();
}

type PhishingMailOptions = {
  to: string;
  toName: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  htmlBody: string;
  trackingToken: string;
  trackingBaseUrl: string;
};

function injectTracking(html: string, token: string, baseUrl: string): string {
  const pixelUrl = `${baseUrl}/api/phishing/track/${token}/open`;
  const clickUrl = `${baseUrl}/api/phishing/track/${token}/click`;
  const reportUrl = `${baseUrl}/api/phishing/track/${token}/report-email`;

  const pixelTag = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;
  const reportFooter = `<div style="text-align:center;padding:14px 30px;border-top:1px solid #eee;margin-top:20px"><p style="font-size:11px;color:#aaa;margin:0">Suspeita que este é um e-mail falso? <a href="${reportUrl}" style="color:#aaa;text-decoration:underline">Clique aqui para reportar ao TI</a></p></div>`;

  let processed = html;

  // Replace {{PHISHING_LINK}} placeholders
  processed = processed.replace(/\{\{PHISHING_LINK\}\}/g, clickUrl);

  // Replace explicit {{REPORT_LINK}} placeholders if present
  processed = processed.replace(/\{\{REPORT_LINK\}\}/g, reportUrl);

  // Inject report footer + tracking pixel — replace {{TRACKING_PIXEL}} marker or append
  if (processed.includes("{{TRACKING_PIXEL}}")) {
    processed = processed.replace(/\{\{TRACKING_PIXEL\}\}/g, `${reportFooter}${pixelTag}`);
  } else {
    processed += `${reportFooter}${pixelTag}`;
  }

  return processed;
}

export async function sendPhishingEmail(opts: PhishingMailOptions & { smtpCreds?: SmtpCredentials }): Promise<void> {
  const transport = createSmtpTransport(opts.smtpCreds);
  const html = injectTracking(opts.htmlBody, opts.trackingToken, opts.trackingBaseUrl);

  // Optional X-header carrying a shared secret. When configured on both the
  // mailer (PHISHING_SIM_HEADER_VALUE) and the tenant's Advanced Delivery Policy,
  // Microsoft 365 recognises the message as an authorised phishing simulation and
  // skips filtering/detonation — the definitive fix for quarantine + false events.
  const simHeaderValue = process.env.PHISHING_SIM_HEADER_VALUE;
  const headers: Record<string, string> = {
    // Discourage automatic replies / out-of-office to the simulated sender.
    "X-Auto-Response-Suppress": "All",
    "Auto-Submitted": "auto-generated",
  };
  if (simHeaderValue) {
    headers["X-PhishTest"] = simHeaderValue;
  }

  await transport.sendMail({
    from: `"${opts.fromName}" <${opts.fromEmail}>`,
    to: `"${opts.toName}" <${opts.to}>`,
    subject: opts.subject,
    html,
    headers,
  });

  logger.info({ to: opts.to, token: opts.trackingToken }, "Phishing email sent");
}
