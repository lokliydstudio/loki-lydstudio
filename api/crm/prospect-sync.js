const crypto = require("crypto");
const { currentUser } = require("../../lib/crm-auth");
const { discoverProspects, mergeProspects } = require("../../lib/crm-prospects");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");

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
  const user = currentUser(req);
  if (!user && !cronAuthorized(req)) return res.status(401).json({ error: "Innlogging kreves." });
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert ennå." });
  const actor = user?.email || "vercel-cron";
  try {
    const discovery = await discoverProspects();
    if (!discovery.configured) return res.status(200).json({ ok: true, configured: false, added: 0, message: "AI Gateway/OIDC eller OPENAI_API_KEY mangler; ingen kandidater ble hentet." });
    const [current, runs] = await Promise.all([readCollection("cold-call-pool"), readCollection("cold-call-runs")]);
    const merged = mergeProspects(current, discovery.candidates, actor);
    const run = { id: `run-${Date.now()}`, checkedAt: new Date().toISOString(), added: merged.added, refreshed: merged.refreshed, candidates: discovery.candidates.length, status: "Ferdig", triggeredBy: actor };
    await Promise.all([
      writeCollection("cold-call-pool", merged.prospects.slice(0, 1000)),
      writeCollection("cold-call-runs", [run, ...runs].slice(0, 100)),
    ]);
    return res.status(200).json({ ok: true, configured: true, added: merged.added, refreshed: merged.refreshed });
  } catch (error) {
    console.error("Prospect monitor sync failed", error?.message);
    return res.status(503).json({ error: "Kandidatsøket kunne ikke oppdateres." });
  }
};
