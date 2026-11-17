const crypto = require("crypto");
const { createScopedToken, verifyScopedToken } = require("./crm-auth");
const {
  COLLECTION,
  OWNERS,
  ROLE_DEFINITIONS,
  cleanName,
  normalizeEmail,
  publicAccess,
  readAccessRecords,
  requireCrmAccess,
  validRole,
} = require("./crm-access");
const { sendMail } = require("./crm-mail");
const { isConfigured, mutateCollection } = require("./crm-store");

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

function cleanText(value, max = 200) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function inviteStatus(invite) {
  if (invite.status !== "pending") return invite.status;
  return new Date(invite.expiresAt || 0).getTime() <= Date.now() ? "expired" : "pending";
}

function publicInvite(invite) {
  return {
    id: invite.id,
    email: invite.email,
    name: invite.name,
    role: invite.role,
    roleLabel: ROLE_DEFINITIONS[invite.role]?.label || invite.role,
    status: inviteStatus(invite),
    invitedBy: invite.invitedBy,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt || "",
  };
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function baseUrl(req) {
  const configured = String(process.env.CRM_BASE_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const host = req.headers["x-forwarded-host"] || req.headers.host || "www.lokilyd.no";
  return `${req.headers["x-forwarded-proto"] || "https"}://${host}`;
}

async function sendInvitation(req, invite, inviter) {
  const token = createScopedToken(invite.id, "crm-invite", INVITE_TTL_SECONDS);
  const link = `${baseUrl(req)}/crm-invite/?token=${encodeURIComponent(token)}`;
  const role = ROLE_DEFINITIONS[invite.role];
  const recipient = invite.name || invite.email;
  await sendMail({
    from: `Loki Studio <${process.env.MAIL_ADDRESS}>`,
    replyTo: process.env.MAIL_ADDRESS,
    to: invite.email,
    subject: `${inviter.name} inviterer deg til Loki CRM`,
    text: `Hei ${recipient},\n\n${inviter.name} har invitert deg til Loki Studio CRM som ${role.label.toLowerCase()}.\n\n${role.description}\n\nGodta invitasjonen her:\n${link}\n\nInvitasjonen er gyldig i 7 dager. Du logger deretter inn med en engangskode som sendes til ${invite.email}.`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#17201d;line-height:1.6"><p>Hei ${escapeHtml(recipient)},</p><p><strong>${escapeHtml(inviter.name)}</strong> har invitert deg til Loki Studio CRM som <strong>${escapeHtml(role.label)}</strong>.</p><p style="color:#5f6965">${escapeHtml(role.description)}</p><p style="margin:26px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#365f55;color:#fff;font-weight:700;text-decoration:none">Godta invitasjonen</a></p><p style="color:#6e7773;font-size:12px">Invitasjonen er gyldig i 7 dager. Du logger deretter inn med en engangskode som sendes til ${escapeHtml(invite.email)}.</p></div>`,
  });
  return link;
}

async function acceptInvitation(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const data = verifyScopedToken(req.body?.token, "crm-invite");
  if (!data) return res.status(400).json({ error: "Invitasjonen er ugyldig eller utløpt." });
  const now = new Date().toISOString();
  const mutation = await mutateCollection(COLLECTION, (records) => {
    const index = records.findIndex((record) => record.kind === "invite" && record.id === data.subject);
    if (index < 0) return { error: "Invitasjonen ble ikke funnet." };
    const invite = records[index];
    if (invite.status === "accepted") {
      return { items: records, result: { email: invite.email, name: invite.name, alreadyAccepted: true } };
    }
    if (invite.status !== "pending" || new Date(invite.expiresAt || 0).getTime() <= Date.now()) {
      return { error: "Invitasjonen er ikke lenger aktiv." };
    }
    const role = validRole(invite.role);
    const email = normalizeEmail(invite.email);
    if (!role || !email) return { error: "Invitasjonen inneholder ugyldig tilgang." };
    const userIndex = records.findIndex((record) => record.kind === "user" && record.email === email);
    const existing = userIndex >= 0 ? records[userIndex] : {};
    const user = {
      kind: "user",
      id: existing.id || crypto.randomUUID(),
      email,
      name: cleanName(invite.name, email),
      role,
      status: "active",
      invitedBy: invite.invitedBy,
      invitedAt: invite.createdAt,
      acceptedAt: existing.acceptedAt || now,
      updatedAt: now,
    };
    const next = [...records];
    if (userIndex >= 0) next[userIndex] = user;
    else next.push(user);
    next[index] = { ...invite, status: "accepted", acceptedAt: now, updatedAt: now };
    return { items: next, result: { email, name: user.name, alreadyAccepted: false } };
  });
  if (mutation.error) return res.status(400).json({ error: mutation.error });
  return res.status(200).json({ ok: true, ...mutation.result });
}

async function listAccess(res) {
  const records = await readAccessRecords();
  const users = [
    ...OWNERS.map(publicAccess),
    ...records.filter((record) => record.kind === "user").map(publicAccess).filter(Boolean),
  ];
  const invites = records.filter((record) => record.kind === "invite" && inviteStatus(record) !== "accepted").map(publicInvite);
  return res.status(200).json({
    users,
    invites,
    roles: Object.entries(ROLE_DEFINITIONS).filter(([key]) => key !== "owner").map(([id, value]) => ({ id, ...value })),
  });
}

async function inviteUser(req, res, owner) {
  const email = normalizeEmail(req.body?.email);
  const role = validRole(req.body?.role);
  const name = cleanName(req.body?.name, email);
  if (!email || !role) return res.status(400).json({ error: "Oppgi en gyldig e-postadresse og rolle." });
  if (OWNERS.some((item) => item.email === email)) return res.status(409).json({ error: "Denne brukeren er allerede eier." });
  const now = new Date();
  const invite = {
    kind: "invite",
    id: crypto.randomUUID(),
    email,
    name,
    role,
    status: "pending",
    invitedBy: owner.email,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + INVITE_TTL_SECONDS * 1000).toISOString(),
    updatedAt: now.toISOString(),
  };
  const mutation = await mutateCollection(COLLECTION, (records) => {
    const active = records.find((record) => record.kind === "user" && record.email === email && record.status === "active");
    if (active) return { error: "Brukeren har allerede aktiv tilgang." };
    const pending = records.find((record) => record.kind === "invite" && record.email === email && inviteStatus(record) === "pending");
    if (pending) return { error: "Det finnes allerede en aktiv invitasjon til denne adressen." };
    return { items: [...records, invite], result: invite };
  });
  if (mutation.error) return res.status(409).json({ error: mutation.error });
  try {
    await sendInvitation(req, invite, owner);
  } catch (error) {
    console.error("CRM invitation email failed", error?.message);
    return res.status(502).json({ error: "Invitasjonen ble lagret, men e-posten kunne ikke sendes. Prøv «Send på nytt»." });
  }
  return res.status(201).json({ invite: publicInvite(invite) });
}

async function resendInvitation(req, res, owner) {
  const id = cleanText(req.body?.id, 80);
  const now = new Date();
  const mutation = await mutateCollection(COLLECTION, (records) => {
    const index = records.findIndex((record) => record.kind === "invite" && record.id === id);
    if (index < 0 || records[index].status === "accepted" || records[index].status === "revoked") return { error: "Invitasjonen er ikke aktiv." };
    const invite = { ...records[index], id: crypto.randomUUID(), status: "pending", expiresAt: new Date(now.getTime() + INVITE_TTL_SECONDS * 1000).toISOString(), updatedAt: now.toISOString() };
    const next = [...records];
    next[index] = invite;
    return { items: next, result: invite };
  });
  if (mutation.error) return res.status(404).json({ error: mutation.error });
  await sendInvitation(req, mutation.result, owner);
  return res.status(200).json({ invite: publicInvite(mutation.result) });
}

async function updateUser(req, res) {
  const email = normalizeEmail(req.body?.email);
  const role = validRole(req.body?.role);
  const status = String(req.body?.status || "active").toLowerCase();
  if (!email || !role || !["active", "suspended"].includes(status)) return res.status(400).json({ error: "Ugyldig brukerendring." });
  if (OWNERS.some((owner) => owner.email === email)) return res.status(400).json({ error: "Eierrollene til Leon og Charles er faste." });
  const mutation = await mutateCollection(COLLECTION, (records) => {
    const index = records.findIndex((record) => record.kind === "user" && record.email === email);
    if (index < 0) return { error: "Brukeren ble ikke funnet." };
    const next = [...records];
    next[index] = { ...records[index], role, status, updatedAt: new Date().toISOString() };
    return { items: next, result: next[index] };
  });
  if (mutation.error) return res.status(404).json({ error: mutation.error });
  return res.status(200).json({ user: publicAccess(mutation.result) });
}

async function revokeAccess(req, res) {
  const id = cleanText(req.query?.id || req.body?.id, 254);
  const mutation = await mutateCollection(COLLECTION, (records) => {
    const index = records.findIndex((record) => (record.kind === "invite" && record.id === id) || (record.kind === "user" && (record.id === id || record.email === normalizeEmail(id))));
    if (index < 0) return { error: "Tilgangen ble ikke funnet." };
    const record = records[index];
    const next = [...records];
    next[index] = { ...record, status: record.kind === "invite" ? "revoked" : "suspended", updatedAt: new Date().toISOString() };
    return { items: next, result: next[index] };
  });
  if (mutation.error) return res.status(404).json({ error: mutation.error });
  return res.status(200).json({ ok: true });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert." });
  if (req.query?.accessAction === "accept") return acceptInvitation(req, res);
  const owner = await requireCrmAccess(req, res, "manageUsers");
  if (!owner) return;
  try {
    if (req.method === "GET") return listAccess(res);
    if (req.method === "POST" && req.body?.action === "resend") return resendInvitation(req, res, owner);
    if (req.method === "POST") return inviteUser(req, res, owner);
    if (req.method === "PATCH") return updateUser(req, res);
    if (req.method === "DELETE") return revokeAccess(req, res);
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("CRM access administration failed", error?.message);
    return res.status(503).json({ error: "Brukertilgangen kunne ikke oppdateres." });
  }
};

module.exports._test = { inviteStatus, publicInvite };
