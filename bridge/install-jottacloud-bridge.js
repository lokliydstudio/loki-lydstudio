#!/usr/bin/env node
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { getBridgeSecret } = require("./keychain-secret");

const RUNTIME_FILES = [
  "bridge/jottacloud-file-sync.js",
  "bridge/jottacloud-index.js",
  "bridge/keychain-secret.js",
  "lib/crm-documents.js",
];

const jobs = [
  { label: "no.lokilyd.crm.jottacloud-files", script: "jottacloud-file-sync.js", interval: 15 * 60, log: "jottacloud-files.log" },
  { label: "no.lokilyd.crm.jottacloud-index", script: "jottacloud-index.js", interval: 6 * 60 * 60, log: "jottacloud-index.log" },
];

function xml(value) {
  return String(value).replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]);
}

function plist(job, logDir, runtimeDir) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(job.label)}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(path.join(runtimeDir, "bridge", job.script))}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>${job.interval}</integer>
  <key>StandardOutPath</key><string>${xml(path.join(logDir, job.log))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logDir, job.log))}</string>
</dict></plist>
`;
}

async function prepareRuntime(runtimeDir) {
  const projectDir = path.resolve(__dirname, "..");
  await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  const blobVersion = JSON.parse(await fs.readFile(path.join(projectDir, "node_modules", "@vercel", "blob", "package.json"), "utf8")).version;
  const manifestPath = path.join(runtimeDir, "package.json");
  const expectedManifest = { private: true, dependencies: { "@vercel/blob": blobVersion } };
  let installedVersion = "";
  try { installedVersion = JSON.parse(await fs.readFile(path.join(runtimeDir, "node_modules", "@vercel", "blob", "package.json"), "utf8")).version; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (installedVersion !== blobVersion) {
    await fs.writeFile(manifestPath, `${JSON.stringify(expectedManifest, null, 2)}\n`, { mode: 0o600 });
    execFileSync("/usr/local/bin/npm", ["install", "--prefix", runtimeDir, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      stdio: "pipe", timeout: 120000,
    });
  }
  for (const relative of RUNTIME_FILES) {
    const destination = path.join(runtimeDir, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.copyFile(path.join(projectDir, relative), destination);
    await fs.chmod(destination, 0o600);
  }
  return runtimeDir;
}

async function main() {
  if (process.platform !== "darwin") throw new Error("Automatisk oppstart støttes her bare på macOS.");
  if (getBridgeSecret().length < 32) throw new Error("Lagre først brohemmeligheten i macOS Nøkkelring som loki-jotta-file-bridge.");
  const agentDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const logDir = path.join(os.homedir(), "Library", "Logs", "LokiCRM");
  const runtimeDir = path.join(os.homedir(), "Library", "Application Support", "LokiCRM", "bridge-runtime");
  await prepareRuntime(runtimeDir);
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  const domain = `gui/${process.getuid()}`;
  for (const job of jobs) {
    const target = path.join(agentDir, `${job.label}.plist`);
    let previous = "";
    try { previous = await fs.readFile(target, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (previous && !previous.includes(`<string>${job.label}</string>`)) throw new Error(`Eksisterende tjeneste har uventet innhold: ${target}`);
    if (previous) {
      try { execFileSync("/bin/launchctl", ["bootout", `${domain}/${job.label}`], { stdio: "ignore" }); } catch {}
    }
    await fs.writeFile(target, plist(job, logDir, runtimeDir), { mode: 0o600 });
    execFileSync("/bin/launchctl", ["bootstrap", domain, target], { stdio: "pipe" });
    console.log(`Aktivert: ${job.label}`);
  }
}

main().catch((error) => { console.error(`Kunne ikke aktivere Jottacloud-broen: ${error.message}`); process.exitCode = 1; });
