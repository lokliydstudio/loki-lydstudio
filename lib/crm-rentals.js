const crypto = require("crypto");
const { jottacloudDocumentUrl } = require("./crm-documents");

const ROOMS = new Set(["Studio B", "Studio C", "Studio D"]);
const CONTRACT_STATUSES = new Set(["Signert", "Kontrakt funnet", "Ikke koblet"]);

function cleanText(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanPhone(value) {
  const phone = cleanText(value, 40);
  if (!phone || !/^[+()\d\s.-]+$/.test(phone)) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? phone : "";
}

function cleanDate(value) {
  const date = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? "" : date;
}

function cleanAmount(value, fallback = 0) {
  const amount = Number(value ?? fallback);
  return Number.isFinite(amount) ? Math.min(1_000_000, Math.max(0, Math.round(amount))) : 0;
}

function cleanTenantId(value) {
  const id = cleanText(value, 120);
  return /^tenant-[a-z0-9-]{3,110}$/.test(id) ? id : "";
}

function cleanContractPath(value) {
  const path = cleanText(value, 1000).replace(/^\/+/, "");
  if (!path.startsWith("AS/Kontrakter/Utleie/") || path.includes("..") || /(^|\/)Arkiv_utflyttet(\/|$)/i.test(path)) return "";
  return path;
}

function cleanJottacloudUrl(value) {
  const raw = cleanText(value, 1200);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || (url.hostname !== "jottacloud.com" && !url.hostname.endsWith(".jottacloud.com")) || url.username || url.password) return "";
    return url.toString().slice(0, 1200);
  } catch {
    return "";
  }
}

function sanitizeTenant(input = {}, existing = {}, userEmail = "") {
  const name = cleanText(input.name ?? existing.name, 160);
  if (!name) return null;
  const requestedRoom = cleanText(input.room ?? existing.room, 40);
  const contractPath = cleanContractPath(input.contractPath ?? existing.contractPath);
  const contractUrl = cleanJottacloudUrl(input.contractUrl ?? existing.contractUrl);
  const contractStatusInput = cleanText(input.contractStatus ?? existing.contractStatus ?? (contractPath || contractUrl ? "Kontrakt funnet" : "Ikke koblet"), 40);
  const now = new Date().toISOString();
  return {
    id: cleanTenantId(existing.id || input.id) || `tenant-${crypto.randomUUID()}`,
    name,
    contactPerson: cleanText(input.contactPerson ?? existing.contactPerson, 160),
    room: ROOMS.has(requestedRoom) ? requestedRoom : "Studio B",
    arrangement: cleanText(input.arrangement ?? existing.arrangement, 300),
    monthlyRent: cleanAmount(input.monthlyRent, existing.monthlyRent),
    email: cleanEmail(input.email ?? existing.email),
    phone: cleanPhone(input.phone ?? existing.phone),
    contractPath,
    contractUrl,
    contractStatus: CONTRACT_STATUSES.has(contractStatusInput)
      ? contractStatusInput
      : (contractPath || contractUrl ? "Kontrakt funnet" : "Ikke koblet"),
    active: input.active === undefined ? existing.active !== false : Boolean(input.active),
    notes: cleanText(input.notes ?? existing.notes, 2000),
    createdAt: existing.createdAt || now,
    updatedAt: now,
    updatedBy: cleanEmail(userEmail),
  };
}

function paymentId(tenantId, year, month) {
  return `rent-${tenantId.replace(/^tenant-/, "")}-${year}-${String(month).padStart(2, "0")}`;
}

function sanitizePayment(input = {}, existing = {}, userEmail = "") {
  const tenantId = cleanTenantId(input.tenantId ?? existing.tenantId);
  const year = Math.trunc(Number(input.year ?? existing.year));
  const month = Math.trunc(Number(input.month ?? existing.month));
  if (!tenantId || year < 2020 || year > 2100 || month < 1 || month > 12) return null;
  const paid = Boolean(input.paid ?? existing.paid);
  const paidAt = paid ? cleanDate(input.paidAt ?? existing.paidAt) || new Date().toISOString().slice(0, 10) : "";
  const now = new Date().toISOString();
  return {
    id: paymentId(tenantId, year, month),
    tenantId,
    year,
    month,
    paid,
    paidAt,
    note: cleanText(input.note ?? existing.note, 500),
    createdAt: existing.createdAt || now,
    updatedAt: now,
    updatedBy: cleanEmail(userEmail),
  };
}

function sanitizeRoomKeys(input = {}, existing = {}, userEmail = "") {
  const roomInput = cleanText(input.room ?? existing.room, 40);
  if (!ROOMS.has(roomInput)) return null;
  const issuedKeys = Math.min(100, Math.max(0, Math.trunc(Number(input.issuedKeys ?? existing.issuedKeys) || 0)));
  const now = new Date().toISOString();
  return {
    id: `keys-${roomInput.toLowerCase().replace(/\s+/g, "-")}`,
    room: roomInput,
    issuedKeys,
    note: cleanText(input.note ?? existing.note, 500),
    createdAt: existing.createdAt || now,
    updatedAt: now,
    updatedBy: cleanEmail(userEmail),
  };
}

const TENANT_SEEDS = [
  { id: "tenant-kolbein-bukve", name: "Kolbein", contactPerson: "Kolbein Bukve", room: "Studio B", arrangement: "Onsdag 08–16", monthlyRent: 1000, email: "knallbein@gmail.com", phone: "95522940", contractStatus: "Signert", contractPath: "AS/Kontrakter/Utleie/Studio B/Kolbein Bukve/Ordensregler_Kolbein__Fremleieavtale_Kolbein_Bukve_Studio B.pdf" },
  { id: "tenant-rolf-bjorke", name: "Rolf", contactPerson: "Rolf A. Bjørke", room: "Studio B", arrangement: "Onsdag 16–00", monthlyRent: 1000, email: "rolf.a.bjorke@gmail.com", phone: "99588844", contractStatus: "Signert", contractPath: "AS/Kontrakter/Utleie/Studio B/Rolf Bjørke/SIGNERT/Fremleieavtale_Rolf_vår 2025_SIGNERT.pdf" },
  { id: "tenant-edward", name: "Edward", room: "Studio B", arrangement: "Fredag 16–00 + lørdag begge slots", monthlyRent: 3000 },
  { id: "tenant-tanja-tjong", name: "Tanja", contactPerson: "Tanja Tjong", room: "Studio B", arrangement: "Søndag 08–16", monthlyRent: 1000, email: "tanjatjong@gmail.com", phone: "93421306", contractStatus: "Signert", contractPath: "AS/Kontrakter/Utleie/Studio B/Tanja Tjong/Fremleieavtale_Tanja_SIGNERT.pdf" },
  { id: "tenant-emilie-ljung", name: "Emilie", contactPerson: "Emilie S. Ljung", room: "Studio C", arrangement: "Delt studio / fast ukefordeling", monthlyRent: 3500, email: "emiliesljung@hotmail.com", phone: "97097147", contractStatus: "Kontrakt funnet", contractPath: "AS/Kontrakter/Utleie/Studio C/Emilie S Ljung/Emilie_aug 2025.docx" },
  { id: "tenant-torgeir-ryssevik", name: "Torgeir", contactPerson: "Torgeir Ryssevik", room: "Studio C", arrangement: "Delt studio / fast ukefordeling", monthlyRent: 3500, email: "torgeir@ryssmusic.no", phone: "97471319", contractStatus: "Kontrakt funnet", contractPath: "AS/Kontrakter/Utleie/Studio C/TorgeirCeline/TorgeirCeline_aug 2025.docx" },
  { id: "tenant-oskar-oliver", name: "Oskar / Oliver", contactPerson: "Oskar Mikalsen", room: "Studio C", arrangement: "Delt studio / fast ukefordeling", monthlyRent: 7000, email: "oskarseb@hotmail.com", phone: "92202988", contractStatus: "Kontrakt funnet", contractPath: "AS/Kontrakter/Utleie/Studio C/OskarTyra/OskarTyra_aug 2025.docx", notes: "Kontaktinformasjon er koblet via Oskar. Kontroller og fyll inn Oliver ved behov." },
  { id: "tenant-amund-nordstrom", name: "Amund", contactPerson: "Amund Nordstrøm", room: "Studio D", arrangement: "Fritt booking", monthlyRent: 2967, email: "luegutten@gmail.com", phone: "41 37 56 34", contractStatus: "Kontrakt funnet", contractPath: "AS/Kontrakter/Utleie/Studio D/Amund Nordstrøm/Fremleieavtale_Amund vår 2025.docx" },
  { id: "tenant-rasmus", name: "Rasmus", room: "Studio D", arrangement: "Fritt booking", monthlyRent: 3000 },
  { id: "tenant-tord-vaernes", name: "Tord Værnes", contactPerson: "Tord Værnes", room: "Studio D", arrangement: "Fritt booking", monthlyRent: 3000, email: "tordvaernes29@gmail.com", phone: "90470784", contractStatus: "Kontrakt funnet", contractPath: "AS/Kontrakter/Utleie/Studio D/Tord og gjengen/Leieavtale_Tord og gjengen_aug2025.docx" },
  { id: "tenant-tord-vinnereim", name: "Tord Vinnereim", room: "Studio D", arrangement: "Fritt booking", monthlyRent: 3000 },
];

function seedRentalItems(userEmail = "system@lokilyd.no") {
  return [
    ...TENANT_SEEDS.map((tenant) => ({ ...sanitizeTenant(tenant, {}, userEmail), kind: "tenant" })),
    ...[...ROOMS].map((room) => ({ ...sanitizeRoomKeys({ room, issuedKeys: 0 }, {}, userEmail), kind: "room-keys" })),
  ];
}

function publicTenant(tenant) {
  const contractUrl = tenant.contractUrl || jottacloudDocumentUrl(tenant.contractPath);
  return { ...tenant, contractUrl, contractAvailable: Boolean(contractUrl) };
}

function splitRentalItems(items) {
  return {
    tenants: items.filter((item) => item.kind === "tenant").map(publicTenant),
    payments: items.filter((item) => item.kind === "payment"),
    rooms: items.filter((item) => item.kind === "room-keys"),
  };
}

module.exports = {
  CONTRACT_STATUSES,
  ROOMS,
  TENANT_SEEDS,
  cleanContractPath,
  cleanJottacloudUrl,
  paymentId,
  sanitizePayment,
  sanitizeRoomKeys,
  sanitizeTenant,
  seedRentalItems,
  splitRentalItems,
};
