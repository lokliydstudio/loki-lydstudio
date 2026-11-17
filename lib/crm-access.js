const { clearSessionCookie, currentUser } = require("./crm-auth");
const { isConfigured, isMissingBlobError, readCollection } = require("./crm-store");

const COLLECTION = "crm-access";
const OWNERS = [
  { id: "leon@lokilyd.no", email: "leon@lokilyd.no", name: "Leon Frick", role: "owner", status: "active", fixed: true },
  { id: "charles@lokilyd.no", email: "charles@lokilyd.no", name: "Charles Wise", role: "owner", status: "active", fixed: true },
];

const ROLE_DEFINITIONS = Object.freeze({
  owner: {
    label: "Eier",
    description: "Full tilgang, inkludert brukere, roller, integrasjoner og sikkerhetsinnstillinger.",
    permissions: ["read", "write", "delete", "export", "manageUsers", "manageIntegrations"],
  },
  admin: {
    label: "Administrator",
    description: "Kan lese, opprette, endre, slette og eksportere CRM-data, men ikke administrere brukere.",
    permissions: ["read", "write", "delete", "export"],
  },
  member: {
    label: "Medarbeider",
    description: "Kan lese, opprette og redigere innhold. Sletting og full eksport er begrenset.",
    permissions: ["read", "write"],
  },
  viewer: {
    label: "Lesetilgang",
    description: "Kan se CRM-innhold, men ikke opprette, endre, sende eller slette noe.",
    permissions: ["read"],
  },
});

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : "";
}

function cleanName(value, email = "") {
  const name = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  if (name) return name;
  return String(email).split("@")[0].replace(/[._-]+/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()).slice(0, 100);
}

function validRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ["admin", "member", "viewer"].includes(role) ? role : "";
}

function ownerFor(value) {
  const email = normalizeEmail(value);
  return OWNERS.find((owner) => owner.email === email) || null;
}

function publicAccess(record) {
  if (!record || !ROLE_DEFINITIONS[record.role]) return null;
  return {
    id: record.id || record.email,
    email: record.email,
    name: cleanName(record.name, record.email),
    role: record.role,
    roleLabel: ROLE_DEFINITIONS[record.role].label,
    permissions: [...ROLE_DEFINITIONS[record.role].permissions],
    status: record.status || "active",
    fixed: Boolean(record.fixed),
  };
}

async function readAccessRecords() {
  if (!isConfigured()) return [];
  try {
    return await readCollection(COLLECTION);
  } catch (error) {
    if (isMissingBlobError(error)) return [];
    throw error;
  }
}

async function resolveCrmAccess(value) {
  const email = normalizeEmail(value);
  if (!email) return null;
  const owner = ownerFor(email);
  if (owner) return publicAccess(owner);
  const records = await readAccessRecords();
  const user = records.find((record) => record.kind === "user" && record.email === email && record.status === "active");
  return user ? publicAccess(user) : null;
}

function hasPermission(access, permission) {
  return Boolean(access?.permissions?.includes(permission));
}

async function requireCrmAccess(req, res, permission = "read") {
  const session = currentUser(req);
  if (!session) {
    res.status(401).json({ error: "Innlogging kreves." });
    return null;
  }
  const access = await resolveCrmAccess(session.email);
  if (!access) {
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.status(403).json({ error: "CRM-tilgangen er deaktivert." });
    return null;
  }
  if (permission && !hasPermission(access, permission)) {
    res.status(403).json({ error: permission === "write" ? "Du har bare lesetilgang." : "Rollen din har ikke tilgang til denne handlingen." });
    return null;
  }
  req.crmAccess = access;
  return access;
}

module.exports = {
  COLLECTION,
  OWNERS,
  ROLE_DEFINITIONS,
  cleanName,
  hasPermission,
  normalizeEmail,
  ownerFor,
  publicAccess,
  readAccessRecords,
  requireCrmAccess,
  resolveCrmAccess,
  validRole,
};
