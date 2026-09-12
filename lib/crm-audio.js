const crypto = require("crypto");

const MAX_AUDIO_SIZE = 750 * 1024 * 1024;
const AUDIO_CONTENT_TYPES = [
  "audio/aac",
  "audio/aiff",
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-aiff",
  "audio/x-flac",
  "audio/x-m4a",
  "audio/x-wav",
];
const AUDIO_EXTENSIONS = new Set([".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp3", ".ogg", ".wav", ".weba", ".webm"]);

function cleanText(value, max = 250) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeFilename(value) {
  const cleaned = cleanText(value, 180)
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/^\.+/, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const extension = cleaned.includes(".") ? `.${cleaned.split(".").pop().toLowerCase()}` : "";
  if (!AUDIO_EXTENSIONS.has(extension)) return "";
  return cleaned || `lydfil${extension}`;
}

function isAudioContentType(value) {
  return AUDIO_CONTENT_TYPES.includes(String(value || "").split(";")[0].toLowerCase());
}

function audioPathname(trackId, filename) {
  const id = cleanText(trackId, 80);
  const name = safeFilename(filename);
  if (!/^track-[0-9a-f-]{36}$/.test(id) || !name) return "";
  return `loki-crm/audio/${id}/${name}`;
}

function newTrackId() {
  return `track-${crypto.randomUUID()}`;
}

function sanitizeTrack(input, actualBlob, userEmail) {
  const id = cleanText(input?.id, 80);
  const filename = safeFilename(input?.filename);
  const expectedPathname = audioPathname(id, filename);
  const size = Number(actualBlob?.size || 0);
  const contentType = String(actualBlob?.contentType || "").split(";")[0].toLowerCase();
  if (!expectedPathname || actualBlob?.pathname !== expectedPathname) return null;
  if (!isAudioContentType(contentType) || size <= 0 || size > MAX_AUDIO_SIZE) return null;

  return {
    id,
    projectId: cleanText(input?.projectId, 120),
    title: cleanText(input?.title || filename.replace(/\.[^.]+$/, ""), 160),
    version: cleanText(input?.version || "V1", 40),
    notes: cleanText(input?.notes, 500),
    filename,
    pathname: expectedPathname,
    contentType,
    size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: cleanText(userEmail, 254).toLowerCase(),
    jottaStatus: "Venter på lokal synk",
    jottaSyncedAt: null,
  };
}

module.exports = {
  AUDIO_CONTENT_TYPES,
  MAX_AUDIO_SIZE,
  audioPathname,
  cleanText,
  isAudioContentType,
  newTrackId,
  safeFilename,
  sanitizeTrack,
};
