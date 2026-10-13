const MAX_RECEIPT_SIZE = 15 * 1024 * 1024;
const RECEIPT_CATEGORIES = ["Utstyr", "Programvare", "Reise", "Mat og møte", "Lokaler", "Markedsføring", "Annet"];
const RECEIPT_STATUSES = ["Til kontroll", "Godkjent", "Skanning feilet"];
const SAFE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "pdf"]);
const MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

function clean(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function extension(filename) {
  return clean(filename, 250).toLowerCase().split(".").pop();
}

function safeFilename(value) {
  return clean(value, 250)
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/^\.+/, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 180);
}

function validReceiptId(value) {
  const id = clean(value, 120);
  return /^receipt-[a-zA-Z0-9-]{8,112}$/.test(id) ? id : "";
}

function receiptContentType(filename) {
  return MIME_BY_EXTENSION[extension(filename)] || "";
}

function receiptPathname(id, filename) {
  const safeId = validReceiptId(id);
  const safeName = safeFilename(filename);
  if (!safeId || !safeName || !SAFE_EXTENSIONS.has(extension(safeName))) return "";
  return `loki-crm/receipts/${safeId}/${safeName}`;
}

function validDate(value) {
  const date = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? "" : date;
}

function ore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(Math.round(number), 1_000_000_000_00)) : 0;
}

function sanitizeReceipt(input, existing = {}, actor = "") {
  const id = validReceiptId(existing.id || input?.id);
  const name = clean(existing.name || input?.name, 250);
  if (!id || !name || !receiptPathname(id, name)) return null;
  const category = clean(input?.category ?? existing.category, 50);
  const status = clean(input?.status ?? existing.status, 50);
  const createdAt = existing.createdAt || new Date().toISOString();
  return {
    ...existing,
    id,
    name,
    contentType: clean(existing.contentType || input?.contentType || receiptContentType(name), 100),
    size: Math.max(0, Math.min(Number(existing.size ?? input?.size) || 0, MAX_RECEIPT_SIZE)),
    supplier: clean(input?.supplier ?? existing.supplier, 180),
    receiptDate: validDate(input?.receiptDate ?? existing.receiptDate),
    totalOre: ore(input?.totalOre ?? existing.totalOre),
    vatOre: ore(input?.vatOre ?? existing.vatOre),
    currency: clean(input?.currency ?? existing.currency ?? "NOK", 8).toUpperCase() || "NOK",
    category: RECEIPT_CATEGORIES.includes(category) ? category : "Annet",
    receiptNumber: clean(input?.receiptNumber ?? existing.receiptNumber, 100),
    organizationNumber: clean(input?.organizationNumber ?? existing.organizationNumber, 40),
    paymentMethod: clean(input?.paymentMethod ?? existing.paymentMethod, 100),
    notes: clean(input?.notes ?? existing.notes, 2000),
    status: RECEIPT_STATUSES.includes(status) ? status : "Til kontroll",
    scanConfidence: Math.max(0, Math.min(Math.round(Number(input?.scanConfidence ?? existing.scanConfidence) || 0), 100)),
    scanWarnings: Array.isArray(input?.scanWarnings ?? existing.scanWarnings)
      ? (input?.scanWarnings ?? existing.scanWarnings).map((warning) => clean(warning, 180)).filter(Boolean).slice(0, 8)
      : [],
    scannedAt: clean(input?.scannedAt ?? existing.scannedAt, 40),
    scanError: clean(input?.scanError ?? existing.scanError, 300),
    createdAt,
    updatedAt: new Date().toISOString(),
    uploadedBy: clean(existing.uploadedBy || actor, 254).toLowerCase(),
  };
}

function sanitizeReceiptUpload(input, actualBlob, actor) {
  const pathname = receiptPathname(input?.id, input?.name);
  const actualSize = Number(actualBlob?.size) || 0;
  if (!pathname || actualBlob?.pathname !== pathname || actualSize <= 0 || actualSize > MAX_RECEIPT_SIZE) return null;
  const expectedType = receiptContentType(input.name);
  if (!expectedType || (actualBlob.contentType && actualBlob.contentType !== expectedType)) return null;
  return sanitizeReceipt({
    ...input,
    size: actualSize,
    contentType: expectedType,
  }, {
    id: input.id,
    name: input.name,
    pathname,
    size: actualSize,
    contentType: expectedType,
    uploadedAt: new Date().toISOString(),
    uploadedBy: actor,
  }, actor);
}

function publicReceipt(receipt) {
  const { pathname, uploadedBy, ...safe } = receipt || {};
  return {
    ...safe,
    previewable: /^image\//.test(safe.contentType || ""),
    downloadable: Boolean(pathname),
  };
}

function mergeScan(receipt, scan) {
  const fill = (field, fallback = "") => receipt[field] || scan[field] || fallback;
  return sanitizeReceipt({
    ...receipt,
    supplier: fill("supplier"),
    receiptDate: fill("receiptDate"),
    totalOre: receipt.totalOre || scan.totalOre,
    vatOre: receipt.vatOre || scan.vatOre,
    currency: fill("currency", "NOK"),
    category: receipt.category && receipt.category !== "Annet" ? receipt.category : scan.category,
    receiptNumber: fill("receiptNumber"),
    organizationNumber: fill("organizationNumber"),
    paymentMethod: fill("paymentMethod"),
    scanConfidence: scan.confidence,
    scanWarnings: scan.warnings,
    scannedAt: new Date().toISOString(),
    scanError: "",
    status: "Til kontroll",
  }, receipt, receipt.uploadedBy);
}

module.exports = {
  MAX_RECEIPT_SIZE,
  RECEIPT_CATEGORIES,
  RECEIPT_STATUSES,
  SAFE_EXTENSIONS,
  mergeScan,
  publicReceipt,
  receiptContentType,
  receiptPathname,
  safeFilename,
  sanitizeReceipt,
  sanitizeReceiptUpload,
  validReceiptId,
};
