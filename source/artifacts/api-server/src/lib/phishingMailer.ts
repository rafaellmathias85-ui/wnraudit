import nodemailer from "nodemailer";
import { logger } from "./logger";

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP_HOST, SMTP_USER e SMTP_PASS devem estar definidos para envio de e-mails de phishing.",
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
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

export async function sendPhishingEmail(opts: PhishingMailOptions): Promise<void> {
  const transport = createTransport();
  const html = injectTracking(opts.htmlBody, opts.trackingToken, opts.trackingBaseUrl);

  await transport.sendMail({
    from: `"${opts.fromName}" <${opts.fromEmail}>`,
    to: `"${opts.toName}" <${opts.to}>`,
    subject: opts.subject,
    html,
  });

  logger.info({ to: opts.to, token: opts.trackingToken }, "Phishing email sent");
}
