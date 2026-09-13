const crypto = require("crypto");

const MAX_DOCUMENT_SIZE = 500 * 1024 * 1024;
const BLOCKED_SEGMENTS = new Set([
  "mikser (cloud)",
  "prosjekter (cloud)",
  "crm lydfiler",
  "passord",
  "password",
  "passwords",
  "innlogging",
  "innlogginger",
  "login",
  "logins",
]);
const SAFE_EXTENSIONS = new Set([
  "aac", "aif", "aiff", "ai", "bmp", "csv", "doc", "docx", "epub", "flac", "gif", "heic", "indd",
  "jpeg", "jpg", "json", "key", "m4a", "m4v", "mov", "mp3", "mp4", "numbers", "odf", "ods", "odt",
  "ogg", "pages", "pdf", "png", "ppt", "pptx", "psd", "rtf", "tif", "tiff", "txt", "wav", "weba",
  "webm", "webp", "xls", "xlsx", "zip",
]);

const MIME_BY_EXTENSION = {
  aac: "audio/aac", aif: "audio/aiff", aiff: "audio/aiff", bmp: "image/bmp", csv: "text/csv",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  epub: "application/epub+zip", flac: "audio/flac", gif: "image/gif", heic: "image/heic", jpeg: "image/jpeg",
  jpg: "image/jpeg", json: "application/json", m4a: "audio/mp4", m4v: "video/mp4", mov: "video/quicktime",
  mp3: "audio/mpeg", mp4: "video/mp4", odf: "application/vnd.oasis.opendocument.formula",
  ods: "application/vnd.oasis.opendocument.spreadsheet", odt: "application/vnd.oasis.opendocument.text",
  ogg: "audio/ogg", pdf: "application/pdf", png: "image/png", ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", rtf: "application/rtf",
  tif: "image/tiff", tiff: "image/tiff", txt: "text/plain", wav: "audio/wav", weba: "audio/webm",
  webm: "video/webm", webp: "image/webp", xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zip: "application/zip",
};

function clean(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function blocked(pathname) {
  return clean(pathname, 1000)
    .toLowerCase()
    .split(/[\\/]+/)
    .some((part) => BLOCKED_SEGMENTS.has(part.trim()));
}

function extension(filename) {
  return clean(filename, 250).toLowerCase().split(".").pop();
}

function documentContentType(filename) {
  return MIME_BY_EXTENSION[extension(filename)] || "application/octet-stream";
}

function documentType(filename) {
  const ext = extension(filename);
  if (["xlsx", "xls", "csv", "numbers", "ods"].includes(ext)) return "Regneark";
  if (["doc", "docx", "odt", "pages", "rtf", "txt"].includes(ext)) return "Tekstdokument";
  if (ext === "pdf") return "PDF";
  if (["ppt", "pptx", "key"].includes(ext)) return "Presentasjon";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "tif", "tiff", "bmp", "psd", "ai"].includes(ext)) return "Bilde";
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "Video";
  if (["wav", "mp3", "flac", "aif", "aiff", "m4a", "aac", "ogg", "weba"].includes(ext)) return "Lyd";
  return ext ? ext.toUpperCase() : "Dokument";
}

function safeFilename(value) {
  return clean(value, 250)
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/^\.+/, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 180);
}

function validDocumentId(value) {
  const id = clean(value, 120);
  return /^[a-zA-Z0-9-]{12,120}$/.test(id) ? id : "";
}

function documentPathname(id, filename) {
  const safeId = validDocumentId(id);
  const safeName = safeFilename(filename);
  if (!safeId || !safeName || !SAFE_EXTENSIONS.has(extension(safeName))) return "";
  return `loki-crm/documents/${safeId}/${safeName}`;
}

function encodeJottaPathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function jottacloudDocumentUrl(relativePath) {
  const path = clean(relativePath, 1000).replace(/^\/+/, "");
  if (!path || blocked(path)) return "";
  const segments = ["Loki Lydstudio", "Dokumenter (Cloud)", ...path.split("/")]
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(encodeJottaPathSegment);
  return `https://jottacloud.com/web/sync/list/name/${segments.join("/")}`;
}

function sanitizeIndexedDocument(input) {
  const path = clean(input?.path, 1000).replace(/^\/+/, "");
  if (!path || blocked(path)) return null;
  const modifiedAt = new Date(input?.modifiedAt || 0);
  return {
    id: crypto.createHash("sha256").update(path).digest("hex").slice(0, 24),
    path,
    name: clean(input?.name || path.split("/").pop(), 250),
    type: clean(input?.type || documentType(path), 80),
    size: Math.max(0, Math.min(Number(input?.size) || 0, 100_000_000_000)),
    modifiedAt: Number.isNaN(modifiedAt.getTime()) ? new Date(0).toISOString() : modifiedAt.toISOString(),
    status: "Kun indeks",
    note: "Åpnes privat i Jottacloud. Innlogging hos Jottacloud kreves.",
    source: "jottacloud",
  };
}

function sanitizeUploadedDocument(input, actualBlob, uploadedBy, existing = {}) {
  const id = validDocumentId(existing.id || input?.id);
  const name = clean(input?.name || existing.name, 250);
  const path = clean(existing.path || input?.path || name, 1000).replace(/^\/+/, "");
  const expectedPathname = documentPathname(id, name);
  const actualSize = Number(actualBlob?.size) || 0;
  if (!id || !name || !path || blocked(path) || !expectedPathname || actualBlob?.pathname !== expectedPathname || actualSize > MAX_DOCUMENT_SIZE) return null;
  const modifiedAt = new Date(input?.modifiedAt || existing.modifiedAt || Date.now());
  return {
    ...existing,
    id,
    path,
    name,
    type: clean(existing.type || input?.type || documentType(name), 80),
    size: Math.max(0, actualSize),
    contentType: clean(actualBlob?.contentType || documentContentType(name), 150),
    pathname: actualBlob.pathname,
    modifiedAt: Number.isNaN(modifiedAt.getTime()) ? new Date().toISOString() : modifiedAt.toISOString(),
    uploadedAt: new Date().toISOString(),
    uploadedBy: clean(uploadedBy, 254).toLowerCase(),
    status: "Tilgjengelig",
    note: "Privat fil tilgjengelig for åpning og nedlasting i CRM.",
    source: existing.source || "upload",
  };
}

function mergeDocumentIndex(incoming, existing) {
  const existingById = new Map(existing.map((document) => [document.id, document]));
  const indexed = incoming.map(sanitizeIndexedDocument).filter(Boolean).map((document) => {
    const previous = existingById.get(document.id);
    if (!previous?.pathname) return document;
    return {
      ...document,
      pathname: previous.pathname,
      contentType: previous.contentType,
      uploadedAt: previous.uploadedAt,
      uploadedBy: previous.uploadedBy,
      status: "Tilgjengelig",
      note: "Privat fil tilgjengelig for åpning og nedlasting i CRM.",
    };
  });
  const incomingIds = new Set(indexed.map((document) => document.id));
  return [
    ...indexed,
    ...existing.filter((document) => document.source === "upload" && !incomingIds.has(document.id)),
  ];
}

function publicDocument(document) {
  const downloadable = Boolean(document.pathname);
  const jottaUrl = !downloadable && document.source !== "upload" ? jottacloudDocumentUrl(document.path) : "";
  return {
    id: document.id,
    path: document.path,
    name: document.name,
    type: document.type,
    size: document.size,
    modifiedAt: document.modifiedAt,
    status: downloadable ? "I CRM" : jottaUrl ? "Jottacloud" : "Kun indeks",
    note: downloadable
      ? "Privat fil tilgjengelig for åpning og nedlasting i CRM."
      : jottaUrl
        ? "Åpnes privat i Jottacloud. Innlogging hos Jottacloud kreves."
        : document.note,
    available: Boolean(downloadable || jottaUrl),
    downloadable,
    jottacloudUrl: jottaUrl,
  };
}

module.exports = {
  MAX_DOCUMENT_SIZE,
  SAFE_EXTENSIONS,
  blocked,
  documentContentType,
  documentPathname,
  documentType,
  jottacloudDocumentUrl,
  mergeDocumentIndex,
  publicDocument,
  sanitizeIndexedDocument,
  sanitizeUploadedDocument,
  validDocumentId,
};
