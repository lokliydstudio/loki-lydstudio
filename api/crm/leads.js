const crypto = require("crypto");
const { requireUser } = require("../../lib/crm-auth");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");

const STAGES = new Set(["Nytt lead", "Kontaktet", "Tilbud sendt", "Booket", "Tapt"]);

function cleanText(value, max = 250) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function sanitizeLead(input, existing = {}) {
  const email = cleanEmail(input?.email || existing.email);
  if (!email) return null;
  const requestedStage = cleanText(input?.stage || existing.stage || "Nytt lead", 40);
  return {
    id: cleanText(existing.id || input?.id, 120) || `lead-${crypto.randomUUID()}`,
    name: cleanText(input?.name || existing.name || email.split("@")[0], 120),
    email,
    project: cleanText(input?.project || existing.project || "Ny henvendelse", 300),
    stage: STAGES.has(requestedStage) ? requestedStage : "Nytt lead",
    value: Math.max(0, Math.min(Number(input?.value ?? existing.value ?? 0) || 0, 10_000_000)),
    source: cleanText(input?.source || existing.source || "Manuelt", 80),
    nextAction: cleanText(input?.nextAction || existing.nextAction || "Ta første kontakt", 180),
    firstSeenAt: existing.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
}

async function readLeads() {
  return readCollection("leads");
}

module.exports = async function handler(req, res) {
  if (!requireUser(req, res)) return;
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert ennå." });

  try {
    if (req.method === "GET") {
      return res.status(200).json({ leads: await readLeads(), persistent: true });
    }

    if (req.method === "POST") {
      const current = await readLeads();
      const incoming = req.body?.action === "upsertMany"
        ? (Array.isArray(req.body?.leads) ? req.body.leads.slice(0, 50) : [])
        : [req.body?.lead];
      let changed = false;

      for (const candidate of incoming) {
        const email = cleanEmail(candidate?.email);
        if (!email || email.endsWith("@lokilyd.no")) continue;
        const index = current.findIndex((lead) => cleanEmail(lead.email) === email);
        if (index >= 0) {
          const merged = sanitizeLead(candidate, current[index]);
          current[index] = { ...merged, id: current[index].id, stage: current[index].stage, value: current[index].value };
        } else {
          current.unshift(sanitizeLead(candidate));
        }
        changed = true;
      }

      if (changed) await writeCollection("leads", current);
      return res.status(200).json({ leads: current, persistent: true });
    }

    if (req.method === "PATCH") {
      const current = await readLeads();
      const id = cleanText(req.body?.id, 120);
      const index = current.findIndex((lead) => lead.id === id);
      if (index < 0) return res.status(404).json({ error: "Leadet ble ikke funnet." });
      const updated = sanitizeLead(req.body?.changes || {}, current[index]);
      current[index] = { ...updated, id: current[index].id, firstSeenAt: current[index].firstSeenAt };
      await writeCollection("leads", current);
      return res.status(200).json({ lead: current[index], persistent: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("CRM lead storage failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke oppdatere CRM-lagringen." });
  }
};
