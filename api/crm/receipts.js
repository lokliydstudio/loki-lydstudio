const { del, get, head, issueSignedToken } = require("@vercel/blob");
const { handleUploadPresigned } = require("@vercel/blob/client");
const { currentUser } = require("../../lib/crm-auth");
const { streamPrivateBlob } = require("../../lib/crm-audio-stream");
const {
  MAX_RECEIPT_SIZE,
  mergeScan,
  publicReceipt,
  receiptContentType,
  receiptPathname,
  sanitizeReceipt,
  sanitizeReceiptUpload,
  validReceiptId,
} = require("../../lib/crm-receipts");
const { scanConfigured, scanReceipt } = require("../../lib/crm-receipt-scan");
const { isConfigured, mutateCollection, readCollection } = require("../../lib/crm-store");

function parsePayload(value) {
  try { return JSON.parse(value || "{}"); }
  catch { throw new Error("Ugyldig bilagsdata."); }
}

function oidcToken(req) {
  return String(req.headers?.["x-vercel-oidc-token"] || "").trim();
}

async function uploadHandler(req, res, user) {
  if (!user) return res.status(401).json({ error: "Innlogging kreves." });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const result = await handleUploadPresigned({
      body: req.body,
      request: req,
      getSignedToken: async (pathname, clientPayload) => {
        const payload = parsePayload(clientPayload);
        const expected = receiptPathname(payload.id, payload.name);
        const contentType = receiptContentType(payload.name);
        const size = Number(payload.size);
        if (!expected || pathname !== expected || !contentType) throw new Error("Bare JPG, PNG, WebP og PDF kan lastes opp som bilag.");
        if (!Number.isFinite(size) || size <= 0 || size > MAX_RECEIPT_SIZE) throw new Error("Bilaget kan være maksimalt 15 MB.");
        const validUntil = Date.now() + 15 * 60 * 1000;
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes: [contentType],
          maximumSizeInBytes: MAX_RECEIPT_SIZE,
          validUntil,
        });
        return {
          token,
          urlOptions: {
            allowedContentTypes: [contentType],
            maximumSizeInBytes: MAX_RECEIPT_SIZE,
            validUntil,
            addRandomSuffix: false,
            allowOverwrite: false,
            cacheControlMaxAge: 60,
          },
        };
      },
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("Receipt upload signing failed", error?.message);
    return res.status(400).json({ error: error?.message || "Kunne ikke starte bilagsopplastingen." });
  }
}

async function registerUpload(req, res, user) {
  const input = req.body?.receipt || {};
  const pathname = receiptPathname(input.id, input.name);
  if (!pathname || pathname !== input.pathname) return res.status(400).json({ error: "Ugyldig bilagsdata." });
  const actualBlob = await head(pathname, { access: "private" });
  const receipt = sanitizeReceiptUpload(input, actualBlob, user.email);
  if (!receipt) return res.status(400).json({ error: "Bilagsfilen kunne ikke verifiseres." });
  const change = await mutateCollection("receipts", (receipts) => {
    if (receipts.some((item) => item.id === receipt.id)) return { error: "Bilaget finnes allerede." };
    receipts.unshift(receipt);
    return { items: receipts, result: publicReceipt(receipt) };
  });
  if (change.error) return res.status(409).json({ error: change.error });
  return res.status(201).json({ receipt: change.result });
}

async function downloadHandler(req, res, user) {
  if (!user) return res.status(401).json({ error: "Innlogging kreves." });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const id = validReceiptId(req.query?.id);
  const receipt = (await readCollection("receipts")).find((item) => item.id === id);
  if (!receipt?.pathname) return res.status(404).json({ error: "Bilaget ble ikke funnet." });
  return streamPrivateBlob(req, res, receipt.pathname, receipt.name, {
    download: String(req.query?.download || "") === "1",
    notFoundMessage: "Bilagsfilen ble ikke funnet.",
  });
}

async function scanHandler(req, res, user) {
  const id = validReceiptId(req.body?.id);
  const receipts = await readCollection("receipts");
  const receipt = receipts.find((item) => item.id === id);
  if (!receipt?.pathname) return res.status(404).json({ error: "Bilaget ble ikke funnet." });
  try {
    const result = await get(receipt.pathname, { access: "private", useCache: false });
    if (!result?.stream) return res.status(404).json({ error: "Bilagsfilen ble ikke funnet." });
    const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
    if (!buffer.length || buffer.length > MAX_RECEIPT_SIZE) return res.status(400).json({ error: "Bilagsfilen har ugyldig størrelse." });
    const scan = await scanReceipt({
      buffer,
      contentType: receipt.contentType,
      filename: receipt.name,
      oidcToken: oidcToken(req),
    });
    const change = await mutateCollection("receipts", (current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index < 0) return { error: "Bilaget ble slettet mens det ble skannet." };
      current[index] = mergeScan(current[index], scan);
      return { items: current, result: publicReceipt(current[index]) };
    });
    if (change.error) return res.status(409).json({ error: change.error });
    return res.status(200).json({ receipt: change.result });
  } catch (error) {
    console.error("Receipt scan failed", error?.message);
    await mutateCollection("receipts", (current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index >= 0) current[index] = sanitizeReceipt({
        ...current[index],
        status: "Skanning feilet",
        scanError: error?.publicMessage || "Bilaget kunne ikke skannes. Fyll inn feltene manuelt.",
      }, current[index], user.email);
      return { items: current, result: index >= 0 ? publicReceipt(current[index]) : null };
    });
    return res.status(503).json({ error: error?.publicMessage || "Bilaget kunne ikke skannes. Du kan fortsatt fylle inn feltene manuelt." });
  }
}

async function updateHandler(req, res, user) {
  const id = validReceiptId(req.body?.id);
  const change = await mutateCollection("receipts", (receipts) => {
    const index = receipts.findIndex((item) => item.id === id);
    if (index < 0) return { error: "Bilaget ble ikke funnet." };
    const updated = sanitizeReceipt(req.body?.changes || {}, receipts[index], user.email);
    if (!updated) return { error: "Bilagsdataene er ugyldige." };
    receipts[index] = updated;
    return { items: receipts, result: publicReceipt(updated) };
  });
  if (change.error) return res.status(404).json({ error: change.error });
  return res.status(200).json({ receipt: change.result });
}

async function deleteHandler(req, res) {
  const id = validReceiptId(req.query?.id || req.body?.id);
  let pathname = "";
  const change = await mutateCollection("receipts", (receipts) => {
    const receipt = receipts.find((item) => item.id === id);
    if (!receipt) return { error: "Bilaget ble ikke funnet." };
    pathname = receipt.pathname;
    return { items: receipts.filter((item) => item.id !== id), result: true };
  });
  if (change.error) return res.status(404).json({ error: change.error });
  if (pathname) await del(pathname).catch((error) => console.error("Receipt blob delete failed", error?.message));
  return res.status(200).json({ ok: true });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const user = currentUser(req);
  const action = String(req.query?.action || "");
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert ennå." });
  if (action === "upload") return uploadHandler(req, res, user);
  if (action === "download") return downloadHandler(req, res, user);
  if (!user) return res.status(401).json({ error: "Innlogging kreves." });
  try {
    if (req.method === "GET") {
      const receipts = await readCollection("receipts");
      receipts.sort((a, b) => Date.parse(b.receiptDate || b.createdAt) - Date.parse(a.receiptDate || a.createdAt));
      return res.status(200).json({ receipts: receipts.map(publicReceipt), scanConfigured: scanConfigured({ oidcToken: oidcToken(req) }) });
    }
    if (req.method === "POST" && req.body?.operation === "register") return registerUpload(req, res, user);
    if (req.method === "POST" && req.body?.operation === "scan") return scanHandler(req, res, user);
    if (req.method === "PATCH") return updateHandler(req, res, user);
    if (req.method === "DELETE") return deleteHandler(req, res);
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error(`Receipt storage failed (${action || req.body?.operation || req.method})`, error?.message);
    return res.status(503).json({ error: "Bilagsmodulen kunne ikke fullføre handlingen." });
  }
};
