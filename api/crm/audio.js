const { del, head } = require("@vercel/blob");
const { createScopedToken, requireUser } = require("../../lib/crm-auth");
const { cleanText, sanitizeTrack } = require("../../lib/crm-audio");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");

function publicBaseUrl(req) {
  const configured = String(process.env.CRM_BASE_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${req.headers["x-forwarded-proto"] || "https"}://${host}`;
}

module.exports = async function handler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  if (!isConfigured()) return res.status(503).json({ error: "Lydlagringen er ikke aktivert ennå." });

  try {
    const tracks = await readCollection("audio");

    if (req.method === "GET") {
      const projectId = cleanText(req.query?.projectId, 120);
      return res.status(200).json({ tracks: tracks.filter((track) => !projectId || track.projectId === projectId) });
    }

    if (req.method === "POST" && req.body?.action === "register") {
      const projects = await readCollection("projects");
      if (!projects.some((project) => project.id === req.body?.track?.projectId)) {
        return res.status(404).json({ error: "Prosjektet ble ikke funnet." });
      }
      if (tracks.some((track) => track.id === req.body?.track?.id)) {
        return res.status(409).json({ error: "Lydfilen er allerede registrert." });
      }
      const pathname = cleanText(req.body?.track?.pathname, 500);
      const actualBlob = await head(pathname, { access: "private" });
      const track = sanitizeTrack(req.body?.track, actualBlob, user.email);
      if (!track) return res.status(400).json({ error: "Lydfilen kunne ikke verifiseres." });
      tracks.unshift(track);
      await writeCollection("audio", tracks);
      return res.status(201).json({ track });
    }

    if (req.method === "POST" && req.body?.action === "share") {
      const track = tracks.find((item) => item.id === cleanText(req.body?.id, 80));
      if (!track) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
      const days = Math.max(1, Math.min(Number(req.body?.days) || 14, 90));
      const token = createScopedToken(track.id, "audio-share", days * 24 * 60 * 60);
      return res.status(200).json({ url: `${publicBaseUrl(req)}/lytt/?token=${encodeURIComponent(token)}`, expiresAt: new Date(Date.now() + days * 86400000).toISOString() });
    }

    if (req.method === "PATCH") {
      const index = tracks.findIndex((item) => item.id === cleanText(req.body?.id, 80));
      if (index < 0) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
      tracks[index] = {
        ...tracks[index],
        title: cleanText(req.body?.changes?.title ?? tracks[index].title, 160),
        version: cleanText(req.body?.changes?.version ?? tracks[index].version, 40),
        notes: cleanText(req.body?.changes?.notes ?? tracks[index].notes, 500),
      };
      await writeCollection("audio", tracks);
      return res.status(200).json({ track: tracks[index] });
    }

    if (req.method === "DELETE") {
      const id = cleanText(req.query?.id || req.body?.id, 80);
      const index = tracks.findIndex((item) => item.id === id);
      if (index < 0) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
      const [track] = tracks.splice(index, 1);
      await del(track.pathname);
      await writeCollection("audio", tracks);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("CRM audio storage failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke oppdatere lydleveransen." });
  }
};
