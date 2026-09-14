const crypto = require("crypto");

const PROJECT_STATUSES = new Set(["Planlegges", "Booket", "Innspilling", "Miks", "Mastering", "Levert", "På vent"]);
const SPOTIFY_REFERENCE_TYPES = new Set(["playlist", "album", "track"]);
const SPOTIFY_REFERENCE_LABELS = {
  playlist: "Spotify-spilleliste",
  album: "Spotify-album",
  track: "Spotify-låt",
};

function cleanText(value, max = 250) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function emptyPatch() {
  return Array.from({ length: 32 }, (_, index) => ({
    channel: index + 1,
    source: "",
    connection: "",
    microphone: "",
    preamp: "",
    destination: `Input ${index + 1}`,
    phantom: false,
    notes: "",
  }));
}

function sanitizePatch(input) {
  const byChannel = new Map(
    (Array.isArray(input) ? input : [])
      .map((row) => [Math.trunc(Number(row?.channel)), row])
      .filter(([channel]) => channel >= 1 && channel <= 32),
  );

  return emptyPatch().map((fallback) => {
    const row = byChannel.get(fallback.channel) || {};
    return {
      channel: fallback.channel,
      source: cleanText(row.source, 100),
      connection: cleanText(row.connection, 100),
      microphone: cleanText(row.microphone, 100),
      preamp: cleanText(row.preamp, 100),
      destination: cleanText(row.destination || fallback.destination, 100),
      phantom: row.phantom === true,
      notes: cleanText(row.notes, 240),
    };
  });
}

function parseSpotifyUrl(value) {
  const raw = cleanText(value, 500);
  if (!raw) return null;

  let type = "";
  let spotifyId = "";
  const uri = raw.match(/^spotify:(playlist|album|track):([A-Za-z0-9]{10,64})$/i);
  if (uri) {
    type = uri[1].toLowerCase();
    spotifyId = uri[2];
  } else {
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || url.hostname !== "open.spotify.com") return null;
      const segments = url.pathname.split("/").filter(Boolean);
      if (/^intl-[a-z]{2}$/i.test(segments[0] || "")) segments.shift();
      if (segments[0] === "embed") segments.shift();
      type = String(segments[0] || "").toLowerCase();
      spotifyId = String(segments[1] || "");
    } catch {
      return null;
    }
  }

  if (!SPOTIFY_REFERENCE_TYPES.has(type) || !/^[A-Za-z0-9]{10,64}$/.test(spotifyId)) return null;
  return {
    type,
    spotifyId,
    url: `https://open.spotify.com/${type}/${spotifyId}`,
    embedUrl: `https://open.spotify.com/embed/${type}/${spotifyId}`,
  };
}

function sanitizeSpotifyReference(input) {
  const parsed = parseSpotifyUrl(input?.url || input?.embedUrl || input?.spotifyUri);
  if (!parsed) return null;
  return {
    id: cleanText(input?.id, 120) || `spotify-${crypto.randomUUID()}`,
    title: cleanText(input?.title, 120) || SPOTIFY_REFERENCE_LABELS[parsed.type],
    note: cleanText(input?.note, 300),
    ...parsed,
  };
}

function sanitizeSpotifyReferences(input) {
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map(sanitizeSpotifyReference)
    .filter((reference) => {
      if (!reference) return false;
      const key = `${reference.type}:${reference.spotifyId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function sanitizeProject(input, existing = {}) {
  const requestedStatus = cleanText(input?.status ?? existing.status ?? "Planlegges", 40);
  const now = new Date().toISOString();
  const hasPatch = Array.isArray(input?.patch);

  return {
    id: cleanText(existing.id || input?.id, 120) || `project-${crypto.randomUUID()}`,
    name: cleanText(input?.name ?? existing.name, 150) || "Nytt studioprosjekt",
    clientName: cleanText(input?.clientName ?? existing.clientName, 150),
    clientEmail: cleanEmail(input?.clientEmail ?? existing.clientEmail),
    status: PROJECT_STATUSES.has(requestedStatus) ? requestedStatus : "Planlegges",
    sessionDate: cleanText(input?.sessionDate ?? existing.sessionDate, 20),
    notes: cleanText(input?.notes ?? existing.notes, 1000),
    spotifyReferences: sanitizeSpotifyReferences(
      Array.isArray(input?.spotifyReferences) ? input.spotifyReferences : existing.spotifyReferences,
    ),
    patch: sanitizePatch(hasPatch ? input.patch : existing.patch),
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

module.exports = {
  PROJECT_STATUSES,
  cleanText,
  emptyPatch,
  parseSpotifyUrl,
  sanitizePatch,
  sanitizeProject,
  sanitizeSpotifyReference,
  sanitizeSpotifyReferences,
};
