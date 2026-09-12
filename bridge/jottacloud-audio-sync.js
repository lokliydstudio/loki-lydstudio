#!/usr/bin/env node
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");

const ROOT = process.env.JOTTA_AUDIO_ROOT || path.join(os.homedir(), "Jottacloud", "Loki Lydstudio", "Dokumenter (Cloud)", "CRM lydfiler");
const ENDPOINT = process.env.CRM_AUDIO_SYNC_ENDPOINT || "https://www.lokilyd.no/api/crm/audio-sync";
const SECRET = process.env.JOTTA_BRIDGE_SECRET;
const DRY_RUN = process.argv.includes("--dry-run");

function safeSegment(value, fallback) {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

async function api(pathname, options = {}) {
  const url = new URL(pathname, ENDPOINT);
  const response = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${SECRET}`, ...(options.headers || {}) },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response;
}

async function main() {
  if (!SECRET || SECRET.length < 32) throw new Error("JOTTA_BRIDGE_SECRET mangler eller er for kort.");
  const response = await api(ENDPOINT);
  const { tracks = [] } = await response.json();
  if (!tracks.length) {
    console.log("Ingen nye lydfiler venter på Jottacloud-synk.");
    return;
  }

  for (const track of tracks) {
    const projectFolder = path.join(ROOT, safeSegment(track.projectName, "Uten prosjekt"));
    const filename = `${safeSegment(track.id, "spor").slice(0, 14)}-${safeSegment(track.filename, "lydfil")}`;
    const destination = path.join(projectFolder, filename);
    if (DRY_RUN) {
      console.log(`Vil speile: ${destination}`);
      continue;
    }

    await fsp.mkdir(projectFolder, { recursive: true });
    try {
      await fsp.access(destination);
    } catch {
      const temporary = `${destination}.part`;
      const download = await api(track.downloadPath);
      if (!download.body) throw new Error(`Tomt svar for ${track.filename}`);
      await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(temporary, { flags: "wx" }));
      await fsp.rename(temporary, destination);
    }
    await api(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: track.id }),
    });
    console.log(`Speilet til Jottacloud: ${destination}`);
  }
}

main().catch((error) => {
  console.error(`Jottacloud lydsynk feilet: ${error.message}`);
  process.exitCode = 1;
});
