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
    return sendSmtpMail(message);
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

async function sendSmtpMail(message) {
  const info = await createSmtpClient().sendMail(message);
  const accepted = Array.isArray(info.accepted) ? info.accepted : [];
  const rejected = Array.isArray(info.rejected) ? info.rejected : [];
  if (!accepted.length || rejected.length) {
    throw new Error("Domeneshop SMTP bekreftet ikke mottakeren.");
  }
  return { ...info, provider: "domeneshop-smtp" };
}

async function removeResendSuppression(email) {
  if (!process.env.RESEND_API_KEY) return { removed: false };
  const headers = { authorization: `Bearer ${process.env.RESEND_API_KEY}` };
  const endpoint = `https://api.resend.com/suppressions/${encodeURIComponent(email)}`;
  const existing = await fetch(endpoint, { headers });
  if (existing.status === 404) return { removed: false };
  const data = await existing.json().catch(() => ({}));
  if (!existing.ok) throw new Error(`Kunne ikke kontrollere Resend-sperring: ${data.message || existing.status}`);

  const removed = await fetch(endpoint, { method: "DELETE", headers });
  const removal = await removed.json().catch(() => ({}));
  if (!removed.ok) throw new Error(`Kunne ikke fjerne Resend-sperring: ${removal.message || removed.status}`);
  return { removed: true, origin: data.origin || "unknown" };
}

async function resendEmailStatus(id) {
  if (!process.env.RESEND_API_KEY || !id) return null;
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Kunne ikke lese Resend-status: ${data.message || response.status}`);
  return String(data.last_event || "").toLowerCase() || null;
}

async function sendOwnerLoginMail(message, email) {
  let suppression = { removed: false };
  if (process.env.RESEND_API_KEY) {
    try {
      suppression = await removeResendSuppression(email);
    } catch (error) {
      // A send-only API key may not have suppression access. Sending can still
      // succeed, so keep this diagnostic non-fatal.
      console.warn("Could not inspect CRM login suppression", error?.message);
    }
  }

  const result = await sendMail(message);
  if (result.provider !== "resend") return { ...result, suppression };

  let deliveryEvent = null;
  for (const delay of [250, 750, 1500]) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      deliveryEvent = await resendEmailStatus(result.messageId);
      if (deliveryEvent) break;
    } catch (error) {
      const pending = /email not found/i.test(String(error?.message || ""));
      if (!pending || delay === 1500) {
        console.warn("Could not inspect CRM login delivery", error?.message);
      }
      if (!pending) break;
    }
  }
  if (["suppressed", "bounced", "failed"].includes(deliveryEvent)) {
    throw new Error(`Resend-status for innloggingskoden er ${deliveryEvent}.`);
  }
  return { ...result, suppression, deliveryEvent };
}

module.exports = {
  createImapClient,
  createSmtpClient,
  mailConfig,
  removeResendSuppression,
  resendEmailStatus,
  sendMail,
  sendOwnerLoginMail,
  sendSmtpMail,
};
