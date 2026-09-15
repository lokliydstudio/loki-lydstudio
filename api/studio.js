const { del, head, issueSignedToken } = require("@vercel/blob");
const { handleUploadPresigned } = require("@vercel/blob/client");
const { createScopedToken, createToken, requireUser, verifyScopedToken, verifyToken } = require("../lib/crm-auth");
const { AUDIO_CONTENT_TYPES, MAX_AUDIO_SIZE, audioPathname, cleanText, sanitizeTrack } = require("../lib/crm-audio");
const { MAX_COMMENTS_PER_TRACK, commentsForTrack, publicAudioComment, sanitizeAudioComment } = require("../lib/crm-audio-comments");
const { streamPrivateBlob } = require("../lib/crm-audio-stream");
const { bridgeAuthorized } = require("../lib/crm-bridge");
const { loadGoogleCalendar } = require("../lib/crm-calendar");
const { authorizationUrl, exchangeAuthorizationCode, loadFikenSummary, oauthConfigured } = require("../lib/crm-fiken");
const { bookingConflict, sanitizeActivity, sanitizeBooking, sanitizeQuote } = require("../lib/crm-operations");
const { presenceCollection, presenceHeartbeat, presenceOffline, presenceOwners, presenceStatus } = require("../lib/crm-presence");
const { createProjectExport, planProjectDeletion } = require("../lib/crm-project-export");
const { sanitizeProject } = require("../lib/crm-projects");
const { prospectSyncHandler, prospectsHandler } = require("../lib/crm-prospect-handler");
const { sanitizePayment, sanitizeRoomKeys, sanitizeTenant, seedRentalItems, splitRentalItems } = require("../lib/crm-rentals");
const { isConfigured, readCollection, writeCollection } = require("../lib/crm-store");
const { sanitizeGoal, sanitizeNote, sanitizeTask } = require("../lib/crm-workspace");

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
    const [projects, tracks, comments] = await Promise.all([
      readCollection("projects"),
      readCollection("audio"),
      readCollection("audio-comments"),
    ]);
    const deletion = planProjectDeletion(projects, tracks, id);
    if (!deletion) return res.status(404).json({ error: "Prosjektet ble ikke funnet." });

    const pathnames = deletion.attachedTracks.map((track) => track.pathname).filter(Boolean);
    const deletedTrackIds = new Set(deletion.attachedTracks.map((track) => track.id));
    if (pathnames.length) await del(pathnames);
    await writeCollection("audio", deletion.remainingTracks);
    await writeCollection("audio-comments", comments.filter((comment) => !deletedTrackIds.has(comment.trackId)));
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
  const [projects, tracks, comments] = await Promise.all([
    readCollection("projects"),
    readCollection("audio"),
    readCollection("audio-comments"),
  ]);
  const requestedId = cleanText(req.query?.id, 120);
  const manifest = createProjectExport(projects, tracks, requestedId, comments);
  if (!manifest) return res.status(404).json({ error: "Prosjektet ble ikke funnet." });
  return res.status(200).json(manifest);
}

async function uploadHandler(req, res) {
  if (!requireUser(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const result = await handleUploadPresigned({
      body: req.body,
      request: req,
      getSignedToken: async (pathname, clientPayload) => {
        let payload;
        try { payload = JSON.parse(clientPayload || "{}"); } catch { throw new Error("Ugyldig opplastingsdata."); }
        if (audioPathname(payload.trackId, payload.filename) !== pathname) throw new Error("Ugyldig filsti.");
        const projects = await readCollection("projects");
        if (!projects.some((project) => project.id === payload.projectId)) throw new Error("Prosjektet finnes ikke.");

        const validUntil = Date.now() + 15 * 60 * 1000;
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes: AUDIO_CONTENT_TYPES,
          maximumSizeInBytes: MAX_AUDIO_SIZE,
          validUntil,
        });
        return {
          token,
          urlOptions: {
            allowedContentTypes: AUDIO_CONTENT_TYPES,
            maximumSizeInBytes: MAX_AUDIO_SIZE,
            validUntil,
            addRandomSuffix: false,
            allowOverwrite: false,
            cacheControlMaxAge: 60,
          },
        };
      },
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("Audio upload signing failed", error?.message);
    return res.status(400).json({ error: error?.message || "Kunne ikke starte lydopplastingen." });
  }
}

async function audioHandler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const tracks = await readCollection("audio");

  if (req.method === "GET") {
    const projectId = cleanText(req.query?.projectId, 120);
    const visibleTracks = tracks.filter((track) => !projectId || track.projectId === projectId);
    const visibleTrackIds = new Set(visibleTracks.map((track) => track.id));
    const comments = await readCollection("audio-comments");
    return res.status(200).json({
      tracks: visibleTracks,
      comments: comments.filter((comment) => visibleTrackIds.has(comment.trackId)).map(publicAudioComment),
    });
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
    const comments = await readCollection("audio-comments");
    await writeCollection("audio-comments", comments.filter((comment) => comment.trackId !== id));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

async function audioCommentsHandler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const trackId = cleanText(req.query?.trackId || req.body?.trackId, 80);
  const tracks = await readCollection("audio");
  if (!tracks.some((track) => track.id === trackId)) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
  const comments = await readCollection("audio-comments");

  if (req.method === "GET") {
    return res.status(200).json({ comments: commentsForTrack(comments, trackId) });
  }

  if (req.method === "POST") {
    if (comments.filter((comment) => comment.trackId === trackId).length >= MAX_COMMENTS_PER_TRACK) {
      return res.status(409).json({ error: "Denne lydfilen har nådd grensen på 250 kommentarer." });
    }
    const comment = sanitizeAudioComment({ ...req.body, trackId }, { type: "studio", email: user.email });
    if (!comment) return res.status(400).json({ error: "Skriv en kommentar før du lagrer." });
    comments.unshift(comment);
    await writeCollection("audio-comments", comments);
    return res.status(201).json({ comment: publicAudioComment(comment) });
  }

  if (req.method === "DELETE") {
    const id = cleanText(req.query?.id || req.body?.id, 80);
    const index = comments.findIndex((comment) => comment.id === id && comment.trackId === trackId);
    if (index < 0) return res.status(404).json({ error: "Kommentaren ble ikke funnet." });
    comments.splice(index, 1);
    await writeCollection("audio-comments", comments);
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

async function publicCommentsHandler(req, res) {
  const grant = verifyScopedToken(req.query?.token, "audio-share");
  if (!grant) return res.status(401).json({ error: "Lenken er ugyldig eller utløpt." });
  const tracks = await readCollection("audio");
  const track = tracks.find((item) => item.id === grant.subject);
  if (!track) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });
  const comments = await readCollection("audio-comments");

  if (req.method === "GET") {
    return res.status(200).json({ comments: commentsForTrack(comments, track.id) });
  }

  if (req.method === "POST") {
    if (comments.filter((comment) => comment.trackId === track.id).length >= MAX_COMMENTS_PER_TRACK) {
      return res.status(409).json({ error: "Denne lydfilen har nådd grensen på 250 kommentarer." });
    }
    const comment = sanitizeAudioComment({ ...req.body, trackId: track.id }, { type: "customer" });
    if (!comment) return res.status(400).json({ error: "Skriv navn og kommentar før du lagrer." });
    const duplicate = comments.find((item) => item.trackId === track.id
      && item.authorName === comment.authorName
      && item.body === comment.body
      && item.timestampSeconds === comment.timestampSeconds
      && Date.now() - new Date(item.createdAt).getTime() < 30_000);
    if (duplicate) return res.status(200).json({ comment: publicAudioComment(duplicate) });
    comments.unshift(comment);
    await writeCollection("audio-comments", comments);
    return res.status(201).json({ comment: publicAudioComment(comment) });
  }

  return res.status(405).json({ error: "Method not allowed" });
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
      goals: items.filter((item) => item.kind === "goal"),
    });
  }

  if (req.method === "POST") {
    const kind = req.body?.kind;
    const sanitized = kind === "task"
      ? sanitizeTask(req.body?.item, {}, user.email)
      : kind === "note"
        ? sanitizeNote(req.body?.item, {}, user.email)
        : kind === "goal" ? sanitizeGoal(req.body?.item, {}, user.email) : null;
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
      : current.kind === "note"
        ? sanitizeNote(req.body?.changes, current, user.email)
        : current.kind === "goal" ? sanitizeGoal(req.body?.changes, current, user.email) : null;
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

function rentalPayload(items) {
  const data = splitRentalItems(items);
  const activeTenants = data.tenants.filter((tenant) => tenant.active !== false);
  return {
    ...data,
    summary: {
      activeTenants: activeTenants.length,
      monthlyRent: activeTenants.reduce((sum, tenant) => sum + (Number(tenant.monthlyRent) || 0), 0),
    },
  };
}

async function rentalsHandler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  let items = await readCollection("rentals");

  if (req.method === "GET") {
    if (!items.length) {
      items = seedRentalItems(user.email);
      await writeCollection("rentals", items);
    }
    return res.status(200).json(rentalPayload(items));
  }

  if (req.method === "POST" && req.body?.kind === "tenant") {
    const tenant = sanitizeTenant(req.body?.item || {}, {}, user.email);
    if (!tenant) return res.status(400).json({ error: "Leietakeren må ha et navn." });
    items.unshift({ ...tenant, kind: "tenant" });
    await writeCollection("rentals", items);
    return res.status(201).json({ tenant: rentalPayload(items).tenants.find((item) => item.id === tenant.id) });
  }

  if (req.method === "POST" && req.body?.kind === "payment") {
    const tenantId = cleanText(req.body?.item?.tenantId, 120);
    if (!items.some((item) => item.kind === "tenant" && item.id === tenantId)) {
      return res.status(404).json({ error: "Leietakeren ble ikke funnet." });
    }
    const existingIndex = items.findIndex((item) => item.kind === "payment"
      && item.tenantId === tenantId
      && Number(item.year) === Number(req.body?.item?.year)
      && Number(item.month) === Number(req.body?.item?.month));
    const payment = sanitizePayment(req.body?.item || {}, existingIndex >= 0 ? items[existingIndex] : {}, user.email);
    if (!payment) return res.status(400).json({ error: "Betalingen har ugyldig måned eller dato." });
    if (existingIndex >= 0) items[existingIndex] = { ...payment, kind: "payment" };
    else items.push({ ...payment, kind: "payment" });
    await writeCollection("rentals", items);
    return res.status(existingIndex >= 0 ? 200 : 201).json({ payment: { ...payment, kind: "payment" } });
  }

  if (req.method === "PATCH") {
    const kind = cleanText(req.body?.kind, 40);
    const id = cleanText(req.body?.id, 120);
    const index = items.findIndex((item) => item.id === id && item.kind === kind);
    if (index < 0) return res.status(404).json({ error: "Elementet ble ikke funnet." });
    const current = items[index];
    const updated = kind === "tenant"
      ? sanitizeTenant(req.body?.changes || {}, current, user.email)
      : kind === "room-keys" ? sanitizeRoomKeys(req.body?.changes || {}, current, user.email) : null;
    if (!updated) return res.status(400).json({ error: "Endringen inneholder ugyldige verdier." });
    items[index] = { ...updated, kind };
    await writeCollection("rentals", items);
    const data = rentalPayload(items);
    return res.status(200).json(kind === "tenant"
      ? { tenant: data.tenants.find((item) => item.id === id) }
      : { room: data.rooms.find((item) => item.id === id) });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

async function appendLeadActivity(activity, userEmail) {
  if (!activity?.leadId) return;
  try {
    const activities = await readCollection("activities");
    const sanitized = sanitizeActivity(activity, {}, userEmail);
    if (!sanitized) return;
    activities.unshift(sanitized);
    await writeCollection("activities", activities.slice(0, 3000));
  } catch (error) {
    console.error("Lead activity log failed", error?.message);
  }
}

async function activitiesHandler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const activities = await readCollection("activities");

  if (req.method === "GET") {
    const leadId = cleanText(req.query?.leadId, 120);
    const limit = Math.max(1, Math.min(Number(req.query?.limit) || 100, 500));
    const visible = activities
      .filter((item) => !leadId || item.leadId === leadId)
      .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
      .slice(0, limit);
    return res.status(200).json({ activities: visible });
  }

  if (req.method === "POST") {
    const activity = sanitizeActivity(req.body?.activity || req.body, {}, user.email);
    if (!activity) return res.status(400).json({ error: "Velg kunde og skriv hva som skjedde." });
    activities.unshift(activity);
    await writeCollection("activities", activities.slice(0, 3000));
    return res.status(201).json({ activity });
  }

  if (req.method === "DELETE") {
    const id = cleanText(req.query?.id || req.body?.id, 120);
    const index = activities.findIndex((item) => item.id === id);
    if (index < 0) return res.status(404).json({ error: "Aktiviteten ble ikke funnet." });
    activities.splice(index, 1);
    await writeCollection("activities", activities);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

async function bookingsHandler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const bookings = await readCollection("bookings");

  if (req.method === "GET") {
    return res.status(200).json({
      bookings: bookings.sort((left, right) => `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`)),
    });
  }

  if (req.method === "POST") {
    const booking = sanitizeBooking(req.body?.booking || req.body, {}, user.email);
    if (!booking) return res.status(400).json({ error: "Fyll ut tittel, dato og et gyldig tidsrom." });
    const conflict = bookingConflict(bookings, booking);
    if (conflict) return res.status(409).json({ error: `Tiden overlapper med «${conflict.title}» (${conflict.startTime}–${conflict.endTime}).` });
    bookings.push(booking);
    await writeCollection("bookings", bookings);
    await appendLeadActivity({ leadId: booking.leadId, type: "Booking", details: `${booking.service} booket ${booking.date} kl. ${booking.startTime}–${booking.endTime}.` }, user.email);
    return res.status(201).json({ booking });
  }

  if (req.method === "PATCH") {
    const id = cleanText(req.body?.id, 120);
    const index = bookings.findIndex((item) => item.id === id);
    if (index < 0) return res.status(404).json({ error: "Bookingen ble ikke funnet." });
    const booking = sanitizeBooking(req.body?.changes || {}, bookings[index], user.email);
    if (!booking) return res.status(400).json({ error: "Fyll ut tittel, dato og et gyldig tidsrom." });
    const conflict = bookingConflict(bookings, booking);
    if (conflict) return res.status(409).json({ error: `Tiden overlapper med «${conflict.title}» (${conflict.startTime}–${conflict.endTime}).` });
    bookings[index] = booking;
    await writeCollection("bookings", bookings);
    return res.status(200).json({ booking });
  }

  if (req.method === "DELETE") {
    const id = cleanText(req.query?.id || req.body?.id, 120);
    const index = bookings.findIndex((item) => item.id === id);
    if (index < 0) return res.status(404).json({ error: "Bookingen ble ikke funnet." });
    bookings.splice(index, 1);
    await writeCollection("bookings", bookings);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

async function googleCalendarHandler(req, res) {
  if (!requireUser(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const calendar = await loadGoogleCalendar({ refresh: String(req.query?.refresh || "") === "1" });
  return res.status(200).json(calendar);
}

async function presenceHandler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  if (!["GET", "POST", "DELETE"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  const collection = presenceCollection(user.email);
  if (!collection) return res.status(403).json({ error: "Brukeren har ikke tilgang til tilstedeværelsesstatus." });

  const existing = (await readCollection(collection))[0] || {};
  if (req.method === "POST") await writeCollection(collection, [presenceHeartbeat(user.email, existing)]);
  else if (req.method === "DELETE") await writeCollection(collection, [presenceOffline(user.email, existing)]);

  const records = await Promise.all(presenceOwners().map(async (owner) => {
    const items = await readCollection(presenceCollection(owner.email));
    return items[0] || null;
  }));
  return res.status(200).json({ users: presenceStatus(records.filter(Boolean), user.email), onlineWindowSeconds: 150 });
}

async function quotesHandler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const quotes = await readCollection("quotes");

  if (req.method === "GET") {
    return res.status(200).json({ quotes: quotes.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))) });
  }

  if (req.method === "POST") {
    const quote = sanitizeQuote(req.body?.quote || req.body, {}, user.email);
    if (!quote) return res.status(400).json({ error: "Fyll ut kunde, prosjekt og minst én tilbudslinje." });
    quotes.unshift(quote);
    await writeCollection("quotes", quotes);
    await appendLeadActivity({ leadId: quote.leadId, type: "Tilbud", details: `Tilbud ${quote.number} opprettet på ${quote.total.toLocaleString("nb-NO")} kr.` }, user.email);
    return res.status(201).json({ quote });
  }

  if (req.method === "PATCH") {
    const id = cleanText(req.body?.id, 120);
    const index = quotes.findIndex((item) => item.id === id);
    if (index < 0) return res.status(404).json({ error: "Tilbudet ble ikke funnet." });
    const previousStatus = quotes[index].status;
    const quote = sanitizeQuote(req.body?.changes || {}, quotes[index], user.email);
    if (!quote) return res.status(400).json({ error: "Fyll ut kunde, prosjekt og minst én tilbudslinje." });
    quotes[index] = quote;
    await writeCollection("quotes", quotes);
    if (quote.status !== previousStatus) {
      await appendLeadActivity({ leadId: quote.leadId, type: "Tilbud", details: `Tilbud ${quote.number} markert som «${quote.status}».` }, user.email);
    }
    return res.status(200).json({ quote });
  }

  if (req.method === "DELETE") {
    const id = cleanText(req.query?.id || req.body?.id, 120);
    const index = quotes.findIndex((item) => item.id === id);
    if (index < 0) return res.status(404).json({ error: "Tilbudet ble ikke funnet." });
    quotes.splice(index, 1);
    await writeCollection("quotes", quotes);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

async function backupHandler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const [leads, workspace, rentals, projects, audio, audioComments, documents, activities, bookings, quotes, mailSort, funding, prospects, prospectRuns] = await Promise.all([
    readCollection("leads"),
    readCollection("workspace"),
    readCollection("rentals"),
    readCollection("projects"),
    readCollection("audio"),
    readCollection("audio-comments"),
    readCollection("documents"),
    readCollection("activities"),
    readCollection("bookings"),
    readCollection("quotes"),
    readCollection("mail-sort"),
    readCollection("funding-monitor"),
    readCollection("cold-call-pool"),
    readCollection("cold-call-runs"),
  ]);
  const projectExport = createProjectExport(projects, audio, "", audioComments);
  const safeDocuments = documents.map(({ pathname, uploadedBy, ...document }) => document);
  return res.status(200).json({
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: user.email,
    studio: "Loki Lydstudio",
    containsPersonalData: true,
    leads,
    workspace,
    rentals,
    projects: projectExport.projects,
    audioFiles: projectExport.files,
    audioComments: audioComments.map(publicAudioComment),
    documents: safeDocuments,
    activities,
    bookings,
    quotes,
    mailPreferences: mailSort,
    fundingMonitor: funding,
    coldCallPool: prospects,
    coldCallRuns: prospectRuns,
  });
}

async function fikenHandler(req, res) {
  if (!requireUser(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  return res.status(200).json(await loadFikenSummary());
}

function fikenRedirectUri(req) {
  return `${publicBaseUrl(req)}/api/studio?action=fiken-callback`;
}

async function fikenConnectHandler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!oauthConfigured()) return res.status(503).json({ error: "Fiken OAuth-appen er ikke konfigurert ennå." });
  const state = createToken(user.email, "fiken-oauth", 600);
  return res.redirect(302, authorizationUrl(fikenRedirectUri(req), state));
}

async function fikenCallbackHandler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const baseUrl = publicBaseUrl(req);
  const state = String(req.query?.state || "");
  const verified = verifyToken(state, "fiken-oauth");
  const code = String(req.query?.code || "");
  if (!verified || !code || req.query?.error) {
    return res.redirect(302, `${baseUrl}/crmplatform/?fiken=cancelled#economy`);
  }
  try {
    await exchangeAuthorizationCode(code, fikenRedirectUri(req), state);
    return res.redirect(302, `${baseUrl}/crmplatform/?fiken=connected#economy`);
  } catch (error) {
    console.error("Fiken OAuth callback failed", error?.message);
    return res.redirect(302, `${baseUrl}/crmplatform/?fiken=failed#economy`);
  }
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
    if (action === "audio-comments") return await audioCommentsHandler(req, res);
    if (action === "internal-stream") return await internalStreamHandler(req, res);
    if (action === "public-share") return await publicShareHandler(req, res);
    if (action === "public-comments") return await publicCommentsHandler(req, res);
    if (action === "public-stream") return await publicStreamHandler(req, res);
    if (action === "jotta-sync") return await jottaSyncHandler(req, res);
    if (action === "jotta-download") return await jottaDownloadHandler(req, res);
    if (action === "workspace") return await workspaceHandler(req, res);
    if (action === "rentals") return await rentalsHandler(req, res);
    if (action === "activities") return await activitiesHandler(req, res);
    if (action === "bookings") return await bookingsHandler(req, res);
    if (action === "google-calendar") return await googleCalendarHandler(req, res);
    if (action === "presence") return await presenceHandler(req, res);
    if (action === "quotes") return await quotesHandler(req, res);
    if (action === "backup") return await backupHandler(req, res);
    if (action === "fiken") return await fikenHandler(req, res);
    if (action === "fiken-connect") return await fikenConnectHandler(req, res);
    if (action === "fiken-callback") return await fikenCallbackHandler(req, res);
    if (action === "prospects") return await prospectsHandler(req, res);
    if (action === "prospect-sync") return await prospectSyncHandler(req, res);
    return res.status(404).json({ error: "Ukjent studiohandling." });
  } catch (error) {
    console.error(`Studio API failed (${action})`, error?.message);
    return res.status(503).json({ error: "Studiomodulen kunne ikke fullføre handlingen." });
  }
};
