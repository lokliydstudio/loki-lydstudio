const { ImapFlow } = require("imapflow");
const nodemailer = require("nodemailer");

function mailConfig() {
  const user = process.env.MAIL_USERNAME || process.env.MAIL_ADDRESS;
  const pass = process.env.MAIL_PASSWORD;
  if (!user || !pass || !process.env.MAIL_ADDRESS) throw new Error("E-postkontoen er ikke konfigurert.");
  return {
    user,
    pass,
    imapHost: process.env.MAIL_IMAP_HOST || "imap.domeneshop.no",
    imapPort: Number(process.env.MAIL_IMAP_PORT || 993),
    smtpHost: process.env.MAIL_SMTP_HOST || "smtp.domeneshop.no",
    smtpPort: Number(process.env.MAIL_SMTP_PORT || 587),
  };
}

function createImapClient() {
  const config = mailConfig();
  return new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    logger: false,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 25000,
    tls: { rejectUnauthorized: true },
  });
}

function createSmtpClient() {
  const config = mailConfig();
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    requireTLS: config.smtpPort !== 465,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 25000,
    tls: { rejectUnauthorized: true },
  });
}

async function sendMail(message) {
  if (!process.env.RESEND_API_KEY) {
    return createSmtpClient().sendMail(message);
  }

  const headers = { ...(message.headers || {}) };
  if (message.inReplyTo) headers["In-Reply-To"] = message.inReplyTo;
  if (message.references) headers.References = message.references;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: message.from,
      to: Array.isArray(message.to) ? message.to : [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      reply_to: message.replyTo,
      headers,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    const detail = String(data.message || data.name || `HTTP ${response.status}`).slice(0, 300);
    throw new Error(`Resend avviste e-posten: ${detail}`);
  }

  return { messageId: data.id, provider: "resend" };
}

module.exports = { createImapClient, createSmtpClient, mailConfig, sendMail };
