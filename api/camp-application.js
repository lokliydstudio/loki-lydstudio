const { normalizeApplication, notificationText } = require("../lib/camp-application");
const { requireUser } = require("../lib/crm-auth");
const { sendMail } = require("../lib/crm-mail");
const { isConfigured, mutateCollection, readCollection } = require("../lib/crm-store");

const COLLECTION = "camp-applications";
const MAX_APPLICATIONS = 2000;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!isConfigured()) return res.status(503).json({ error: "The application form is temporarily unavailable." });

  if (req.method === "GET") {
    if (!requireUser(req, res)) return;
    try {
      const applications = await readCollection(COLLECTION);
      return res.status(200).json({ applications });
    } catch (error) {
      console.error("Camp application read failed", error?.message);
      return res.status(503).json({ error: "Could not load applications." });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: "Applications must be submitted from lokilyd.no." });
    } catch {
      return res.status(403).json({ error: "Invalid origin." });
    }
  }
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    return res.status(415).json({ error: "Please submit your application from the form." });
  }
  if (Number(req.headers["content-length"] || 0) > 12000) return res.status(413).json({ error: "The application is too long." });
  if (JSON.stringify(req.body || {}).length > 12000) return res.status(413).json({ error: "The application is too long." });
  // The hidden field is deliberately ignored by real applicants and catches basic form spam.
  if (req.body?.website) return res.status(200).json({ ok: true });
  const { application, error } = normalizeApplication(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const stored = await mutateCollection(COLLECTION, (items) => {
      const duplicate = items.find((item) => item.email === application.email
        && item.bio === application.bio
        && Date.now() - new Date(item.createdAt).getTime() < 10 * 60 * 1000);
      if (duplicate) return { items, result: { id: duplicate.id, duplicate: true } };
      if (items.length >= MAX_APPLICATIONS) return { error: "We cannot accept more applications right now. Please contact camps@lokilyd.no." };
      return { items: [application, ...items], result: { id: application.id, duplicate: false } };
    });
    if (stored.error) return res.status(503).json({ error: stored.error });
    if (stored.result.duplicate) return res.status(200).json({ ok: true, id: stored.result.id });
  } catch (storageError) {
    console.error("Camp application storage failed", storageError?.message);
    return res.status(503).json({ error: "Your application could not be saved. Please try again later." });
  }

  try {
    const address = process.env.MAIL_ADDRESS || "post@lokilyd.no";
    await sendMail({
      from: `Loki Lydstudio <${address}>`,
      replyTo: application.email,
      to: address,
      subject: `Ny søknad til Loki Songs camp – ${application.name}`,
      text: notificationText(application),
    });
  } catch (mailError) {
    // The application is safely stored and remains visible to authenticated owners.
    console.error("Camp application notification failed", application.id, mailError?.message);
  }
  return res.status(201).json({ ok: true, id: application.id });
};
