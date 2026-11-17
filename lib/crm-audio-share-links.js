const crypto = require("crypto");

const COLLECTION = "audio-share-links";
const MAX_ACTIVE_LINKS = 2000;
const LINK_KINDS = new Set(["track", "playlist"]);

function projectSlug(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "o")
    .replace(/[å]/g, "a")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return normalized || "lydleveranse";
}

function secureSuffix() {
  return crypto.randomBytes(9).toString("base64url");
}

function sanitizeAudioShareLink(value = {}) {
  const kind = LINK_KINDS.has(value.kind) ? value.kind : "";
  const slug = String(value.slug || "").trim().slice(0, 90);
  const subjectId = String(value.subjectId || "").trim().slice(0, 120);
  const expiresTime = Date.parse(value.expiresAt);
  const createdTime = Date.parse(value.createdAt);
  if (!kind || !/^[a-z0-9][a-z0-9-]*-[A-Za-z0-9_-]{12}$/.test(slug) || !subjectId || !Number.isFinite(expiresTime)) return null;
  return {
    id: String(value.id || "").trim().slice(0, 120) || `share-${crypto.randomUUID()}`,
    slug,
    kind,
    subjectId,
    createdAt: new Date(Number.isFinite(createdTime) ? createdTime : Date.now()).toISOString(),
    expiresAt: new Date(expiresTime).toISOString(),
    createdBy: String(value.createdBy || "").trim().toLowerCase().slice(0, 160),
  };
}

function addAudioShareLink(items, input, options = {}) {
  const now = Number(options.now) || Date.now();
  const expiresTime = Date.parse(input.expiresAt);
  if (!LINK_KINDS.has(input.kind) || !String(input.subjectId || "").trim() || !Number.isFinite(expiresTime) || expiresTime <= now) {
    throw new Error("Ugyldig kort lyttelenke.");
  }
  const expiresAt = new Date(expiresTime).toISOString();

  const active = (Array.isArray(items) ? items : [])
    .map(sanitizeAudioShareLink)
    .filter((item) => item && Date.parse(item.expiresAt) > now);
  const suffix = String(options.suffix || secureSuffix());
  if (!/^[A-Za-z0-9_-]{12}$/.test(suffix)) throw new Error("Ugyldig sikker lenkekode.");
  const slug = `${projectSlug(input.projectName)}-${suffix}`;
  if (active.some((item) => item.slug === slug)) throw new Error("Lenkekoden finnes allerede. Prøv igjen.");

  const record = sanitizeAudioShareLink({
    id: `share-${crypto.randomUUID()}`,
    slug,
    kind: input.kind,
    subjectId: input.subjectId,
    createdAt: new Date(now).toISOString(),
    expiresAt,
    createdBy: input.createdBy,
  });
  return { record, items: [record, ...active].slice(0, MAX_ACTIVE_LINKS) };
}

function resolveAudioShareLink(items, slug, now = Date.now()) {
  const normalizedSlug = String(slug || "").trim();
  if (!normalizedSlug || normalizedSlug.length > 90) return null;
  return (Array.isArray(items) ? items : [])
    .map(sanitizeAudioShareLink)
    .find((item) => item && item.slug === normalizedSlug && Date.parse(item.expiresAt) > now) || null;
}

module.exports = {
  COLLECTION,
  MAX_ACTIVE_LINKS,
  addAudioShareLink,
  projectSlug,
  resolveAudioShareLink,
  sanitizeAudioShareLink,
};
