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

module.exports = { createImapClient, createSmtpClient, mailConfig };
