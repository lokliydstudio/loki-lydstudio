#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const { uploadPresigned } = require("@vercel/blob/client");
const { getBridgeSecret } = require("./keychain-secret");
const {
  MAX_DOCUMENT_SIZE,
  documentContentType,
  documentPathname,
  safeRelativePath,
  uploadArchivePath,
  validDocumentId,
} = require("../lib/crm-documents");

const ROOT = process.env.JOTTA_ROOT || path.join(os.homedir(), "Jottacloud", "Loki Lydstudio", "Dokumenter (Cloud)");
const ENDPOINT = process.env.CRM_DOCUMENTS_ENDPOINT || "https://www.lokilyd.no/api/crm/documents";
let secret = "";
const DRY_RUN = process.argv.includes("--dry-run");
const WATCH = process.argv.includes("--watch");
const INTERVAL_MS = 15 * 60_000;

function checkedJob(job, kind) {
  const id = validDocumentId(job?.id);
  const name = String(job?.name || "");
  const relativePath = safeRelativePath(job?.path);
  const version = String(job?.version || "");
  const expected = kind === "upload" ? uploadArchivePath(id, name) : documentPathname(id, name);
  if (!id || !relativePath || !version || !expected || (kind === "upload" && relativePath !== expected) ||
      (kind === "import" && job.pathname !== expected)) throw new Error("Ugyldig brojobb fra CRM.");
  return { id, name, path: relativePath, version, pathname: expected };
}

async function api(action, options = {}) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("action", action);
  if (options.id) url.searchParams.set("id", options.id);
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${secret}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response;
}

async function result(job, kind, success, error = "") {
  return api("", {
    method: "POST",
    body: {
      operation: "bridge-result", id: job.id, name: job.name,
      kind, version: job.version, success, error: String(error).slice(0, 180),
    },
  });
}

function withinRoot(root, target) {
  return target.startsWith(`${root}${path.sep}`);
}

async function safeExistingFile(root, relativePath) {
  const target = path.join(root, relativePath);
  const resolved = await fsp.realpath(target);
  if (!withinRoot(root, resolved)) throw new Error("Filen peker utenfor Jottacloud-mappen.");
  const stat = await fsp.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Ikke en vanlig Jottacloud-fil.");
  return { target, stat };
}

async function safeDestination(root, relativePath) {
  const segments = relativePath.split("/");
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    parent = path.join(parent, segment);
    try { await fsp.mkdir(parent); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = await fsp.lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Jottacloud-stien inneholder en lenke eller fil.");
  }
  const resolvedParent = await fsp.realpath(parent);
  if (resolvedParent !== root && !withinRoot(root, resolvedParent)) throw new Error("Målmappen er utenfor Jottacloud.");
  return path.join(parent, segments.at(-1));
}

async function hashFile(filename) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function exportToJotta(root, rawJob) {
  const job = checkedJob(rawJob, "upload");
  if (DRY_RUN) return console.log(`Vil lagre CRM-fil i Jottacloud: ${job.path}`);
  const destination = await safeDestination(root, job.path);
  const temporary = `${destination}.part-${crypto.randomUUID()}`;
  try {
    const response = await api("bridge-download", { id: job.id });
    if (!response.body) throw new Error("Tomt filinnhold fra CRM.");
    let transferred = 0;
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({ transform(chunk, _encoding, callback) {
        transferred += chunk.length;
        callback(transferred > MAX_DOCUMENT_SIZE ? new Error("Fil over 500 MB.") : null, chunk);
      } }),
      fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    if (transferred !== Number(rawJob.size)) throw new Error("Filstørrelsen stemmer ikke med CRM.");
    try {
      await fsp.link(temporary, destination);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await safeExistingFile(root, job.path);
      if (existing.stat.size !== transferred || await hashFile(existing.target) !== await hashFile(temporary)) {
        throw new Error("En annen fil finnes allerede på samme Jottacloud-sti.");
      }
    }
    await result(job, "upload", true);
    console.log(`Synkronisert til Jottacloud: ${job.path}`);
  } finally {
    await fsp.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function importFromJotta(root, rawJob) {
  const job = checkedJob(rawJob, "import");
  const { target, stat } = await safeExistingFile(root, job.path);
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error("Filen er over 500 MB.");
  if (DRY_RUN) return console.log(`Vil hente Jottacloud-fil til CRM: ${job.path}`);
  const file = await fs.openAsBlob(target, { type: documentContentType(job.name) });
  const handleUploadUrl = new URL(ENDPOINT);
  handleUploadUrl.searchParams.set("action", "upload");
  await uploadPresigned(job.pathname, file, {
    access: "private",
    contentType: documentContentType(job.name),
    handleUploadUrl: handleUploadUrl.toString(),
    headers: { authorization: `Bearer ${secret}` },
    clientPayload: JSON.stringify({ ...job, size: stat.size, bridgeImport: true }),
    multipart: true,
  });
  await result(job, "import", true);
  console.log(`Tilgjengelig for nedlasting i CRM: ${job.path}`);
}

async function runOnce() {
  secret = getBridgeSecret();
  if (secret.length < 32) throw new Error("JOTTA_FILE_BRIDGE_SECRET mangler eller er for kort.");
  const root = await fsp.realpath(ROOT);
  const response = await api("bridge-jobs");
  const jobs = await response.json();
  for (const [kind, entries, processJob] of [
    ["upload", jobs.uploads || [], exportToJotta],
    ["import", jobs.imports || [], importFromJotta],
  ]) {
    for (const rawJob of entries) {
      try {
        await processJob(root, rawJob);
      } catch (error) {
        console.error(`${kind === "upload" ? "Jottacloud-synk" : "CRM-import"} feilet: ${error.message}`);
        if (!DRY_RUN) {
          try { await result(checkedJob(rawJob, kind), kind, false, error.message); }
          catch (reportError) { console.error(`Kunne ikke rapportere brofeilen: ${reportError.message}`); }
        }
      }
    }
  }
}

async function main() {
  do {
    try { await runOnce(); }
    catch (error) { console.error(`Jottacloud-broen kunne ikke kjøre: ${error.message}`); if (!WATCH) process.exitCode = 1; }
    if (WATCH) await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  } while (WATCH);
}

if (require.main === module) main();
module.exports = { checkedJob, safeDestination, safeExistingFile };
