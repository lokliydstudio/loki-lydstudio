const { allowedUsers } = require("./crm-auth");

const ONLINE_WINDOW_MS = 150 * 1000;
const OWNER_NAMES = new Map([
  ["leon@lokilyd.no", "Leon"],
  ["charles@lokilyd.no", "Charles"],
]);

function presenceOwners() {
  const allowed = allowedUsers();
  return [...OWNER_NAMES.entries()]
    .filter(([email]) => allowed.has(email))
    .map(([email, name]) => ({ email, name }));
}

function presenceCollection(email) {
  const owner = presenceOwners().find((item) => item.email === String(email || "").trim().toLowerCase());
  return owner ? `presence-${owner.name.toLowerCase()}` : null;
}

function ownerFor(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return presenceOwners().find((item) => item.email === normalized) || null;
}

function validIso(value, now = new Date()) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime() + 60_000) return "";
  return parsed.toISOString();
}

function presenceHeartbeat(email, existing = {}, now = new Date()) {
  const owner = ownerFor(email);
  if (!owner) return null;
  const timestamp = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(timestamp.getTime())) return null;
  const lastLoginAt = validIso(existing?.lastLoginAt, timestamp) || validIso(existing?.lastSeen, timestamp) || timestamp.toISOString();
  return { email: owner.email, name: owner.name, lastLoginAt, lastSeen: timestamp.toISOString(), online: true };
}

function presenceLogin(email, existing = {}, now = new Date()) {
  const owner = ownerFor(email);
  if (!owner) return null;
  const timestamp = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(timestamp.getTime())) return null;
  return { email: owner.email, name: owner.name, lastLoginAt: timestamp.toISOString(), lastSeen: timestamp.toISOString(), online: true };
}

function presenceOffline(email, existing = {}, now = new Date()) {
  const owner = ownerFor(email);
  if (!owner) return null;
  const timestamp = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(timestamp.getTime())) return null;
  const lastLoginAt = validIso(existing?.lastLoginAt, timestamp) || validIso(existing?.lastSeen, timestamp) || timestamp.toISOString();
  return { email: owner.email, name: owner.name, lastLoginAt, lastSeen: timestamp.toISOString(), online: false };
}

function presenceStatus(records, currentEmail, now = new Date()) {
  const timestamp = now instanceof Date ? now : new Date(now);
  const currentTime = Number.isNaN(timestamp.getTime()) ? Date.now() : timestamp.getTime();
  const normalizedCurrent = String(currentEmail || "").trim().toLowerCase();
  const owners = presenceOwners();
  const permitted = new Set(owners.map((owner) => owner.email));
  const latest = new Map();

  (records || []).forEach((record) => {
    const email = String(record?.email || "").trim().toLowerCase();
    const seen = new Date(record?.lastSeen || "").getTime();
    if (!permitted.has(email) || !Number.isFinite(seen) || seen > currentTime + 60_000) return;
    if (!latest.has(email) || seen > new Date(latest.get(email).lastSeen || "").getTime()) latest.set(email, record);
  });

  return owners.map((owner) => {
    const record = latest.get(owner.email);
    const lastSeen = validIso(record?.lastSeen, timestamp);
    const lastLoginAt = validIso(record?.lastLoginAt, timestamp) || lastSeen;
    const seen = lastSeen ? new Date(lastSeen).getTime() : 0;
    return {
      name: owner.name,
      initial: owner.name.slice(0, 1),
      isCurrent: owner.email === normalizedCurrent,
      online: Boolean(record && record.online !== false && seen >= currentTime - ONLINE_WINDOW_MS),
      lastLoginAt,
      lastSeen,
    };
  });
}

module.exports = {
  ONLINE_WINDOW_MS,
  presenceCollection,
  presenceHeartbeat,
  presenceLogin,
  presenceOffline,
  presenceOwners,
  presenceStatus,
};
