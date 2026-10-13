const crypto = require("crypto");

const MAX_PROJECT_IMAGE_SIZE = 20 * 1024 * 1024;
const PROJECT_IMAGE_CONTENT_TYPES = [
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
];
const PROJECT_IMAGE_EXTENSIONS = new Set([".heic", ".heif", ".jpeg", ".jpg", ".png", ".webp"]);

function cleanText(value, max = 250) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeProjectImageFilename(value) {
  const cleaned = cleanText(value, 180)
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/^\.+/, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const extension = cleaned.includes(".") ? `.${cleaned.split(".").pop().toLowerCase()}` : "";
  if (!PROJECT_IMAGE_EXTENSIONS.has(extension)) return "";
  return cleaned;
}

function projectImagePathname(imageId, filename) {
  const id = cleanText(imageId, 90);
  const name = safeProjectImageFilename(filename);
  if (!/^project-image-[0-9a-f-]{36}$/.test(id) || !name) return "";
  return `loki-crm/project-images/${id}/${name}`;
}

function isProjectImageContentType(value) {
  return PROJECT_IMAGE_CONTENT_TYPES.includes(String(value || "").split(";")[0].toLowerCase());
}

function newProjectImageId() {
  return `project-image-${crypto.randomUUID()}`;
}

function sanitizeProjectImage(input, actualBlob, userEmail, existing = {}) {
  const id = cleanText(existing.id || input?.id, 90);
  const filename = safeProjectImageFilename(existing.filename || input?.filename);
  const expectedPathname = projectImagePathname(id, filename);
  const size = Number(actualBlob?.size ?? existing.size ?? 0);
  const contentType = String(actualBlob?.contentType || existing.contentType || "").split(";")[0].toLowerCase();
  if (!expectedPathname || (actualBlob && actualBlob.pathname !== expectedPathname)) return null;
  if (!isProjectImageContentType(contentType) || size <= 0 || size > MAX_PROJECT_IMAGE_SIZE) return null;
  const now = new Date().toISOString();

  return {
    id,
    projectId: cleanText(existing.projectId || input?.projectId, 120),
    filename,
    pathname: expectedPathname,
    contentType,
    size,
    gear: cleanText(input?.gear ?? existing.gear, 160),
    chainPosition: cleanText(input?.chainPosition ?? existing.chainPosition, 160),
    settings: cleanText(input?.settings ?? existing.settings, 1000),
    notes: cleanText(input?.notes ?? existing.notes, 1000),
    uploadedAt: existing.uploadedAt || now,
    updatedAt: now,
    uploadedBy: cleanText(existing.uploadedBy || userEmail, 254).toLowerCase(),
  };
}

function publicProjectImage(image) {
  return {
    id: image.id,
    projectId: image.projectId,
    filename: image.filename,
    contentType: image.contentType,
    size: Number(image.size) || 0,
    gear: image.gear,
    chainPosition: image.chainPosition,
    settings: image.settings,
    notes: image.notes,
    uploadedAt: image.uploadedAt,
    updatedAt: image.updatedAt,
  };
}

module.exports = {
  MAX_PROJECT_IMAGE_SIZE,
  PROJECT_IMAGE_CONTENT_TYPES,
  isProjectImageContentType,
  newProjectImageId,
  projectImagePathname,
  publicProjectImage,
  safeProjectImageFilename,
  sanitizeProjectImage,
};
