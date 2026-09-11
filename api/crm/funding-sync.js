const crypto = require("crypto");
const { currentUser } = require("../../lib/crm-auth");
const { SOURCES, inspectSource } = require("../../lib/crm-funding");
const { isConfigured, writeCollection } = require("../../lib/crm-store");

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function cronAuthorized(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return safeEqual(token, process.env.CRON_SECRET);
}

module.exports = async function handler(req, res) {
  if (!currentUser(req) && !cronAuthorized(req)) return res.status(401).json({ error: "Innlogging kreves." });
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert ennå." });
  try {
    const sources = await Promise.all(SOURCES.map(inspectSource));
    await writeCollection("funding-monitor", sources);
    return res.status(200).json({ ok: true, checked: sources.length, available: sources.filter((source) => source.ok).length });
  } catch (error) {
    console.error("Funding monitor sync failed", error?.message);
    return res.status(503).json({ error: "Støttekildene kunne ikke oppdateres." });
  }
};
