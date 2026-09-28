const { execFileSync } = require("node:child_process");

function getBridgeSecret() {
  if (process.env.JOTTA_FILE_BRIDGE_SECRET) return process.env.JOTTA_FILE_BRIDGE_SECRET;
  if (process.env.JOTTA_BRIDGE_SECRET) return process.env.JOTTA_BRIDGE_SECRET;
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync("/usr/bin/security", [
      "find-generic-password", "-a", "loki-crm", "-s", "loki-jotta-file-bridge", "-w",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

module.exports = { getBridgeSecret };
