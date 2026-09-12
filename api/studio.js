const { del, head } = require("@vercel/blob");
const { handleUpload } = require("@vercel/blob/client");
const { createScopedToken, requireUser, verifyScopedToken } = require("../lib/crm-auth");
const { AUDIO_CONTENT_TYPES, MAX_AUDIO_SIZE, audioPathname, cleanText, sanitizeTrack } = require("../lib/crm-audio");
const { streamPrivateBlob } = require("../lib/crm-audio-stream");
const { bridgeAuthorized } = require("../lib/crm-bridge");
const { loadFikenSummary } = require("../lib/crm-fiken");
const { createProjectExport, planProjectDeletion } = require("../lib/crm-project-export");
const { sanitizeProject } = require("../lib/crm-projects");
const { isConfigured, readCollection, writeCollection } = require("../lib/crm-store");
const { sanitizeNote, sanitizeTask } = require("../lib/crm-workspace");

function publicBaseUrl(req) {
  const configured = String(process.env.CRM_BASE_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${req.headers["x-forwarded-proto"] || "https"}://${host}`;
}

async function projectsHandler(req, res) {
  if (!requireUser(req, res)) return;
  if (req.method === "GET") return res.status(200).json({ projects: await readCollection("projects") });

  if (req.method === "POST") {
    const projects = await readCollection("projects");
    const project = sanitizeProject(req.body?.project || req.body || {});
    projects.unshift(project);
    await writeCollection("projects", projects);
    return res.status(201).json({ project });
  }

  if (req.method === "PATCH") {
    const projects = await readCollection("projects");
    const id = cleanText(req.body?.id, 120);
    const index = projects.findIndex((project) => project.id === id);
    if (index < 0) return res.status(404).json({ error: "Prosjektet ble ikke funnet." });
    projects[index] = sanitizeProject(req.body?.changes || {}, projects[index]);
    await writeCollection("projects", projects);
    return res.status(200).json({ project: projects[index] });
  }

  if (req.method === "DELETE") {
    const id = cleanText(req.query?.id || req.body?.id, 120);
    const [projects, tracks] = await Promise.all([
      readCollection("projects"),
      readCollection("audio"),
    ]);
    const deletion = planProjectDeletion(projects, tracks, id);
    if (!deletion) return res.status(404).json({ error: "Prosjektet ble ikke funnet." });

    const pathnames = deletion.attachedTracks.map((track) => track.pathname).filter(Boolean);
    if (pathnames.length) await del(pathnames);
    await writeCollection("audio", deletion.remainingTracks);
    await writeCollection("projects", deletion.remainingProjects);

    return res.status(200).json({
      ok: true,
      deletedProjectId: id,
      deletedTrackCount: deletion.attachedTracks.length,
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

async function projectExportHandler(req, res) {
  if (!requireUser(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const [projects, tracks] = await Promise.all([
    readCollection("projects"),
    readCollection("audio"),
  ]);
  const requestedId = cleanText(req.query?.id, 120);
  const manifest = createProjectExport(projects, tracks, requestedId);
  if (!manifest) return res.status(404).json({ error: "Prosjektet ble ikke funnet." });
  return res.status(200).json(manifest);
}

async function uploadHandler(req, res) {
  if (!requireUser(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const result = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload;
        try { payload = JSON.parse(clientPayload || "{}"); } catch { throw new Error("Ugyldig opplastingsdata."); }
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
}

async function audioHandler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const tracks = await readCollection("audio");

  if (req.method === "GET") {
    const projectId = cleanText(req.query?.projectId, 120);
    return res.status(200).json({ tracks: tracks.filter((track) => !projectId || track.projectId === projectId) });
  }

  if (req.method === "POST" && req.body?.operation === "register") {
    const projects = await readCollection("projects");
    if (!projects.some((project) => project.id === req.body?.track?.projectId)) return res.status(404).json({ error: "Prosjektet ble ikke funnet." });
    if (tracks.some((track) => track.id === req.body?.track?.id)) return res.status(409).json({ error: "Lydfilen er allerede registrert." });
    const pathname = cleanText(req.body?.track?.pathname, 500);
    const actualBlob = await head(pathname, { access: "private" });
    const track = sanitizeTrack(req.body?.track, actualBlob, user.email);
    if (!track) return res.status(400).json({ error: "Lydfilen kunne ikke verifiseres." });
    tracks.unshift(track);
    await writeCollection("audio", tracks);
    return res.status(201).json({ track });
  }

  if (req.method === "POST" && req.body?.operation === "share") {
    const track = tracks.find((item) => item.id === cleanText(req.body?.id, 80));
    if (!track) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
    const days = Math.max(1, Math.min(Number(req.body?.days) || 14, 90));
    const token = createScopedToken(track.id, "audio-share", days * 24 * 60 * 60);
    return res.status(200).json({
      url: `${publicBaseUrl(req)}/lytt/?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
    });
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
}

async function internalStreamHandler(req, res) {
  if (!requireUser(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const tracks = await readCollection("audio");
  const track = tracks.find((item) => item.id === cleanText(req.query?.id, 80));
  if (!track) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
  return streamPrivateBlob(req, res, track.pathname, track.filename);
}

async function publicShareHandler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const grant = verifyScopedToken(req.query?.token, "audio-share");
  if (!grant) return res.status(401).json({ error: "Lenken er ugyldig eller utløpt." });
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
}

async function publicStreamHandler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const grant = verifyScopedToken(req.query?.token, "audio-share");
  if (!grant) return res.status(401).json({ error: "Lenken er ugyldig eller utløpt." });
  const tracks = await readCollection("audio");
  const track = tracks.find((item) => item.id === grant.subject);
  if (!track) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
  return streamPrivateBlob(req, res, track.pathname, track.filename);
}

async function jottaSyncHandler(req, res) {
  if (!bridgeAuthorized(req)) return res.status(401).json({ error: "Ugyldig brotilgang." });
  const tracks = await readCollection("audio");
  if (req.method === "GET") {
    const projects = await readCollection("projects");
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    return res.status(200).json({
      tracks: tracks.filter((track) => !track.jottaSyncedAt).map((track) => ({
        id: track.id,
        projectName: projectNames.get(track.projectId) || "Uten prosjekt",
        filename: track.filename,
        size: track.size,
        uploadedAt: track.uploadedAt,
        downloadPath: `/api/studio?action=jotta-download&id=${encodeURIComponent(track.id)}`,
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
}

async function jottaDownloadHandler(req, res) {
  if (!bridgeAuthorized(req)) return res.status(401).json({ error: "Ugyldig brotilgang." });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const tracks = await readCollection("audio");
  const track = tracks.find((item) => item.id === cleanText(req.query?.id, 80));
  if (!track) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
  return streamPrivateBlob(req, res, track.pathname, track.filename);
}

async function workspaceHandler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const items = await readCollection("workspace");

  if (req.method === "GET") {
    return res.status(200).json({
      tasks: items.filter((item) => item.kind === "task"),
      notes: items.filter((item) => item.kind === "note"),
    });
  }

  if (req.method === "POST") {
    const kind = req.body?.kind;
    const sanitized = kind === "task"
      ? sanitizeTask(req.body?.item, {}, user.email)
      : kind === "note" ? sanitizeNote(req.body?.item, {}, user.email) : null;
    if (!sanitized) return res.status(400).json({ error: "Fyll ut de obligatoriske feltene." });
    const item = { ...sanitized, kind };
    items.unshift(item);
    await writeCollection("workspace", items);
    return res.status(201).json({ item });
  }

  if (req.method === "PATCH") {
    const id = cleanText(req.body?.id, 120);
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return res.status(404).json({ error: "Elementet ble ikke funnet." });
    const current = items[index];
    const updated = current.kind === "task"
      ? sanitizeTask(req.body?.changes, current, user.email)
      : sanitizeNote(req.body?.changes, current, user.email);
    if (!updated) return res.status(400).json({ error: "Fyll ut de obligatoriske feltene." });
    items[index] = { ...updated, kind: current.kind };
    await writeCollection("workspace", items);
    return res.status(200).json({ item: items[index] });
  }

  if (req.method === "DELETE") {
    const id = cleanText(req.query?.id || req.body?.id, 120);
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return res.status(404).json({ error: "Elementet ble ikke funnet." });
    items.splice(index, 1);
    await writeCollection("workspace", items);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

async function fikenHandler(req, res) {
  if (!requireUser(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  return res.status(200).json(await loadFikenSummary());
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const action = String(req.query?.action || "");
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert." });
  try {
    if (action === "projects") return await projectsHandler(req, res);
    if (action === "project-export") return await projectExportHandler(req, res);
    if (action === "upload") return await uploadHandler(req, res);
    if (action === "audio") return await audioHandler(req, res);
    if (action === "internal-stream") return await internalStreamHandler(req, res);
    if (action === "public-share") return await publicShareHandler(req, res);
    if (action === "public-stream") return await publicStreamHandler(req, res);
    if (action === "jotta-sync") return await jottaSyncHandler(req, res);
    if (action === "jotta-download") return await jottaDownloadHandler(req, res);
    if (action === "workspace") return await workspaceHandler(req, res);
    if (action === "fiken") return await fikenHandler(req, res);
    return res.status(404).json({ error: "Ukjent studiohandling." });
  } catch (error) {
    console.error(`Studio API failed (${action})`, error?.message);
    return res.status(503).json({ error: "Studiomodulen kunne ikke fullføre handlingen." });
  }
};
