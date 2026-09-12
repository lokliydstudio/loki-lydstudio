#!/usr/bin/env node
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const ROOT = process.env.JOTTA_ROOT || path.join(os.homedir(), "Jottacloud", "Loki Lydstudio", "Dokumenter (Cloud)");
const ENDPOINT = process.env.CRM_DOCUMENTS_ENDPOINT || "https://www.lokilyd.no/api/crm/documents";
const SECRET = process.env.JOTTA_BRIDGE_SECRET;
const DRY_RUN = process.argv.includes("--dry-run");
const BLOCKED = new Set(["mikser (cloud)", "prosjekter (cloud)", "crm lydfiler", "passord", "password", "passwords", "innlogging", "innlogginger", "login", "logins"]);

function isBlocked(relativePath) {
  return relativePath.toLowerCase().split(path.sep).some((part) => BLOCKED.has(part));
}

function documentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if ([".xlsx", ".xls", ".csv"].includes(ext)) return "Regneark";
  if ([".doc", ".docx", ".odt", ".pages"].includes(ext)) return "Tekstdokument";
  if (ext === ".pdf") return "PDF";
  if ([".ppt", ".pptx", ".key"].includes(ext)) return "Presentasjon";
  return ext ? ext.slice(1).toUpperCase() : "Dokument";
}

async function walk(folder, output = []) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(folder, entry.name);
    const relative = path.relative(ROOT, absolute);
    if (isBlocked(relative)) continue;
    if (entry.isDirectory()) await walk(absolute, output);
    else if (entry.isFile()) {
      const stat = await fs.stat(absolute);
      output.push({ path: relative.split(path.sep).join("/"), name: entry.name, type: documentType(entry.name), size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  return output;
}

async function main() {
  const documents = await walk(ROOT);
  if (DRY_RUN) {
    console.log(`Fant ${documents.length} dokumenter. Ingen data ble sendt.`);
    return;
  }
  if (!SECRET || SECRET.length < 32) throw new Error("JOTTA_BRIDGE_SECRET mangler eller er for kort.");
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ documents }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  console.log(`Indekserte ${result.count} dokumenter uten å laste opp filinnhold.`);
}

main().catch((error) => {
  console.error(`Jottacloud-indeksering feilet: ${error.message}`);
  process.exitCode = 1;
});
