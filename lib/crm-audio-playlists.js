const crypto = require("crypto");

const MAX_PLAYLIST_TRACKS = 100;

function cleanText(value, max = 250) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanTrackIds(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((id) => cleanText(id, 80))
    .filter((id) => {
      if (!/^track-[a-zA-Z0-9-]{1,74}$/.test(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, MAX_PLAYLIST_TRACKS);
}

function sanitizeAudioPlaylist(input, existing = {}, userEmail = "") {
  const now = new Date().toISOString();
  const id = cleanText(existing.id || input?.id, 90) || `playlist-${crypto.randomUUID()}`;
  const projectId = cleanText(existing.projectId || input?.projectId, 120);
  const trackIds = cleanTrackIds(input?.trackIds ?? existing.trackIds);
  if (!/^playlist-[0-9a-f-]{36}$/.test(id) || !projectId || !trackIds.length) return null;
  return {
    id,
    projectId,
    title: cleanText(input?.title ?? existing.title, 160) || "Lydleveranse",
    trackIds,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    createdBy: cleanText(existing.createdBy || userEmail, 254).toLowerCase(),
  };
}

function publicAudioPlaylist(playlist) {
  return {
    id: playlist.id,
    projectId: playlist.projectId,
    title: playlist.title,
    trackIds: cleanTrackIds(playlist.trackIds),
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  };
}

function playlistTracks(playlist, tracks) {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  return cleanTrackIds(playlist?.trackIds).map((id) => byId.get(id)).filter(Boolean);
}

module.exports = {
  MAX_PLAYLIST_TRACKS,
  cleanTrackIds,
  playlistTracks,
  publicAudioPlaylist,
  sanitizeAudioPlaylist,
};
