const crypto = require("crypto");
const { requireUser } = require("../../lib/crm-auth");
const { leadPriority, mailPreferenceForLead, sortLeads, suppressedByMailPreference } = require("../../lib/crm-leads");
const { classifyEnvelope } = require("../../lib/crm-mail-sort");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");

const STAGES = new Set(["Nytt lead", "Kontaktet", "Tilbud sendt", "Booket", "Ferdig", "Tapt"]);

function cleanText(value, max = 250) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanLongText(value, max = 4000) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().slice(0, max);
}

function optionalValue(input, existing, key) {
  return Object.prototype.hasOwnProperty.call(input || {}, key) ? input[key] : existing[key];
}

function sanitizeLead(input, existing = {}) {
  const email = cleanEmail(input?.email || existing.email);
  if (!email) return null;
  const requestedStage = cleanText(input?.stage || existing.stage || "Nytt lead", 40);
  let source = cleanText(input?.source || existing.source || "Manuelt", 80);
  const category = cleanText(input?.category || existing.category || (source.toLowerCase() === "formspree" ? "formspree" : "customer"), 30);
  if (category === "customer" && source.toLowerCase() === "automatisk filtrert") source = "E-post";
  const messageKey = cleanText(input?.messageKey || existing.messageKey, 32).toLowerCase();
  const receivedAt = new Date(input?.receivedAt || existing.receivedAt || Date.now());
  const lead = {
    id: cleanText(existing.id || input?.id, 120) || `lead-${crypto.randomUUID()}`,
    name: cleanText(input?.name || existing.name || email.split("@")[0], 120),
    email,
    project: cleanText(input?.project || existing.project || "Ny henvendelse", 300),
    stage: STAGES.has(requestedStage) ? requestedStage : "Nytt lead",
    value: Math.max(0, Math.min(Number(input?.value ?? existing.value ?? 0) || 0, 10_000_000)),
    source,
    category: category === "formspree" ? "formspree" : "customer",
    messageKey: /^[a-f0-9]{32}$/.test(messageKey) ? messageKey : "",
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date().toISOString() : receivedAt.toISOString(),
    nextAction: cleanText(input?.nextAction || existing.nextAction || "Ta første kontakt", 180),
    phone: cleanText(optionalValue(input, existing, "phone"), 40),
    role: cleanText(optionalValue(input, existing, "role"), 60),
    artistName: cleanText(optionalValue(input, existing, "artistName"), 160),
    company: cleanText(optionalValue(input, existing, "company"), 160),
    website: cleanText(optionalValue(input, existing, "website"), 300),
    social: cleanText(optionalValue(input, existing, "social"), 300),
    location: cleanText(optionalValue(input, existing, "location"), 160),
    notes: cleanLongText(optionalValue(input, existing, "notes"), 5000),
    emailSummary: cleanLongText(optionalValue(input, existing, "emailSummary"), 4000),
    messageUid: Math.max(0, Math.min(Number.parseInt(optionalValue(input, existing, "messageUid"), 10) || 0, Number.MAX_SAFE_INTEGER)),
    profileCompleted: Boolean(optionalValue(input, existing, "profileCompleted")),
    firstSeenAt: existing.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  return { ...lead, priority: leadPriority(lead) };
}

function visibleLeads(leads, preferences) {
  return sortLeads(leads.filter((lead) => {
    if (suppressedByMailPreference(lead, preferences)) return false;
    const override = mailPreferenceForLead(lead, preferences);
    return classifyEnvelope({
      uid: lead.id,
      envelope: {
        from: [{ name: lead.name, address: lead.email }],
        subject: lead.project,
        messageId: `lead:${lead.id}`,
      },
    }, override).category !== "irrelevant";
  }).map((lead) => ({ ...lead, priority: leadPriority(lead) })));
}

async function readLeads(options = {}) {
  const [leads, preferences] = await Promise.all([
    readCollection("leads"),
    readCollection("mail-sort"),
  ]);
  const prioritized = sortLeads(leads.map((lead) => ({ ...lead, priority: leadPriority(lead) })));
  return options.includeHidden ? prioritized : visibleLeads(prioritized, preferences);
}

module.exports = async function handler(req, res) {
  if (!requireUser(req, res)) return;
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert ennå." });

  try {
    if (req.method === "GET") {
      return res.status(200).json({ leads: await readLeads(), persistent: true });
    }

    if (req.method === "POST") {
      const current = await readLeads({ includeHidden: true });
      const incoming = req.body?.action === "upsertMany"
        ? (Array.isArray(req.body?.leads) ? req.body.leads.slice(0, 50) : [])
        : [req.body?.lead];
      let changed = false;
      const seenEmails = new Set();

      for (const candidate of incoming) {
        const email = cleanEmail(candidate?.email);
        if (!email || email.endsWith("@lokilyd.no") || seenEmails.has(email)) continue;
        seenEmails.add(email);
        const index = current.findIndex((lead) => cleanEmail(lead.email) === email);
        if (index >= 0) {
          const merged = sanitizeLead(candidate, current[index]);
          current[index] = { ...merged, id: current[index].id, stage: current[index].stage, value: current[index].value };
        } else {
          current.unshift(sanitizeLead(candidate));
        }
        changed = true;
      }

      const prioritized = sortLeads(current.map((lead) => ({ ...lead, priority: leadPriority(lead) })));
      if (changed) await writeCollection("leads", prioritized);
      return res.status(200).json({ leads: await readLeads(), persistent: true });
    }

    if (req.method === "PATCH") {
      const current = await readLeads({ includeHidden: true });
      const id = cleanText(req.body?.id, 120);
      const index = current.findIndex((lead) => lead.id === id);
      if (index < 0) return res.status(404).json({ error: "Leadet ble ikke funnet." });
      const updated = sanitizeLead(req.body?.changes || {}, current[index]);
      current[index] = { ...updated, id: current[index].id, firstSeenAt: current[index].firstSeenAt };
      const prioritized = sortLeads(current);
      await writeCollection("leads", prioritized);
      return res.status(200).json({ lead: current[index], persistent: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("CRM lead storage failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke oppdatere CRM-lagringen." });
  }
};
