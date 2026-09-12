const { bridgeAuthorized } = require("../../lib/crm-bridge");
const { cleanText } = require("../../lib/crm-audio");
const { streamPrivateBlob } = require("../../lib/crm-audio-stream");
const { isConfigured, readCollection } = require("../../lib/crm-store");

module.exports = async function handler(req, res) {
  if (!bridgeAuthorized(req)) return res.status(401).json({ error: "Ugyldig brotilgang." });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isConfigured()) return res.status(503).json({ error: "Lydlagringen er ikke aktivert." });
  try {
    const tracks = await readCollection("audio");
    const track = tracks.find((item) => item.id === cleanText(req.query?.id, 80));
    if (!track) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
    return streamPrivateBlob(req, res, track.pathname, track.filename);
  } catch (error) {
    console.error("Jottacloud audio download failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke hente lydfilen." });
  }
};
