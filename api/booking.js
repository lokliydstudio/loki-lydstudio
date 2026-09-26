const { requireUser } = require("../lib/crm-auth");
const { sendMail } = require("../lib/crm-mail");
const { sendPush } = require("../lib/crm-push");
const { isConfigured, readCollection, writeCollection } = require("../lib/crm-store");
const {
  ACCOUNT_STATUSES,
  bookingConflict,
  challengeCookie,
  cleanEmail,
  clearChallengeCookie,
  clearSessionCookie,
  createLoginChallenge,
  publicAccount,
  sanitizeAccount,
  sanitizeBooking,
  sessionCookie,
  sessionFromRequest,
  verifyLoginCode,
} = require("../lib/tenant-booking");

const USER_COLLECTION = "tenant-booking-users";
const BOOKING_COLLECTION = "tenant-bookings";
const requestAttempts = new Map();
const codeAttempts = new Map();
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ACCOUNTS = 200;
const MAX_PENDING_ACCOUNTS = 50;
const MAX_FUTURE_BOOKINGS_PER_USER = 100;

function html(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function ipAddress(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

function rateLimited(req, purpose, seconds = 60) {
  const key = `${purpose}:${ipAddress(req)}`;
  const previous = requestAttempts.get(key) || 0;
  if (Date.now() - previous < seconds * 1000) return true;
  requestAttempts.set(key, Date.now());
  return false;
}

function todayInOslo() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function baseUrl() {
  return String(process.env.CRM_BASE_URL || "https://www.lokilyd.no").replace(/\/$/, "");
}

async function tenantForRequest(req, accounts) {
  const session = sessionFromRequest(req);
  if (!session) return null;
  const account = accounts.find((item) => item.id === session.accountId && item.email === session.email);
  return account?.status === "approved" ? account : null;
}

async function notifyRegistration(account) {
  const address = process.env.MAIL_ADDRESS || "post@lokilyd.no";
  const portal = `${baseUrl()}/booking/`;
  const crm = `${baseUrl()}/crmplatform/#operations`;
  await Promise.all([
    sendMail({
      from: `Loki Studio <${address}>`,
      replyTo: account.email,
      to: address,
      subject: `Ny bookingbruker venter på godkjenning – ${account.studio}`,
      text: `${account.name} (${account.email}) ønsker tilgang til bookingkalenderen for ${account.studio}.\n\nGodkjenn eller avslå brukeren i CRM:\n${crm}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#191918"><h2>Ny bookingbruker</h2><p><strong>${html(account.name)}</strong> (${html(account.email)}) ønsker tilgang til <strong>${html(account.studio)}</strong>.</p><p><a href="${crm}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#d9ff53;color:#171716;font-weight:700;text-decoration:none">Behandle i CRM</a></p><p style="color:#777;font-size:12px">Ingen tilgang gis før Leon eller Charles godkjenner kontoen.</p></div>`,
    }),
    sendPush("booking-portal", {
      title: "Ny bookingbruker",
      body: `${account.name} søker tilgang til ${account.studio}.`,
      tag: `tenant-request-${account.id}`,
      url: "/crmplatform/#operations",
    }),
  ]);
  return portal;
}

async function registrationHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (rateLimited(req, "register")) return res.status(429).json({ error: "Vent ett minutt før du prøver igjen." });
  const accounts = await readCollection(USER_COLLECTION);
  const candidate = sanitizeAccount({ ...req.body, status: "pending" });
  if (!candidate) return res.status(400).json({ error: "Fyll ut navn, gyldig e-post og velg Studio C eller Studio D." });
  const existingIndex = accounts.findIndex((item) => item.email === candidate.email);
  if (existingIndex >= 0 && accounts[existingIndex].status === "approved") {
    return res.status(200).json({ ok: true, message: "Søknaden er mottatt. Hvis kontoen allerede er godkjent, kan du bruke innloggingen." });
  }
  if (existingIndex >= 0 && accounts[existingIndex].status === "suspended") {
    return res.status(200).json({ ok: true, message: "Søknaden er mottatt. Kontakt post@lokilyd.no hvis du trenger hjelp med tilgangen." });
  }
  if (existingIndex >= 0 && accounts[existingIndex].status === "pending" && Date.now() - new Date(accounts[existingIndex].updatedAt).getTime() < 15 * 60 * 1000) {
    return res.status(200).json({ ok: true, message: "Søknaden er mottatt og blir behandlet av Loki Lydstudio." });
  }
  if (existingIndex < 0 && (accounts.length >= MAX_ACCOUNTS || accounts.filter((item) => item.status === "pending").length >= MAX_PENDING_ACCOUNTS)) {
    return res.status(429).json({ error: "Det er for mange åpne søknader akkurat nå. Kontakt post@lokilyd.no." });
  }
  const account = existingIndex >= 0
    ? sanitizeAccount({ name: candidate.name, studio: candidate.studio, status: "pending" }, accounts[existingIndex])
    : candidate;
  if (existingIndex >= 0) accounts[existingIndex] = account;
  else accounts.unshift(account);
  await writeCollection(USER_COLLECTION, accounts);
  try {
    await notifyRegistration(account);
  } catch (error) {
    console.error("Tenant registration notification failed", error?.message);
    return res.status(503).json({ error: "Søknaden ble lagret, men varselet kunne ikke sendes. Kontakt post@lokilyd.no." });
  }
  return res.status(201).json({ ok: true, message: "Søknaden er sendt til Loki Lydstudio for godkjenning." });
}

async function requestCodeHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (rateLimited(req, "login")) return res.status(429).json({ error: "Vent ett minutt før du ber om en ny kode." });
  const email = cleanEmail(req.body?.email);
  const accounts = await readCollection(USER_COLLECTION);
  const account = accounts.find((item) => item.email === email);
  // Keep the public response identical so the portal cannot be used to enumerate tenant addresses.
  if (!account || account.status !== "approved") {
    res.setHeader("Set-Cookie", clearChallengeCookie());
    return res.status(200).json({ ok: true });
  }
  const challenge = createLoginChallenge(account);
  const address = process.env.MAIL_ADDRESS || "post@lokilyd.no";
  await sendMail({
    from: `Loki Studio <${address}>`,
    replyTo: address,
    to: account.email,
    subject: `Innloggingskode til ${account.studio}`,
    text: `Din engangskode til bookingkalenderen for ${account.studio} er ${challenge.code}.\n\nKoden er gyldig i 15 minutter. Hvis du ikke ba om koden, kan du ignorere meldingen.`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#191918"><p>Din engangskode til bookingkalenderen for <strong>${html(account.studio)}</strong> er:</p><p style="margin:22px 0;font-size:32px;font-weight:800;letter-spacing:.22em">${challenge.code.slice(0, 3)} ${challenge.code.slice(3)}</p><p style="color:#777;font-size:12px">Koden er gyldig i 15 minutter.</p></div>`,
  });
  res.setHeader("Set-Cookie", challengeCookie(challenge.token));
  return res.status(200).json({ ok: true });
}

async function verifyCodeHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const email = cleanEmail(req.body?.email);
  const key = `${ipAddress(req)}:${email}`;
  const current = codeAttempts.get(key) || { count: 0, resetAt: Date.now() + ATTEMPT_WINDOW_MS };
  if (current.resetAt > Date.now() && current.count >= 5) {
    res.setHeader("Set-Cookie", clearChallengeCookie());
    return res.status(429).json({ error: "For mange forsøk. Be om en ny kode." });
  }
  const challenge = verifyLoginCode(req, email, req.body?.code);
  if (!challenge) {
    const next = current.resetAt <= Date.now() ? { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS } : { ...current, count: current.count + 1 };
    codeAttempts.set(key, next);
    return res.status(401).json({ error: "Koden er ugyldig eller utløpt." });
  }
  const accounts = await readCollection(USER_COLLECTION);
  const index = accounts.findIndex((item) => item.id === challenge.accountId && item.email === email && item.status === "approved");
  if (index < 0) return res.status(403).json({ error: "Kontoen har ikke aktiv tilgang." });
  accounts[index] = { ...accounts[index], lastLoginAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await writeCollection(USER_COLLECTION, accounts);
  codeAttempts.delete(key);
  res.setHeader("Set-Cookie", [sessionCookie(accounts[index]), clearChallengeCookie()]);
  return res.status(200).json({ ok: true, user: publicAccount(accounts[index]) });
}

async function sessionHandler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const accounts = await readCollection(USER_COLLECTION);
  const account = await tenantForRequest(req, accounts);
  if (!account) return res.status(401).json({ authenticated: false });
  return res.status(200).json({ authenticated: true, user: publicAccount(account) });
}

async function logoutHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Set-Cookie", [clearSessionCookie(), clearChallengeCookie()]);
  return res.status(200).json({ ok: true });
}

async function calendarHandler(req, res) {
  const accounts = await readCollection(USER_COLLECTION);
  const account = await tenantForRequest(req, accounts);
  if (!account) return res.status(401).json({ error: "Innlogging kreves." });
  const bookings = await readCollection(BOOKING_COLLECTION);
  if (req.method === "GET") {
    return res.status(200).json({
      studio: account.studio,
      bookings: bookings
        .filter((item) => item.studio === account.studio)
        .sort((left, right) => `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`)),
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const booking = sanitizeBooking(req.body?.booking || req.body, account);
  if (!booking) return res.status(400).json({ error: "Fyll ut tittel, dato og et gyldig tidsrom." });
  if (booking.date < todayInOslo()) return res.status(400).json({ error: "Du kan ikke opprette en booking tilbake i tid." });
  if (bookings.filter((item) => item.createdById === account.id && item.date >= todayInOslo()).length >= MAX_FUTURE_BOOKINGS_PER_USER) {
    return res.status(429).json({ error: "Du har nådd grensen for fremtidige bookinger. Kontakt Loki Lydstudio." });
  }
  const conflict = bookingConflict(bookings, booking);
  if (conflict) return res.status(409).json({ error: `Tiden overlapper med «${conflict.title}» (${conflict.startTime}–${conflict.endTime}).` });
  bookings.push(booking);
  await writeCollection(BOOKING_COLLECTION, bookings);
  await sendPush("booking-portal", {
    title: `Ny booking · ${booking.studio}`,
    body: `${booking.createdByName} booket «${booking.title}» ${booking.date} kl. ${booking.startTime}–${booking.endTime}.`,
    tag: `tenant-booking-${booking.id}`,
    url: "/crmplatform/#operations",
  });
  return res.status(201).json({ booking });
}

async function adminHandler(req, res) {
  const owner = requireUser(req, res);
  if (!owner) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const [accounts, bookings] = await Promise.all([readCollection(USER_COLLECTION), readCollection(BOOKING_COLLECTION)]);
  return res.status(200).json({
    users: accounts.map((item) => publicAccount(item, { admin: true })),
    bookings: bookings.sort((left, right) => `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`)),
  });
}

async function adminUserHandler(req, res) {
  const owner = requireUser(req, res);
  if (!owner) return;
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });
  const status = String(req.body?.status || "").toLowerCase();
  if (!ACCOUNT_STATUSES.has(status) || status === "pending") return res.status(400).json({ error: "Velg godkjent, avslått eller deaktivert." });
  const accounts = await readCollection(USER_COLLECTION);
  const index = accounts.findIndex((item) => item.id === String(req.body?.id || ""));
  if (index < 0) return res.status(404).json({ error: "Brukeren ble ikke funnet." });
  const previous = accounts[index];
  accounts[index] = {
    ...previous,
    status,
    approvedAt: status === "approved" ? new Date().toISOString() : previous.approvedAt,
    approvedBy: status === "approved" ? owner.email : previous.approvedBy,
    updatedAt: new Date().toISOString(),
  };
  await writeCollection(USER_COLLECTION, accounts);
  const address = process.env.MAIL_ADDRESS || "post@lokilyd.no";
  const approved = status === "approved";
  const subject = approved ? `Bookingkontoen din for ${previous.studio} er godkjent` : `Tilgang til bookingkalenderen for ${previous.studio}`;
  const message = approved
    ? `Kontoen din er godkjent. Du kan nå logge inn og booke tid i ${previous.studio}.`
    : status === "suspended" ? "Bookingkontoen din er deaktivert. Kontakt Loki Lydstudio hvis du har spørsmål." : "Søknaden om tilgang ble ikke godkjent. Kontakt Loki Lydstudio hvis du mener dette er feil.";
  try {
    await sendMail({
      from: `Loki Studio <${address}>`, replyTo: address, to: previous.email, subject,
      text: `${message}\n\n${approved ? `${baseUrl()}/booking/` : "post@lokilyd.no"}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#191918"><h2>${html(subject)}</h2><p>${html(message)}</p>${approved ? `<p><a href="${baseUrl()}/booking/" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#d9ff53;color:#171716;font-weight:700;text-decoration:none">Åpne bookingportalen</a></p>` : ""}</div>`,
    });
  } catch (error) {
    console.error("Tenant account status email failed", error?.message);
  }
  return res.status(200).json({ user: publicAccount(accounts[index], { admin: true }) });
}

async function adminBookingHandler(req, res) {
  const owner = requireUser(req, res);
  if (!owner) return;
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });
  const bookings = await readCollection(BOOKING_COLLECTION);
  const index = bookings.findIndex((item) => item.id === String(req.query?.id || req.body?.id || ""));
  if (index < 0) return res.status(404).json({ error: "Bookingen ble ikke funnet." });
  const [deleted] = bookings.splice(index, 1);
  await writeCollection(BOOKING_COLLECTION, bookings);
  const address = process.env.MAIL_ADDRESS || "post@lokilyd.no";
  try {
    await sendMail({
      from: `Loki Studio <${address}>`, replyTo: address, to: deleted.createdByEmail,
      subject: `Booking slettet – ${deleted.studio}`,
      text: `Bookingen «${deleted.title}» ${deleted.date} kl. ${deleted.startTime}–${deleted.endTime} er slettet av Loki Lydstudio. Kontakt ${address} hvis du har spørsmål.`,
    });
  } catch (error) {
    console.error("Tenant booking deletion email failed", error?.message);
  }
  return res.status(200).json({ ok: true, deletedId: deleted.id });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!isConfigured()) return res.status(503).json({ error: "Bookinglagringen er ikke konfigurert." });
  const action = String(req.query?.action || "");
  try {
    if (action === "register") return await registrationHandler(req, res);
    if (action === "request-code") return await requestCodeHandler(req, res);
    if (action === "verify-code") return await verifyCodeHandler(req, res);
    if (action === "session") return await sessionHandler(req, res);
    if (action === "logout") return await logoutHandler(req, res);
    if (action === "calendar") return await calendarHandler(req, res);
    if (action === "admin") return await adminHandler(req, res);
    if (action === "admin-user") return await adminUserHandler(req, res);
    if (action === "admin-booking") return await adminBookingHandler(req, res);
    return res.status(404).json({ error: "Ukjent bookinghandling." });
  } catch (error) {
    console.error(`Booking API failed (${action})`, error?.message);
    return res.status(503).json({ error: "Bookingsystemet kunne ikke fullføre handlingen." });
  }
};

module.exports._test = { todayInOslo };
