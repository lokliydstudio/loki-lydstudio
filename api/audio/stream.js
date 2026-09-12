const { verifyScopedToken } = require("../../lib/crm-auth");
const { streamPrivateBlob } = require("../../lib/crm-audio-stream");
const { isConfigured, readCollection } = require("../../lib/crm-store");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isConfigured()) return res.status(503).json({ error: "Lydlagringen er ikke aktivert." });
  const grant = verifyScopedToken(req.query?.token, "audio-share");
  if (!grant) return res.status(401).json({ error: "Lenken er ugyldig eller utløpt." });
  try {
    const tracks = await readCollection("audio");
    const track = tracks.find((item) => item.id === grant.subject);
    if (!track) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
    return streamPrivateBlob(req, res, track.pathname, track.filename);
  } catch (error) {
    console.error("Shared audio stream failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke spille av lydfilen." });
  }
};
