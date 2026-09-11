const { requireUser } = require("../../lib/crm-auth");
const { createSmtpClient } = require("../../lib/crm-mail");

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function headerText(value, max) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const to = String(req.body?.to || "").trim().toLowerCase();
  const subject = headerText(req.body?.subject, 250);
  const text = String(req.body?.text || "").trim().slice(0, 10000);
  const inReplyTo = headerText(req.body?.inReplyTo, 500);
  if (!validEmail(to) || !subject || !text) return res.status(400).json({ error: "Mottaker, emne eller melding er ugyldig." });
  try {
    const info = await createSmtpClient().sendMail({
      from: `Loki Lydstudio <${process.env.MAIL_ADDRESS}>`,
      replyTo: process.env.MAIL_ADDRESS,
      to,
      subject: subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`,
      text,
      inReplyTo: inReplyTo || undefined,
      references: inReplyTo || undefined,
      headers: { "X-Loki-CRM-User": user.email },
    });
    return res.status(200).json({ ok: true, messageId: info.messageId });
  } catch (error) {
    console.error("Email send failed", error?.message);
    return res.status(503).json({ error: "E-posten kunne ikke sendes." });
  }
};
