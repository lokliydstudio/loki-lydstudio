const crypto = require("crypto");
const { currentUser } = require("../../lib/crm-auth");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");

const BLOCKED_SEGMENTS = new Set([
  "mikser (cloud)",
  "prosjekter (cloud)",
  "passord",
  "password",
  "passwords",
  "innlogging",
  "innlogginger",
  "login",
  "logins",
]);

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function bridgeAuthorized(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return safeEqual(token, process.env.JOTTA_BRIDGE_SECRET);
}

function clean(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

function blocked(pathname) {
  return clean(pathname, 1000)
    .toLowerCase()
    .split(/[\\/]+/)
    .some((part) => BLOCKED_SEGMENTS.has(part));
}

function sanitizeDocument(input) {
  const path = clean(input?.path, 1000).replace(/^\/+/, "");
  if (!path || blocked(path)) return null;
  const modifiedAt = new Date(input?.modifiedAt || 0);
  return {
    id: crypto.createHash("sha256").update(path).digest("hex").slice(0, 24),
    path,
    name: clean(input?.name || path.split("/").pop(), 250),
    type: clean(input?.type || "Dokument", 80),
    size: Math.max(0, Math.min(Number(input?.size) || 0, 100_000_000_000)),
    modifiedAt: Number.isNaN(modifiedAt.getTime()) ? new Date(0).toISOString() : modifiedAt.toISOString(),
    status: "Indeksert",
    note: "Metadata fra skrivebeskyttet Jottacloud-bro. Filinnhold er ikke lastet opp.",
  };
}

module.exports = async function handler(req, res) {
  const user = currentUser(req);
  const bridge = bridgeAuthorized(req);
  if (!user && !bridge) return res.status(401).json({ error: "Innlogging kreves." });
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert ennå." });

  try {
    if (req.method === "GET") {
      if (!user) return res.status(403).json({ error: "Brukerinnlogging kreves." });
      return res.status(200).json({ documents: await readCollection("documents") });
    }
    if (req.method === "POST") {
      if (!bridge) return res.status(403).json({ error: "Ugyldig brotilgang." });
      const input = Array.isArray(req.body?.documents) ? req.body.documents.slice(0, 5000) : [];
      const documents = input.map(sanitizeDocument).filter(Boolean);
      await writeCollection("documents", documents);
      return res.status(200).json({ ok: true, count: documents.length });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Document index storage failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke oppdatere dokumentindeksen." });
  }
};
