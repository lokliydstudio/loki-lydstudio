const { requireUser } = require("../../lib/crm-auth");
const { SOURCES } = require("../../lib/crm-funding");
const { isConfigured, readCollection } = require("../../lib/crm-store");

module.exports = async function handler(req, res) {
  if (!requireUser(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isConfigured()) return res.status(200).json({ sources: SOURCES, lastCheckedAt: null });
  try {
    const sources = await readCollection("funding-monitor");
    const lastCheckedAt = sources.map((source) => source.checkedAt).filter(Boolean).sort().at(-1) || null;
    return res.status(200).json({ sources: sources.length ? sources : SOURCES, lastCheckedAt });
  } catch (error) {
    console.error("Funding monitor read failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke lese støtteradaren." });
  }
};
