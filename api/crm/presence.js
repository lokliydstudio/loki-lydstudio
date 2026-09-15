const { requireUser } = require("../../lib/crm-auth");
const { activePresence, presenceCollection, presenceHeartbeat, presenceOwners } = require("../../lib/crm-presence");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");

async function readPresenceRecords() {
  const collections = presenceOwners().map((owner) => presenceCollection(owner.email));
  const records = await Promise.all(collections.map(async (collection) => {
    const items = await readCollection(collection);
    return items[0] || null;
  }));
  return records.filter(Boolean);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const user = requireUser(req, res);
  if (!user) return;
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert." });
  if (!["GET", "POST", "DELETE"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });

  const collection = presenceCollection(user.email);
  if (!collection) return res.status(403).json({ error: "Brukeren har ikke tilgang til tilstedeværelsesstatus." });

  try {
    if (req.method === "POST") {
      await writeCollection(collection, [presenceHeartbeat(user.email)]);
    } else if (req.method === "DELETE") {
      await writeCollection(collection, []);
    }
    const users = activePresence(await readPresenceRecords(), user.email);
    return res.status(200).json({ users, onlineWindowSeconds: 150 });
  } catch (error) {
    console.error("Presence API failed", error?.message);
    return res.status(503).json({ error: "Påloggingsstatus kunne ikke oppdateres." });
  }
};
