const { handleUpload } = require("@vercel/blob/client");
const { requireUser } = require("../../lib/crm-auth");
const { AUDIO_CONTENT_TYPES, MAX_AUDIO_SIZE, audioPathname } = require("../../lib/crm-audio");
const { isConfigured, readCollection } = require("../../lib/crm-store");

module.exports = async function handler(req, res) {
  if (!requireUser(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isConfigured()) return res.status(503).json({ error: "Lydlagringen er ikke aktivert ennå." });

  try {
    const result = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload;
        try {
          payload = JSON.parse(clientPayload || "{}");
        } catch {
          throw new Error("Ugyldig opplastingsdata.");
        }
        if (audioPathname(payload.trackId, payload.filename) !== pathname) throw new Error("Ugyldig filsti.");
        const projects = await readCollection("projects");
        if (!projects.some((project) => project.id === payload.projectId)) throw new Error("Prosjektet finnes ikke.");
        return {
          allowedContentTypes: AUDIO_CONTENT_TYPES,
          maximumSizeInBytes: MAX_AUDIO_SIZE,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
        };
      },
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("Audio upload token failed", error?.message);
    return res.status(400).json({ error: error?.message || "Kunne ikke starte lydopplastingen." });
  }
};
