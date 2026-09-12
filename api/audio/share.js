const { verifyScopedToken } = require("../../lib/crm-auth");
const { isConfigured, readCollection } = require("../../lib/crm-store");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isConfigured()) return res.status(503).json({ error: "Lydlagringen er ikke aktivert." });
  const grant = verifyScopedToken(req.query?.token, "audio-share");
  if (!grant) return res.status(401).json({ error: "Lenken er ugyldig eller utløpt." });

  try {
    const [tracks, projects] = await Promise.all([readCollection("audio"), readCollection("projects")]);
    const track = tracks.find((item) => item.id === grant.subject);
    if (!track) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
    const project = projects.find((item) => item.id === track.projectId);
    return res.status(200).json({
      track: {
        title: track.title,
        version: track.version,
        notes: track.notes,
        filename: track.filename,
        size: track.size,
        projectName: project?.name || "Loki Lydstudio",
      },
      expiresAt: new Date(grant.expires).toISOString(),
    });
  } catch (error) {
    console.error("Public audio share failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke åpne lydleveransen." });
  }
};
