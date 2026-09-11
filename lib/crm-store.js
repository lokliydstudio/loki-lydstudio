const { get, put } = require("@vercel/blob");

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

module.exports = { isConfigured, readCollection, writeCollection };
