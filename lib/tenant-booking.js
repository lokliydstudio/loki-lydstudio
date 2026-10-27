const crypto = require("crypto");

const STUDIOS = new Set(["Studio C", "Studio D"]);
// Use digests so personal booking addresses are not published in the website repository.
const STAFF_BOOKING_EMAIL_HASHES = new Set([
  "690c92c8dfba7e7c5de9bd29e3a08737d2a2d5e5bd923b8fc21906d0acf53697",
  "abb2579802ed8c20cf63f3b4cb4cacca7e18ca63f2bf3627979bc3181b2c91b4",
  "611f4066f79ed8e86d6af2f23adbe07c55f8e277b6b7e1e7391f955bdbce360f",
  "6c7147b46e8be805a5932d75f01b9a107f59fc79edeccae063b75d4afd185b9a",
]);
const ACCOUNT_STATUSES = new Set(["pending", "approved", "rejected", "suspended"]);
const SESSION_COOKIE = "loki_booking_session";
const CHALLENGE_COOKIE = "loki_booking_challenge";
// Browsers cap persistent cookies at about 400 days. Renew on each authenticated visit.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

function cleanText(value, max = 300) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanLongText(value, max = 2000) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().slice(0, max);
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanDate(value) {
  const date = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}

function cleanTime(value) {
  const time = cleanText(value, 5);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "";
}

function cleanStudio(value) {
  const studio = cleanText(value, 20);
  return STUDIOS.has(studio) ? studio : "";
}

function safeId(value, prefix) {
  const id = cleanText(value, 120);
  return /^[a-z0-9-]+$/i.test(id) ? id : `${prefix}-${crypto.randomUUID()}`;
}

function sanitizeAccount(input = {}, existing = {}) {
  const name = cleanText(input.name ?? existing.name, 160);
  const email = cleanEmail(input.email ?? existing.email);
  const studio = cleanStudio(input.studio ?? existing.studio);
  const requestedStatus = cleanText(input.status ?? existing.status ?? "pending", 20).toLowerCase();
  if (!name || !email || !studio) return null;
  return {
    id: safeId(existing.id || input.id, "tenant"),
    name,
    email,
    studio,
    status: ACCOUNT_STATUSES.has(requestedStatus) ? requestedStatus : "pending",
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    approvedAt: existing.approvedAt || "",
    approvedBy: cleanEmail(existing.approvedBy),
    lastLoginAt: existing.lastLoginAt || "",
    emailOnNewBooking: existing.emailOnNewBooking === true,
    sessionVersion: Number.isSafeInteger(existing.sessionVersion) && existing.sessionVersion >= 0 ? existing.sessionVersion : 0,
  };
}

function publicAccount(account, { admin = false } = {}) {
  const base = {
    id: account.id,
    name: account.name,
    email: account.email,
    studio: account.studio,
    status: account.status,
    emailOnNewBooking: account.emailOnNewBooking === true,
  };
  return admin ? {
    ...base,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    approvedAt: account.approvedAt,
    approvedBy: account.approvedBy,
    lastLoginAt: account.lastLoginAt,
  } : base;
}

function sanitizeBooking(input = {}, account = {}, existing = {}) {
  const title = cleanText(input.title ?? existing.title, 180);
  const date = cleanDate(input.date ?? existing.date);
  const startTime = cleanTime(input.startTime ?? existing.startTime);
  const endTime = cleanTime(input.endTime ?? existing.endTime);
  const studio = cleanStudio(account.studio || existing.studio);
  if (!title || !date || !startTime || !endTime || endTime <= startTime || !studio || !account.id) return null;
  return {
    id: safeId(existing.id || input.id, "rental-booking"),
    studio,
    title,
    date,
    startTime,
    endTime,
    notes: cleanLongText(input.notes ?? existing.notes, 2000),
    createdById: account.id,
    createdByName: cleanText(account.name, 160),
    createdByEmail: cleanEmail(account.email),
    createdAt: existing.createdAt || new Date().toISOString(),
  };
}

function bookingOwnedByAccount(booking, account) {
  return Boolean(
    booking?.createdById
    && account?.id
    && booking.createdById === account.id
    && booking.studio === account.studio
  );
}

function isStaffBooking(booking) {
  const email = cleanEmail(booking?.createdByEmail);
  return Boolean(email && STAFF_BOOKING_EMAIL_HASHES.has(crypto.createHash("sha256").update(email).digest("hex")));
}

function publicBooking(booking, account) {
  return {
    id: booking.id,
    studio: booking.studio,
    title: booking.title,
    date: booking.date,
    startTime: booking.startTime,
    endTime: booking.endTime,
    notes: booking.notes || "",
    createdByName: booking.createdByName,
    createdAt: booking.createdAt,
    editable: bookingOwnedByAccount(booking, account),
    staffBooking: isStaffBooking(booking),
  };
}

function bookingConflict(bookings, candidate) {
  if (!candidate) return null;
  return (bookings || []).find((booking) => (
    booking.id !== candidate.id
    && booking.studio === candidate.studio
    && booking.date === candidate.date
    && candidate.startTime < booking.endTime
    && candidate.endTime > booking.startTime
  )) || null;
}

function bookingNotificationRecipients(accounts, booking) {
  return (accounts || []).filter((account) => (
    account.status === "approved"
    && account.studio === booking.studio
    && account.emailOnNewBooking === true
    && cleanEmail(account.email)
  ));
}

function editBooking(bookings, id, changes, actor, { admin = false, today = "" } = {}) {
  const index = bookings.findIndex((item) => item.id === id && (admin || item.studio === actor.studio));
  if (index < 0) return { error: { status: 404, message: "Bookingen ble ikke funnet." } };
  const previous = bookings[index];
  if (!admin && !bookingOwnedByAccount(previous, actor)) {
    return { error: { status: 403, message: "Du kan bare redigere dine egne bookinger." } };
  }
  // Keep the original creator and studio even when an administrator edits the booking.
  const creator = { id: previous.createdById, name: previous.createdByName, email: previous.createdByEmail, studio: previous.studio };
  const booking = sanitizeBooking(changes, creator, previous);
  if (!booking) return { error: { status: 400, message: "Fyll ut tittel, dato og et gyldig tidsrom." } };
  if (today && booking.date < today) return { error: { status: 400, message: "Du kan ikke flytte en booking tilbake i tid." } };
  const conflict = bookingConflict(bookings, booking);
  if (conflict) return { error: { status: 409, message: `Tiden overlapper med «${conflict.title}» (${conflict.startTime}–${conflict.endTime}).` } };
  const items = [...bookings];
  items[index] = booking;
  return { items, result: booking };
}

function deleteBooking(bookings, id, actor, { admin = false } = {}) {
  const index = bookings.findIndex((item) => item.id === id && (admin || item.studio === actor.studio));
  if (index < 0) return { error: { status: 404, message: "Bookingen ble ikke funnet." } };
  const booking = bookings[index];
  if (!admin && !bookingOwnedByAccount(booking, actor)) {
    return { error: { status: 403, message: "Du kan bare slette bookinger du selv har opprettet." } };
  }
  return { items: bookings.filter((_, itemIndex) => itemIndex !== index), result: booking };
}

function secret() {
  const value = String(process.env.CRM_AUTH_SECRET || "");
  if (value.length < 32) throw new Error("CRM_AUTH_SECRET mangler eller er for kort.");
  return value;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signature(payload) {
  return crypto.createHmac("sha256", secret()).update(`tenant-booking:${payload}`).digest("base64url");
}

function signedToken(payload) {
  const encoded = encode(payload);
  return `${encoded}.${signature(encoded)}`;
}

function verifySignedToken(token, purpose) {
  try {
    const [payload, supplied] = String(token || "").split(".");
    if (!payload || !supplied) return null;
    const expected = signature(payload);
    const left = Buffer.from(supplied);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.purpose !== purpose || data.expires < Date.now() || !data.accountId) return null;
    return data;
  } catch {
    return null;
  }
}

function codeForChallenge(token) {
  const digest = crypto.createHmac("sha256", secret()).update(`tenant-code:${token}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

function createLoginChallenge(account, ttlSeconds = 15 * 60) {
  if (!account?.id || account.status !== "approved") return null;
  const token = signedToken({
    purpose: "tenant-login",
    accountId: account.id,
    email: account.email,
    studio: account.studio,
    sessionVersion: account.sessionVersion || 0,
    nonce: crypto.randomBytes(18).toString("base64url"),
    expires: Date.now() + ttlSeconds * 1000,
  });
  return { token, code: codeForChallenge(token) };
}

function createSessionToken(account, ttlSeconds = SESSION_MAX_AGE_SECONDS) {
  return signedToken({
    purpose: "tenant-session",
    accountId: account.id,
    email: account.email,
    studio: account.studio,
    sessionVersion: account.sessionVersion || 0,
    expires: Date.now() + ttlSeconds * 1000,
  });
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers?.cookie || "")
      .split(";")
      .map((item) => item.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, ...value]) => [key, decodeURIComponent(value.join("="))]),
  );
}

function challengeFromRequest(req) {
  return verifySignedToken(parseCookies(req)[CHALLENGE_COOKIE], "tenant-login");
}

function sessionFromRequest(req) {
  return verifySignedToken(parseCookies(req)[SESSION_COOKIE], "tenant-session");
}

function verifyLoginCode(req, email, code) {
  const token = parseCookies(req)[CHALLENGE_COOKIE];
  const challenge = verifySignedToken(token, "tenant-login");
  const normalizedCode = String(code || "").replace(/\D/g, "");
  if (!challenge || challenge.email !== cleanEmail(email) || normalizedCode.length !== 6) return null;
  const expected = codeForChallenge(token);
  const left = Buffer.from(normalizedCode);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right) ? challenge : null;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function challengeCookie(token) {
  return cookie(CHALLENGE_COOKIE, token, 900);
}

function sessionCookie(account) {
  return cookie(SESSION_COOKIE, createSessionToken(account), SESSION_MAX_AGE_SECONDS);
}

function clearChallengeCookie() {
  return cookie(CHALLENGE_COOKIE, "", 0);
}

function clearSessionCookie() {
  return cookie(SESSION_COOKIE, "", 0);
}

module.exports = {
  ACCOUNT_STATUSES,
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  STUDIOS,
  bookingConflict,
  bookingNotificationRecipients,
  deleteBooking,
  editBooking,
  bookingOwnedByAccount,
  isStaffBooking,
  challengeCookie,
  challengeFromRequest,
  cleanEmail,
  cleanStudio,
  clearChallengeCookie,
  clearSessionCookie,
  createLoginChallenge,
  createSessionToken,
  publicAccount,
  publicBooking,
  sanitizeAccount,
  sanitizeBooking,
  sessionCookie,
  sessionFromRequest,
  verifyLoginCode,
  verifySignedToken,
};
