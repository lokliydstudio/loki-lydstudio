const { bridgeAuthorized } = require("../../lib/crm-bridge");
const { cleanText } = require("../../lib/crm-audio");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");

module.exports = async function handler(req, res) {
  if (!bridgeAuthorized(req)) return res.status(401).json({ error: "Ugyldig brotilgang." });
  if (!isConfigured()) return res.status(503).json({ error: "Lydlagringen er ikke aktivert." });

  try {
    const tracks = await readCollection("audio");
    if (req.method === "GET") {
      const projects = await readCollection("projects");
      const projectNames = new Map(projects.map((project) => [project.id, project.name]));
      return res.status(200).json({
        tracks: tracks
          .filter((track) => !track.jottaSyncedAt)
          .map((track) => ({
            id: track.id,
            projectName: projectNames.get(track.projectId) || "Uten prosjekt",
            filename: track.filename,
            size: track.size,
            uploadedAt: track.uploadedAt,
            downloadPath: `/api/crm/audio-download?id=${encodeURIComponent(track.id)}`,
          })),
      });
    }

    if (req.method === "POST") {
      const id = cleanText(req.body?.id, 80);
      const index = tracks.findIndex((track) => track.id === id);
      if (index < 0) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
      tracks[index] = { ...tracks[index], jottaStatus: "Speilet til Jottacloud", jottaSyncedAt: new Date().toISOString() };
      await writeCollection("audio", tracks);
      return res.status(200).json({ ok: true, id });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Jottacloud audio sync failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke synkronisere lydarkivet." });
  }
};
