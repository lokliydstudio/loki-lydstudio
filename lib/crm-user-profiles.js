const MAX_PROFILE_AVATAR_SIZE = 5 * 1024 * 1024;
const PROFILE_AVATAR_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PROFILE_AVATAR_EXTENSIONS = new Set([".jpeg", ".jpg", ".png", ".webp"]);
const OWNERS = [
  { email: "leon@lokilyd.no", name: "Leon", slug: "leon", initial: "L" },
  { email: "charles@lokilyd.no", name: "Charles", slug: "charles", initial: "C" },
];

function cleanText(value, max = 250) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function ownerProfile(value) {
  const normalized = cleanText(value, 254).toLowerCase();
  return OWNERS.find((owner) => owner.email === normalized || owner.slug === normalized) || null;
}

function safeProfileAvatarFilename(value) {
  const cleaned = cleanText(value, 160)
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/^\.+/, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const extension = cleaned.includes(".") ? `.${cleaned.split(".").pop().toLowerCase()}` : "";
  if (!PROFILE_AVATAR_EXTENSIONS.has(extension)) return "";
  return cleaned;
}

function profileAvatarPathname(email, avatarId, filename) {
  const owner = ownerProfile(email);
  const id = cleanText(avatarId, 80);
  const name = safeProfileAvatarFilename(filename);
  if (!owner || !/^avatar-[0-9a-f-]{36}$/.test(id) || !name) return "";
  return `loki-crm/profile-avatars/${owner.slug}/${id}/${name}`;
}

function isProfileAvatarContentType(value) {
  return PROFILE_AVATAR_CONTENT_TYPES.includes(String(value || "").split(";")[0].toLowerCase());
}

function contentTypeMatchesFilename(contentType, filename) {
  const extension = `.${String(filename || "").split(".").pop().toLowerCase()}`;
  const expected = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : PROFILE_AVATAR_EXTENSIONS.has(extension) ? "image/jpeg" : "";
  return Boolean(expected && expected === contentType);
}

function sanitizeUserProfile(input, actualBlob, userEmail, existing = {}) {
  const owner = ownerProfile(userEmail);
  const avatarId = cleanText(input?.avatarId || existing.avatarId, 80);
  const filename = safeProfileAvatarFilename(input?.filename || existing.filename);
  const expectedPathname = profileAvatarPathname(owner?.email, avatarId, filename);
  const size = Number(actualBlob?.size ?? existing.size ?? 0);
  const contentType = String(actualBlob?.contentType || existing.contentType || "").split(";")[0].toLowerCase();
  if (!owner || !expectedPathname || (actualBlob && actualBlob.pathname !== expectedPathname)) return null;
  if (!isProfileAvatarContentType(contentType) || !contentTypeMatchesFilename(contentType, filename) || size <= 0 || size > MAX_PROFILE_AVATAR_SIZE) return null;
  const now = new Date().toISOString();
  return {
    email: owner.email,
    name: owner.name,
    avatarId,
    filename,
    pathname: expectedPathname,
    contentType,
    size,
    uploadedAt: existing.uploadedAt || now,
    updatedAt: now,
  };
}

function publicUserProfiles(records, currentEmail = "") {
  const current = ownerProfile(currentEmail);
  return OWNERS.map((owner) => {
    const record = (records || []).find((item) => cleanText(item?.email, 254).toLowerCase() === owner.email);
    const hasAvatar = Boolean(record && profileAvatarPathname(owner.email, record.avatarId, record.filename) === record.pathname);
    return {
      name: owner.name,
      initial: owner.initial,
      isCurrent: owner.email === current?.email,
      hasAvatar,
      avatarUrl: hasAvatar ? `/api/studio?action=profile-avatar-stream&owner=${owner.slug}&v=${encodeURIComponent(record.updatedAt || "")}` : "",
      updatedAt: hasAvatar ? cleanText(record.updatedAt, 40) : "",
    };
  });
}

module.exports = {
  MAX_PROFILE_AVATAR_SIZE,
  PROFILE_AVATAR_CONTENT_TYPES,
  OWNERS,
  isProfileAvatarContentType,
  ownerProfile,
  profileAvatarPathname,
  publicUserProfiles,
  safeProfileAvatarFilename,
  sanitizeUserProfile,
};
