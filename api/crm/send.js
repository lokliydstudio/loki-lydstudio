const { requireUser } = require("../../lib/crm-auth");
const { sendMail } = require("../../lib/crm-mail");
const { sanitizeActivity } = require("../../lib/crm-operations");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");

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
    const info = await sendMail({
      from: `Loki Lydstudio <${process.env.MAIL_ADDRESS}>`,
      replyTo: process.env.MAIL_ADDRESS,
      to,
      subject: subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`,
      text,
      inReplyTo: inReplyTo || undefined,
      references: inReplyTo || undefined,
      headers: { "X-Loki-CRM-User": user.email },
    });
    if (isConfigured()) {
      try {
        const leads = await readCollection("leads");
        const lead = leads.find((item) => String(item.email || "").toLowerCase() === to);
        if (lead) {
          if (lead.stage === "Nytt lead") {
            lead.stage = "Kontaktet";
            lead.nextAction = "Følg opp svar fra kunden";
            lead.followUpDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
            lead.lastSeenAt = new Date().toISOString();
            await writeCollection("leads", leads);
          }
          const activities = await readCollection("activities");
          const activity = sanitizeActivity({ leadId: lead.id, type: "E-post", details: `Svar sendt: ${subject}` }, {}, user.email);
          if (activity) {
            activities.unshift(activity);
            await writeCollection("activities", activities.slice(0, 3000));
          }
        }
      } catch (activityError) {
        console.error("Sent email activity log failed", activityError?.message);
      }
    }
    return res.status(200).json({ ok: true, messageId: info.messageId });
  } catch (error) {
    console.error("Email send failed", error?.message);
    return res.status(503).json({ error: "E-posten kunne ikke sendes." });
  }
};
