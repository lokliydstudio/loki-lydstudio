const { BlobPreconditionFailedError, get, put } = require("@vercel/blob");

const PREFIX = "loki-crm";

function isConfigured() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

function pathname(collection) {
  if (!/^[a-z-]+$/.test(collection)) throw new Error("Ugyldig samlingsnavn.");
  return `${PREFIX}/${collection}.json`;
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
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const previous = await get(pathname(collection), { access: "private", useCache: false });
    const parsed = previous ? JSON.parse(await new Response(previous.stream).text()) : { items: [] };
    const current = Array.isArray(parsed.items) ? parsed.items : [];
    const decision = await decide(current);
    if (decision?.error) return { error: decision.error };
    const payload = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), items: decision.items });
    try {
      await put(pathname(collection), payload, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: Boolean(previous),
        ...(previous ? { ifMatch: previous.blob.etag } : {}),
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
      });
      return { result: decision.result, items: decision.items };
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) && !(/already exists|already exist|precondition/i.test(String(error?.message || "")))) throw error;
    }
  }
  throw new Error("Samtidig endring i lagringen. Prøv på nytt.");
}

module.exports = { isConfigured, mutateCollection, readCollection, writeCollection };
