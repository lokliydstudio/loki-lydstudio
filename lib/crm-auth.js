const crypto = require("crypto");

const SESSION_COOKIE = "loki_crm_session";
const DEFAULT_USERS = ["leon@lokilyd.no", "charles@lokilyd.no"];

function allowedUsers() {
  return new Set(
    (process.env.CRM_ALLOWED_EMAILS || DEFAULT_USERS.join(","))
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function secret() {
  if (!process.env.CRM_AUTH_SECRET || process.env.CRM_AUTH_SECRET.length < 32) {
    throw new Error("CRM_AUTH_SECRET mangler eller er for kort.");
  }
  return process.env.CRM_AUTH_SECRET;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function createToken(email, purpose, ttlSeconds = 900) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!allowedUsers().has(normalized)) return null;
  const payload = encode({ email: normalized, purpose, expires: Date.now() + ttlSeconds * 1000 });
  return `${payload}.${sign(payload)}`;
}

function createScopedToken(subject, purpose, ttlSeconds = 900) {
  const normalizedSubject = String(subject || "").trim().slice(0, 200);
  const normalizedPurpose = String(purpose || "").trim().slice(0, 80);
  if (!normalizedSubject || !normalizedPurpose) return null;
  const boundedTtl = Math.max(60, Math.min(Number(ttlSeconds) || 900, 60 * 60 * 24 * 90));
  const payload = encode({ subject: normalizedSubject, purpose: normalizedPurpose, expires: Date.now() + boundedTtl * 1000 });
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token, purpose) {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;
    const expected = sign(payload);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.purpose !== purpose || data.expires < Date.now() || !allowedUsers().has(data.email)) return null;
    return data;
  } catch {
    return null;
  }
}

function verifyScopedToken(token, purpose) {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;
    const expected = sign(payload);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.purpose !== purpose || data.expires < Date.now() || !data.subject) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((item) => item.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, ...value]) => [key, decodeURIComponent(value.join("="))]),
  );
}

function currentUser(req) {
  const session = verifyToken(parseCookies(req)[SESSION_COOKIE], "session");
  return session ? { email: session.email } : null;
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (user) return user;
  res.status(401).json({ error: "Innlogging kreves." });
  return null;
}

function sessionCookie(email) {
  const token = createToken(email, "session", 60 * 60 * 12);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

module.exports = { allowedUsers, clearSessionCookie, createScopedToken, createToken, currentUser, requireUser, sessionCookie, verifyScopedToken, verifyToken };
