const { BlobNotFoundError, BlobPreconditionFailedError, get, head, put } = require("@vercel/blob");

const PREFIX = "loki-crm";

function isConfigured() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

function pathname(collection) {
  if (!/^[a-z-]+$/.test(collection)) throw new Error("Ugyldig samlingsnavn.");
  return `${PREFIX}/${collection}.json`;
}

function isMissingBlobError(error) {
  return error instanceof BlobNotFoundError || /requested blob does not exist/i.test(String(error?.message || ""));
}

async function headOrNull(blobPath) {
  try { return await head(blobPath); }
  catch (error) {
    if (isMissingBlobError(error)) return null;
    throw error;
  }
}

async function readCollection(collection) {
  if (!isConfigured()) throw new Error("CRM-lagringen er ikke konfigurert.");
  const result = await get(pathname(collection), { access: "private", useCache: false });
  if (!result) return [];
  const text = await new Response(result.stream).text();
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

async function writeCollection(collection, items) {
  if (!isConfigured()) throw new Error("CRM-lagringen er ikke konfigurert.");
  const payload = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), items });
  await put(pathname(collection), payload, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json; charset=utf-8",
  });
  return items;
}

async function mutateCollection(collection, decide, maxAttempts = 5) {
  if (!isConfigured()) throw new Error("CRM-lagringen er ikke konfigurert.");
  let lastConflict = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = await headOrNull(pathname(collection));
    const previous = await get(pathname(collection), { access: "private", useCache: false });
    if (Boolean(before) !== Boolean(previous)) {
      lastConflict = { reason: "changed between metadata and content read" };
      continue;
    }
    const parsed = previous ? JSON.parse(await new Response(previous.stream).text()) : { items: [] };
    const current = Array.isArray(parsed.items) ? parsed.items : [];
    const decision = await decide(current);
    if (decision?.error) return { error: decision.error };
    const latest = await headOrNull(pathname(collection));
    if (before?.etag !== latest?.etag) {
      lastConflict = { reason: "changed while preparing update" };
      continue;
    }
    const payload = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), items: decision.items });
    try {
      await put(pathname(collection), payload, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: Boolean(previous),
        ...(latest ? { ifMatch: latest.etag } : {}),
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
      });
      return { result: decision.result, items: decision.items };
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) && !(/already exists|already exist|precondition/i.test(String(error?.message || "")))) throw error;
      lastConflict = { name: error.name, message: error.message, hadPrevious: Boolean(previous), hadEtag: Boolean(latest?.etag) };
    }
  }
  console.error("CRM collection write conflict", collection, lastConflict);
  throw new Error("Samtidig endring i lagringen. Prøv på nytt.");
}

module.exports = { isConfigured, isMissingBlobError, mutateCollection, readCollection, writeCollection };
