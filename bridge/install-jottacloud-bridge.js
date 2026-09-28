#!/usr/bin/env node
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { getBridgeSecret } = require("./keychain-secret");

const jobs = [
  { label: "no.lokilyd.crm.jottacloud-files", script: "jottacloud-file-sync.js", interval: 15 * 60, log: "jottacloud-files.log" },
  { label: "no.lokilyd.crm.jottacloud-index", script: "jottacloud-index.js", interval: 6 * 60 * 60, log: "jottacloud-index.log" },
];

function xml(value) {
  return String(value).replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]);
}

function plist(job, logDir) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(job.label)}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(path.join(__dirname, job.script))}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>${job.interval}</integer>
  <key>StandardOutPath</key><string>${xml(path.join(logDir, job.log))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logDir, job.log))}</string>
</dict></plist>
`;
}

async function main() {
  if (process.platform !== "darwin") throw new Error("Automatisk oppstart støttes her bare på macOS.");
  if (getBridgeSecret().length < 32) throw new Error("Lagre først brohemmeligheten i macOS Nøkkelring som loki-jotta-file-bridge.");
  const agentDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const logDir = path.join(os.homedir(), "Library", "Logs", "LokiCRM");
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
    await fs.writeFile(target, plist(job, logDir), { mode: 0o600 });
    execFileSync("/bin/launchctl", ["bootstrap", domain, target], { stdio: "pipe" });
    console.log(`Aktivert: ${job.label}`);
  }
}

main().catch((error) => { console.error(`Kunne ikke aktivere Jottacloud-broen: ${error.message}`); process.exitCode = 1; });
