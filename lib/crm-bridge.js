const crypto = require("crypto");

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function bridgeAuthorized(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return safeEqual(token, process.env.JOTTA_BRIDGE_SECRET);
}

module.exports = { bridgeAuthorized, safeEqual };
