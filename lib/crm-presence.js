const crypto = require("crypto");

const ONLINE_WINDOW_MS = 150 * 1000;
const OWNER_NAMES = new Map([
  ["leon@lokilyd.no", "Leon"],
  ["charles@lokilyd.no", "Charles"],
]);

function presenceOwners() {
  return [...OWNER_NAMES.entries()].map(([email, name]) => ({ email, name }));
}

function presenceCollection(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const owner = presenceOwners().find((item) => item.email === normalized);
  if (owner) return `presence-${owner.name.toLowerCase()}`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return `presence-user-${crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 20)}`;
}

function identityFor(email, name = "") {
  const normalized = String(email || "").trim().toLowerCase();
  const owner = presenceOwners().find((item) => item.email === normalized);
  if (owner) return owner;
  if (!presenceCollection(normalized)) return null;
  const fallback = normalized.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  return { email: normalized, name: String(name || fallback).replace(/\s+/g, " ").trim().slice(0, 100) || "Bruker" };
}

function validIso(value, now = new Date()) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime() + 60_000) return "";
  return parsed.toISOString();
}

function presenceHeartbeat(email, existing = {}, now = new Date(), name = "") {
  const owner = identityFor(email, name);
  if (!owner) return null;
  const timestamp = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(timestamp.getTime())) return null;
  const lastLoginAt = validIso(existing?.lastLoginAt, timestamp) || validIso(existing?.lastSeen, timestamp) || timestamp.toISOString();
  return { email: owner.email, name: owner.name, lastLoginAt, lastSeen: timestamp.toISOString(), online: true };
}

function presenceLogin(email, existing = {}, now = new Date(), name = "") {
  const owner = identityFor(email, name);
  if (!owner) return null;
  const timestamp = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(timestamp.getTime())) return null;
  return { email: owner.email, name: owner.name, lastLoginAt: timestamp.toISOString(), lastSeen: timestamp.toISOString(), online: true };
}

function presenceOffline(email, existing = {}, now = new Date(), name = "") {
  const owner = identityFor(email, name);
  if (!owner) return null;
  const timestamp = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(timestamp.getTime())) return null;
  const lastLoginAt = validIso(existing?.lastLoginAt, timestamp) || validIso(existing?.lastSeen, timestamp) || timestamp.toISOString();
  return { email: owner.email, name: owner.name, lastLoginAt, lastSeen: timestamp.toISOString(), online: false };
}

function presenceStatus(records, currentEmail, now = new Date(), members = presenceOwners()) {
  const timestamp = now instanceof Date ? now : new Date(now);
  const currentTime = Number.isNaN(timestamp.getTime()) ? Date.now() : timestamp.getTime();
  const normalizedCurrent = String(currentEmail || "").trim().toLowerCase();
  const owners = (members || []).map((member) => identityFor(member.email, member.name)).filter(Boolean);
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
