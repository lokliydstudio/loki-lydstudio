const crypto = require("crypto");
const { requireUser } = require("../../lib/crm-auth");
const { leadPriority, mailPreferenceForLead, sortLeads, suppressedByMailPreference } = require("../../lib/crm-leads");
const { classifyEnvelope } = require("../../lib/crm-mail-sort");
const { sanitizeActivity } = require("../../lib/crm-operations");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");
const { decodeXlsxBase64, parseFikenContacts } = require("../../lib/fiken-contact-import");

const STAGES = new Set(["Nytt lead", "Kontaktet", "Tilbud sendt", "Booket", "Ferdig", "Tapt"]);
const ASSIGNEES = new Set(["Leon", "Charles", "Begge"]);
const CONTACT_METHODS = new Set(["E-post", "Telefon", "SMS", "Ingen preferanse"]);

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

function cleanDate(value) {
  const date = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function optionalValue(input, existing, key) {
  return Object.prototype.hasOwnProperty.call(input || {}, key) ? input[key] : existing[key];
}

function sanitizeLead(input, existing = {}) {
  const email = cleanEmail(optionalValue(input, existing, "email"));
  const phone = cleanText(optionalValue(input, existing, "phone"), 40);
  const name = cleanText(optionalValue(input, existing, "name") || email.split("@")[0], 120);
  if (!name) return null;
  const requestedStage = cleanText(input?.stage || existing.stage || "Nytt lead", 40);
  const normalizedStage = STAGES.has(requestedStage) ? requestedStage : "Nytt lead";
  let source = cleanText(input?.source || existing.source || "Manuelt", 80);
  const category = cleanText(input?.category || existing.category || (source.toLowerCase() === "formspree" ? "formspree" : "customer"), 30);
  if (category === "customer" && source.toLowerCase() === "automatisk filtrert") source = "E-post";
  const messageKey = cleanText(input?.messageKey || existing.messageKey, 32).toLowerCase();
  const receivedAt = new Date(input?.receivedAt || existing.receivedAt || Date.now());
  const assignee = cleanText(optionalValue(input, existing, "assignee") || "Begge", 20);
  const preferredContact = cleanText(optionalValue(input, existing, "preferredContact") || "E-post", 30);
  const lead = {
    id: cleanText(existing.id || input?.id, 120) || `lead-${crypto.randomUUID()}`,
    externalSource: cleanText(optionalValue(input, existing, "externalSource"), 40),
    externalId: cleanText(optionalValue(input, existing, "externalId"), 120),
    name,
    email,
    project: cleanText(input?.project || existing.project || "Ny henvendelse", 300),
    stage: normalizedStage,
    value: Math.max(0, Math.min(Number(input?.value ?? existing.value ?? 0) || 0, 10_000_000)),
    source,
    category: category === "formspree" ? "formspree" : "customer",
    messageKey: /^[a-f0-9]{32}$/.test(messageKey) ? messageKey : "",
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date().toISOString() : receivedAt.toISOString(),
    nextAction: cleanText(input?.nextAction || existing.nextAction || "Ta første kontakt", 180),
    followUpDate: new Set(["Ferdig", "Tapt"]).has(normalizedStage)
      ? ""
      : cleanDate(optionalValue(input, existing, "followUpDate")) || (!existing.id ? new Date(Date.now() + 86400000).toISOString().slice(0, 10) : ""),
    assignee: ASSIGNEES.has(assignee) ? assignee : "Begge",
    preferredContact: CONTACT_METHODS.has(preferredContact) ? preferredContact : "E-post",
    lostReason: cleanText(optionalValue(input, existing, "lostReason"), 300),
    phone,
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

function leadIsIrrelevant(lead, preferences) {
  if (suppressedByMailPreference(lead, preferences)) return true;
  const override = mailPreferenceForLead(lead, preferences);
  if (!override && new Set(["manuelt", "cold call pool", "fiken"]).has(String(lead.source || "").toLowerCase())) return false;
  return classifyEnvelope({
      uid: lead.id,
      envelope: {
        from: [{ name: lead.name, address: lead.email }],
        subject: lead.project,
        messageId: `lead:${lead.id}`,
      },
    }, override).category === "irrelevant";
}

function splitLeadViews(leads, preferences) {
  const annotated = sortLeads(leads.map((lead) => ({
    ...lead,
    priority: leadPriority(lead),
    relevance: leadIsIrrelevant(lead, preferences) ? "irrelevant" : "relevant",
  })));
  return {
    leads: annotated.filter((lead) => lead.relevance === "relevant"),
    irrelevantLeads: annotated.filter((lead) => lead.relevance === "irrelevant"),
    all: annotated,
  };
}

function visibleLeads(leads, preferences) {
  return splitLeadViews(leads, preferences).leads;
}

async function readLeads(options = {}) {
  const [leads, preferences] = await Promise.all([
    readCollection("leads"),
    readCollection("mail-sort"),
  ]);
  const prioritized = sortLeads(leads.map((lead) => ({ ...lead, priority: leadPriority(lead) })));
  return options.includeHidden ? prioritized : visibleLeads(prioritized, preferences);
}

async function leadViews() {
  const [leads, preferences] = await Promise.all([
    readCollection("leads"),
    readCollection("mail-sort"),
  ]);
  return splitLeadViews(leads, preferences);
}

async function handler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert ennå." });

  try {
    if (req.method === "GET") {
      const views = await leadViews();
      return res.status(200).json({ leads: views.leads, irrelevantLeads: views.irrelevantLeads, persistent: true });
    }

    if (req.method === "POST") {
      const current = await readLeads({ includeHidden: true });
      const importFromFiken = req.body?.action === "importFikenXlsx";
      let incoming;
      if (importFromFiken) {
        try {
          incoming = parseFikenContacts(decodeXlsxBase64(req.body?.fileBase64));
        } catch (importError) {
          return res.status(400).json({ error: importError?.message || "Kunne ikke lese Fiken-filen." });
        }
      } else {
        incoming = req.body?.action === "upsertMany"
          ? (Array.isArray(req.body?.leads) ? req.body.leads.slice(0, 50) : [])
          : [req.body?.lead];
      }
      let changed = false;
      const seenKeys = new Set();
      const createdLeads = [];
      const manuallyRestoredEmails = new Set();
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const candidate of incoming) {
        const email = cleanEmail(candidate?.email);
        const sourceName = String(candidate?.source || "").toLowerCase();
        const manual = new Set(["manuelt", "cold call pool", "fiken"]).has(sourceName);
        const externalSource = cleanText(candidate?.externalSource, 40).toLowerCase();
        const externalId = cleanText(candidate?.externalId, 120);
        const externalKey = externalSource && externalId ? `${externalSource}:${externalId}` : "";
        const candidateKey = externalKey || (email ? `email:${email}` : cleanText(candidate?.id, 120) ? `id:${cleanText(candidate.id, 120)}` : "");
        if ((!email && !manual) || (email.endsWith("@lokilyd.no") && !importFromFiken) || !candidateKey || seenKeys.has(candidateKey)) {
          skippedCount += 1;
          continue;
        }
        seenKeys.add(candidateKey);
        if (manual && email) manuallyRestoredEmails.add(email);
        const candidateId = cleanText(candidate?.id, 120);
        let matchedByExternalId = false;
        let index = externalKey
          ? current.findIndex((lead) => cleanText(lead.externalSource, 40).toLowerCase() === externalSource && cleanText(lead.externalId, 120) === externalId)
          : -1;
        if (index >= 0) matchedByExternalId = true;
        if (index < 0 && externalKey && email) {
          index = current.findIndex((lead) => cleanEmail(lead.email) === email && !cleanText(lead.externalId, 120));
        }
        if (index < 0 && !externalKey) {
          index = email
            ? current.findIndex((lead) => cleanEmail(lead.email) === email)
            : candidateId ? current.findIndex((lead) => lead.id === candidateId) : -1;
        }
        if (index >= 0) {
          const previous = current[index];
          const merged = sanitizeLead(candidate, previous);
          if (!merged) continue;
          current[index] = {
            ...merged,
            id: previous.id,
            stage: previous.stage,
            value: previous.value,
            ...(!matchedByExternalId && externalKey ? {
              project: previous.project,
              source: previous.source,
              nextAction: previous.nextAction,
              followUpDate: previous.followUpDate,
            } : {}),
          };
          updatedCount += 1;
        } else {
          const created = sanitizeLead(candidate);
          if (!created) continue;
          current.unshift(created);
          if (manual) createdLeads.push({ ...created, importedFromFiken: importFromFiken });
          createdCount += 1;
        }
        changed = true;
      }

      const prioritized = sortLeads(current.map((lead) => ({ ...lead, priority: leadPriority(lead) })));
      if (changed) {
        let restoredPreferences = null;
        if (manuallyRestoredEmails.size) {
          const preferences = await readCollection("mail-sort");
          const restored = preferences.filter((item) => !manuallyRestoredEmails.has(String(item.sender || "").toLowerCase()));
          if (restored.length !== preferences.length) restoredPreferences = restored;
        }
        await Promise.all([
          writeCollection("leads", prioritized),
          restoredPreferences ? writeCollection("mail-sort", restoredPreferences) : Promise.resolve(),
        ]);
        if (createdLeads.length) {
          try {
            const activities = await readCollection("activities");
            createdLeads.forEach((lead) => {
              const details = lead.importedFromFiken
                ? "Kontaktprofilen ble importert fra Fiken."
                : "Kunderelasjonen ble opprettet manuelt i CRM.";
              const activity = sanitizeActivity({ leadId: lead.id, type: "Status", details }, {}, user.email);
              if (activity) activities.unshift(activity);
            });
            await writeCollection("activities", activities.slice(0, 3000));
          } catch (activityError) {
            console.error("New lead activity log failed", activityError?.message);
          }
        }
      }
      const views = await leadViews();
      return res.status(200).json({
        leads: views.leads,
        irrelevantLeads: views.irrelevantLeads,
        persistent: true,
        ...(importFromFiken ? { import: { rows: incoming.length, created: createdCount, updated: updatedCount, skipped: skippedCount } } : {}),
      });
    }

    if (req.method === "PATCH") {
      const current = await readLeads({ includeHidden: true });
      const id = cleanText(req.body?.id, 120);
      const index = current.findIndex((lead) => lead.id === id);
      if (index < 0) return res.status(404).json({ error: "Leadet ble ikke funnet." });
      if (req.body?.action === "setRelevance") {
        const relevance = cleanText(req.body?.relevance, 20);
        if (!new Set(["relevant", "irrelevant"]).has(relevance)) {
          return res.status(400).json({ error: "Ugyldig sorteringsvalg." });
        }
        const lead = current[index];
        const preferences = await readCollection("mail-sort");
        const key = /^[a-f0-9]{32}$/.test(lead.messageKey || "")
          ? lead.messageKey
          : crypto.createHash("sha256").update(`lead:${lead.id}`).digest("hex").slice(0, 32);
        const sender = cleanEmail(lead.email);
        const nextPreferences = preferences.filter((item) => item.key !== key && (!sender || String(item.sender || "").toLowerCase() !== sender));
        nextPreferences.unshift({
          key,
          category: relevance === "irrelevant" ? "irrelevant" : "inbox",
          sender,
          updatedAt: new Date().toISOString(),
          updatedBy: user.email,
        });
        await writeCollection("mail-sort", nextPreferences.slice(0, 1000));
        try {
          const activities = await readCollection("activities");
          const details = relevance === "irrelevant"
            ? "Markert som ikke relevant. Nye meldinger fra avsenderen filtreres bort."
            : "Gjenopprettet som relevant kunderelasjon.";
          const activity = sanitizeActivity({ leadId: id, type: "Status", details }, {}, user.email);
          if (activity) {
            activities.unshift(activity);
            await writeCollection("activities", activities.slice(0, 3000));
          }
        } catch (activityError) {
          console.error("Lead relevance activity log failed", activityError?.message);
        }
        const views = await leadViews();
        return res.status(200).json({ leads: views.leads, irrelevantLeads: views.irrelevantLeads, persistent: true });
      }
      const previous = current[index];
      const updated = sanitizeLead(req.body?.changes || {}, current[index]);
      if (!updated) return res.status(400).json({ error: "Kunden må ha et navn." });
      current[index] = { ...updated, id: current[index].id, firstSeenAt: current[index].firstSeenAt };
      const prioritized = sortLeads(current);
      await writeCollection("leads", prioritized);
      const details = previous.stage !== updated.stage
        ? `Flyttet fra «${previous.stage}» til «${updated.stage}».`
        : "Kundeprofil og oppfølging ble oppdatert.";
      try {
        const activities = await readCollection("activities");
        const activity = sanitizeActivity({ leadId: id, type: previous.stage !== updated.stage ? "Status" : "Notat", details }, {}, user.email);
        if (activity) {
          activities.unshift(activity);
          await writeCollection("activities", activities.slice(0, 3000));
        }
      } catch (activityError) {
        console.error("Lead update activity log failed", activityError?.message);
      }
      return res.status(200).json({ lead: current[index], persistent: true });
    }

    if (req.method === "DELETE") {
      const current = await readLeads({ includeHidden: true });
      const id = cleanText(req.query?.id || req.body?.id, 120);
      const lead = current.find((item) => item.id === id);
      if (!lead) return res.status(404).json({ error: "Leadet ble ikke funnet." });
      const [activities, bookings, quotes, preferences] = await Promise.all([
        readCollection("activities"),
        readCollection("bookings"),
        readCollection("quotes"),
        readCollection("mail-sort"),
      ]);
      const linkedActivities = activities.filter((item) => item.leadId === id).length;
      const linkedBookings = bookings.filter((item) => item.leadId === id).length;
      const linkedQuotes = quotes.filter((item) => item.leadId === id).length;
      const nextPreferences = preferences.filter((item) => !lead.email || String(item.sender || "").toLowerCase() !== lead.email);
      if (lead.email) {
        const suppressionKey = crypto.createHash("sha256").update(`deleted-lead:${lead.email}`).digest("hex").slice(0, 32);
        nextPreferences.unshift({ key: suppressionKey, category: "irrelevant", sender: lead.email, updatedAt: new Date().toISOString(), updatedBy: user.email });
      }
      await Promise.all([
        writeCollection("leads", current.filter((item) => item.id !== id)),
        writeCollection("activities", activities.filter((item) => item.leadId !== id)),
        writeCollection("bookings", bookings.filter((item) => item.leadId !== id)),
        writeCollection("quotes", quotes.filter((item) => item.leadId !== id)),
        writeCollection("mail-sort", nextPreferences.slice(0, 1000)),
      ]);
      return res.status(200).json({ ok: true, deleted: { activities: linkedActivities, bookings: linkedBookings, quotes: linkedQuotes } });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("CRM lead storage failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke oppdatere CRM-lagringen." });
  }
}

module.exports = handler;
module.exports._test = { sanitizeLead, splitLeadViews };
