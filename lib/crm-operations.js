const crypto = require("crypto");

const ACTIVITY_TYPES = new Set(["Notat", "Telefon", "E-post", "Møte", "Status", "Tilbud", "Booking"]);
const ASSIGNEES = new Set(["Leon", "Charles", "Begge"]);
const BOOKING_STATUSES = new Set(["Planlagt", "Bekreftet", "Fullført", "Avlyst"]);
const BOOKING_SERVICES = new Set(["Innspilling", "Miks", "Mastering", "Produksjon", "Møte", "Annet"]);
const QUOTE_STATUSES = new Set(["Utkast", "Sendt", "Godkjent", "Avslått", "Utløpt"]);
const QUOTE_UNITS = new Set(["time", "låt", "dag", "stk"]);

function cleanText(value, max = 500) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanLongText(value, max = 5000) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().slice(0, max);
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanDate(value) {
  const date = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function cleanTime(value) {
  const time = cleanText(value, 5);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "";
}

function cleanDateTime(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function boundedNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(number, max)) : fallback;
}

function sanitizeActivity(input = {}, existing = {}, userEmail = "") {
  const type = cleanText(input.type ?? existing.type ?? "Notat", 30);
  const details = cleanLongText(input.details ?? existing.details, 4000);
  const leadId = cleanText(input.leadId ?? existing.leadId, 120);
  if (!leadId || !details) return null;
  return {
    id: cleanText(existing.id || input.id, 120) || `activity-${crypto.randomUUID()}`,
    leadId,
    type: ACTIVITY_TYPES.has(type) ? type : "Notat",
    details,
    occurredAt: cleanDateTime(input.occurredAt ?? existing.occurredAt),
    createdAt: existing.createdAt || new Date().toISOString(),
    createdBy: cleanEmail(existing.createdBy || userEmail),
  };
}

function sanitizeBooking(input = {}, existing = {}, userEmail = "") {
  const status = cleanText(input.status ?? existing.status ?? "Planlagt", 30);
  const service = cleanText(input.service ?? existing.service ?? "Innspilling", 40);
  const assignee = cleanText(input.assignee ?? existing.assignee ?? "Begge", 20);
  const date = cleanDate(input.date ?? existing.date);
  const startTime = cleanTime(input.startTime ?? existing.startTime);
  const endTime = cleanTime(input.endTime ?? existing.endTime);
  const title = cleanText(input.title ?? existing.title, 180);
  if (!title || !date || !startTime || !endTime || endTime <= startTime) return null;
  return {
    id: cleanText(existing.id || input.id, 120) || `booking-${crypto.randomUUID()}`,
    leadId: cleanText(input.leadId ?? existing.leadId, 120),
    projectId: cleanText(input.projectId ?? existing.projectId, 120),
    title,
    clientName: cleanText(input.clientName ?? existing.clientName, 160),
    clientEmail: cleanEmail(input.clientEmail ?? existing.clientEmail),
    service: BOOKING_SERVICES.has(service) ? service : "Annet",
    date,
    startTime,
    endTime,
    status: BOOKING_STATUSES.has(status) ? status : "Planlagt",
    assignee: ASSIGNEES.has(assignee) ? assignee : "Begge",
    notes: cleanLongText(input.notes ?? existing.notes, 3000),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: cleanEmail(userEmail),
  };
}

function bookingConflict(bookings, candidate) {
  if (!candidate || candidate.status === "Avlyst") return null;
  return bookings.find((booking) => (
    booking.id !== candidate.id
    && booking.date === candidate.date
    && booking.status !== "Avlyst"
    && candidate.startTime < booking.endTime
    && candidate.endTime > booking.startTime
  )) || null;
}

function sanitizeQuoteItem(input = {}) {
  const description = cleanText(input.description, 180);
  if (!description) return null;
  const quantity = boundedNumber(input.quantity, 0.01, 10_000, 1);
  const unitPrice = Math.round(boundedNumber(input.unitPrice, 0, 10_000_000, 0));
  const unit = cleanText(input.unit || "stk", 20);
  return {
    description,
    quantity,
    unit: QUOTE_UNITS.has(unit) ? unit : "stk",
    unitPrice,
    lineTotal: Math.round(quantity * unitPrice),
  };
}

function sanitizeQuote(input = {}, existing = {}, userEmail = "") {
  const status = cleanText(input.status ?? existing.status ?? "Utkast", 30);
  const rawItems = Array.isArray(input.items) ? input.items : existing.items;
  const items = (Array.isArray(rawItems) ? rawItems : []).slice(0, 30).map(sanitizeQuoteItem).filter(Boolean);
  const customerName = cleanText(input.customerName ?? existing.customerName, 160);
  const projectName = cleanText(input.projectName ?? existing.projectName, 180);
  if (!customerName || !projectName || !items.length) return null;
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  return {
    id: cleanText(existing.id || input.id, 120) || `quote-${crypto.randomUUID()}`,
    number: cleanText(existing.number || input.number, 60) || `L-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    leadId: cleanText(input.leadId ?? existing.leadId, 120),
    customerName,
    customerEmail: cleanEmail(input.customerEmail ?? existing.customerEmail),
    projectName,
    status: QUOTE_STATUSES.has(status) ? status : "Utkast",
    validUntil: cleanDate(input.validUntil ?? existing.validUntil),
    items,
    total,
    terms: cleanLongText(input.terms ?? existing.terms, 4000),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: cleanEmail(userEmail),
  };
}

module.exports = {
  ACTIVITY_TYPES,
  ASSIGNEES,
  BOOKING_SERVICES,
  BOOKING_STATUSES,
  QUOTE_STATUSES,
  bookingConflict,
  sanitizeActivity,
  sanitizeBooking,
  sanitizeQuote,
  sanitizeQuoteItem,
};
