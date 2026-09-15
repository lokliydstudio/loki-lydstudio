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

function presenceHeartbeat(email, now = new Date()) {
  const normalized = String(email || "").trim().toLowerCase();
  const owner = presenceOwners().find((item) => item.email === normalized);
  if (!owner) return null;
  const timestamp = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(timestamp.getTime())) return null;
  return { email: owner.email, name: owner.name, lastSeen: timestamp.toISOString() };
}

function activePresence(records, currentEmail, now = new Date()) {
  const timestamp = now instanceof Date ? now : new Date(now);
  const currentTime = Number.isNaN(timestamp.getTime()) ? Date.now() : timestamp.getTime();
  const normalizedCurrent = String(currentEmail || "").trim().toLowerCase();
  const permitted = new Map(presenceOwners().map((owner) => [owner.email, owner.name]));
  const latest = new Map();

  (records || []).forEach((record) => {
    const email = String(record?.email || "").trim().toLowerCase();
    const seen = new Date(record?.lastSeen || "").getTime();
    if (!permitted.has(email) || !Number.isFinite(seen)) return;
    if (seen < currentTime - ONLINE_WINDOW_MS || seen > currentTime + 60_000) return;
    if (!latest.has(email) || seen > latest.get(email).seen) latest.set(email, { email, seen });
  });

  return [...latest.values()]
    .sort((left, right) => Number(right.email === normalizedCurrent) - Number(left.email === normalizedCurrent) || left.email.localeCompare(right.email))
    .map((record) => ({
      name: permitted.get(record.email),
      initial: permitted.get(record.email).slice(0, 1),
      isCurrent: record.email === normalizedCurrent,
      lastSeen: new Date(record.seen).toISOString(),
    }));
}

module.exports = {
  ONLINE_WINDOW_MS,
  activePresence,
  presenceCollection,
  presenceHeartbeat,
  presenceOwners,
};
