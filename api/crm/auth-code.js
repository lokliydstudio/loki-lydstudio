const {
  clearLoginChallengeCookie,
  sessionCookie,
  verifyLoginCode,
} = require("../../lib/crm-auth");
const { presenceCollection, presenceLogin } = require("../../lib/crm-presence");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");

const attempts = new Map();
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function attemptKey(req, email) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0];
  return `${ip}:${String(email || "").trim().toLowerCase()}`;
}

function failedAttempt(key) {
  const now = Date.now();
  const current = attempts.get(key);
  const next = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + ATTEMPT_WINDOW_MS }
    : { ...current, count: current.count + 1 };
  attempts.set(key, next);
  return next.count;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const email = String(req.body?.email || "").trim().toLowerCase();
  const key = attemptKey(req, email);
  const current = attempts.get(key);
  if (current?.resetAt > Date.now() && current.count >= MAX_ATTEMPTS) {
    res.setHeader("Set-Cookie", clearLoginChallengeCookie());
    return res.status(429).json({ error: "For mange forsøk. Be om en ny kode." });
  }

  const data = verifyLoginCode(req, email, req.body?.code);
  if (!data) {
    const count = failedAttempt(key);
    if (count >= MAX_ATTEMPTS) res.setHeader("Set-Cookie", clearLoginChallengeCookie());
    return res.status(401).json({
      error: count >= MAX_ATTEMPTS
        ? "For mange forsøk. Be om en ny kode."
        : "Koden er ugyldig eller utløpt.",
    });
  }

  attempts.delete(key);
  if (isConfigured()) {
    try {
      const collection = presenceCollection(data.email);
      if (collection) {
        const existing = (await readCollection(collection))[0] || {};
        await writeCollection(collection, [presenceLogin(data.email, existing)]);
      }
    } catch (error) {
      console.error("Could not record CRM code login", error?.message);
    }
  }

  res.setHeader("Set-Cookie", [sessionCookie(data.email), clearLoginChallengeCookie()]);
  return res.status(200).json({ ok: true, user: { email: data.email } });
};

module.exports._test = { failedAttempt };
