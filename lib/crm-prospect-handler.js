const crypto = require("crypto");
const { currentUser, requireUser } = require("./crm-auth");
const { discoverProspectContact, discoverProspects, mergeProspects, sanitizeProspect } = require("./crm-prospects");
const { readCollection, writeCollection } = require("./crm-store");

function cleanId(value) {
  return String(value || "").trim().slice(0, 120);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function cronAuthorized(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return safeEqual(token, process.env.CRON_SECRET);
}

function requestOidcToken(req) {
  return String(req?.headers?.["x-vercel-oidc-token"] || "").trim();
}

function discoveryErrorResponse(res, error, fallback) {
  console.error("Prospect discovery failed", error?.message);
  return res.status(503).json({
    error: error?.publicMessage || fallback,
    code: error?.code || "DISCOVERY_FAILED",
  });
}

function publicSummary(prospects, runs, req) {
  const active = prospects.filter((item) => !new Set(["Ikke relevant", "Ikke kontakt", "Konvertert"]).has(item.status));
  return {
    total: active.length,
    new: active.filter((item) => item.status === "Ny").length,
    review: active.filter((item) => item.status === "Vurderes").length,
    ready: active.filter((item) => item.status === "Klar for kontakt").length,
    contacted: active.filter((item) => new Set(["Kontaktet", "Svarte"]).has(item.status)).length,
    lastRun: runs[0] || null,
    discoveryConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || requestOidcToken(req)),
  };
}

async function createDraft(prospect) {
  const fallback = `Hei,\n\nVi heter Leon Frick og Charles Wise og driver Loki Lydstudio i Bergen.\nVi jobber med artister og musikere som ønsker å utvikle og ferdigstille musikken sin på et profesjonelt nivå.\n\nHos oss kan vi bistå gjennom hele prosessen – fra innspilling og produksjon til miks og mastering.\nVi ønsker nå å komme i kontakt med flere artister i Bergen som har ny musikk på gang, og ville derfor høre om du har et prosjekt du vurderer å spille inn eller videreutvikle.\n\nDersom det er aktuelt, tar vi gjerne en uforpliktende prat om prosjektet ditt og hva vi eventuelt kan bidra med.\n\nMed vennlig hilsen\nLeon Frick & Charles Wise\nLoki Lydstudio\nwww.lokilyd.no\npost@lokilyd.no`;
  if (process.env.AI_DRAFTS_ENABLED !== "true") return fallback;
  try {
    const { generateText } = await import("ai");
    const result = await generateText({
      model: process.env.AI_DRAFT_MODEL || "openai/gpt-5.4",
      system: "Du tilpasser Loki Lydstudios faste cold-call-mal til én mottaker. Skriv et kort, respektfullt og personlig første kontaktutkast på norsk. Behold de faktiske navnene Leon Frick og Charles Wise, nettstedet www.lokilyd.no og post@lokilyd.no. Ikke lat som dere kjenner mottakeren. Bruk bare opplysningene som er oppgitt. Ikke bruk press, overdreven ros, rabatt eller oppdiktede ledige tider. Nevn relevant studiobehov forsiktig. Avslutt med en enkel mulighet til å si nei til mer kontakt.",
      prompt: `Fast mal:\n${fallback}\n\nTilpass til:\nArtist/band: ${prospect.artistName || prospect.name}\nSted: ${prospect.location}\nSjanger: ${prospect.genre || "ikke oppgitt"}\nAktuelle tjenester: ${(prospect.services || []).join(", ") || "ikke avklart"}\nOffentlig signal: ${prospect.needEvidence || "ikke oppgitt"}\nHvorfor relevant: ${prospect.relevanceReason || "ikke oppgitt"}`,
      maxOutputTokens: 350,
      temperature: 0.35,
    });
    return String(result.text || fallback).slice(0, 5000);
  } catch (error) {
    console.error("Prospect draft failed", error?.message);
    return fallback;
  }
}

async function runDiscovery(actor, req) {
  const discovery = await discoverProspects({ oidcToken: requestOidcToken(req) });
  if (!discovery.configured) return { configured: false, reason: discovery.reason, prospects: null, added: 0, refreshed: 0 };
  const [current, runs] = await Promise.all([readCollection("cold-call-pool"), readCollection("cold-call-runs")]);
  const merged = mergeProspects(current, discovery.candidates, actor);
  const run = { id: `run-${Date.now()}`, checkedAt: new Date().toISOString(), added: merged.added, refreshed: merged.refreshed, candidates: discovery.candidates.length, status: "Ferdig", triggeredBy: actor };
  await Promise.all([
    writeCollection("cold-call-pool", merged.prospects.slice(0, 1000)),
    writeCollection("cold-call-runs", [run, ...runs].slice(0, 100)),
  ]);
  return { configured: true, ...merged, run };
}

async function prospectSyncHandler(req, res) {
  const user = currentUser(req);
  if (!user && !cronAuthorized(req)) return res.status(401).json({ error: "Innlogging kreves." });
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const result = await runDiscovery(user?.email || "vercel-cron", req);
  if (!result.configured) return res.status(200).json({ ok: true, configured: false, added: 0, message: "AI Gateway/OIDC eller OPENAI_API_KEY mangler; ingen kandidater ble hentet." });
  return res.status(200).json({ ok: true, configured: true, added: result.added, refreshed: result.refreshed });
}

async function prospectsHandler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  if (req.method === "GET") {
    const [prospects, runs] = await Promise.all([readCollection("cold-call-pool"), readCollection("cold-call-runs")]);
    return res.status(200).json({ prospects, summary: publicSummary(prospects, runs, req), persistent: true });
  }

  if (req.method === "POST" && req.body?.action === "discover") {
    let result;
    try {
      result = await runDiscovery(user.email, req);
    } catch (error) {
      return discoveryErrorResponse(res, error, "Kandidatsøket kunne ikke fullføres akkurat nå. Prøv igjen senere.");
    }
    if (!result.configured) return res.status(503).json({ error: "Automatisk nettsøk er klart, men Vercel AI Gateway/OIDC eller OPENAI_API_KEY må aktiveres først.", code: "DISCOVERY_NOT_CONFIGURED" });
    const runs = await readCollection("cold-call-runs");
    return res.status(200).json({ prospects: result.prospects, summary: publicSummary(result.prospects, runs, req), result: result.run });
  }

  if (req.method === "POST" && req.body?.action === "enrich") {
    const prospects = await readCollection("cold-call-pool");
    const id = cleanId(req.body?.id);
    const index = prospects.findIndex((item) => item.id === id);
    if (index < 0) return res.status(404).json({ error: "Kandidaten ble ikke funnet." });
    if (prospects[index].doNotContact || prospects[index].status === "Ikke kontakt") return res.status(409).json({ error: "Denne kandidaten er sperret mot videre behandling." });
    let discovery;
    try {
      discovery = await discoverProspectContact(prospects[index], { oidcToken: requestOidcToken(req) });
    } catch (error) {
      return discoveryErrorResponse(res, error, "Kontaktsøket kunne ikke fullføres akkurat nå. Prøv igjen senere.");
    }
    if (!discovery.configured) return res.status(503).json({ error: "AI Gateway er ikke tilgjengelig for kontaktsøk.", code: "DISCOVERY_NOT_CONFIGURED" });
    const changes = Object.fromEntries(Object.entries(discovery.contact || {}).filter(([, value]) => Boolean(value)));
    prospects[index] = sanitizeProspect(changes, prospects[index], user.email);
    await writeCollection("cold-call-pool", prospects);
    return res.status(200).json({ prospect: prospects[index], found: Object.keys(changes).some((key) => new Set(["publicEmail", "publicPhone", "contactName"]).has(key)) });
  }

  if (req.method === "POST" && req.body?.action === "draft") {
    const prospects = await readCollection("cold-call-pool");
    const id = cleanId(req.body?.id);
    const index = prospects.findIndex((item) => item.id === id);
    if (index < 0) return res.status(404).json({ error: "Kandidaten ble ikke funnet." });
    if (prospects[index].doNotContact || prospects[index].status === "Ikke kontakt") return res.status(409).json({ error: "Denne kandidaten er sperret mot kontakt." });
    const draft = await createDraft(prospects[index]);
    prospects[index] = sanitizeProspect({ outreachDraft: draft }, prospects[index], user.email);
    await writeCollection("cold-call-pool", prospects);
    return res.status(200).json({ prospect: prospects[index], draft });
  }

  if (req.method === "POST") {
    const prospect = sanitizeProspect(req.body?.prospect, {}, user.email);
    if (!prospect) return res.status(400).json({ error: "Artist- eller bandnavn må fylles ut." });
    const current = await readCollection("cold-call-pool");
    const merged = mergeProspects(current, [prospect], user.email);
    await writeCollection("cold-call-pool", merged.prospects.slice(0, 1000));
    return res.status(201).json({ prospect: merged.prospects.find((item) => item.id === prospect.id) || prospect, prospects: merged.prospects });
  }

  if (req.method === "PATCH") {
    const current = await readCollection("cold-call-pool");
    const id = cleanId(req.body?.id);
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) return res.status(404).json({ error: "Kandidaten ble ikke funnet." });
    const updated = sanitizeProspect(req.body?.changes || {}, current[index], user.email);
    if (!updated) return res.status(400).json({ error: "Artist- eller bandnavn må fylles ut." });
    current[index] = updated;
    current.sort((a, b) => Number(b.score) - Number(a.score) || new Date(b.foundAt) - new Date(a.foundAt));
    await writeCollection("cold-call-pool", current);
    return res.status(200).json({ prospect: updated, prospects: current });
  }

  if (req.method === "DELETE") {
    const current = await readCollection("cold-call-pool");
    const id = cleanId(req.query?.id || req.body?.id);
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) return res.status(404).json({ error: "Kandidaten ble ikke funnet." });
    current[index] = sanitizeProspect({ status: "Ikke kontakt", contactBasis: "Ikke kontakt", doNotContact: true, outreachDraft: "" }, current[index], user.email);
    await writeCollection("cold-call-pool", current);
    return res.status(200).json({ ok: true, prospect: current[index], prospects: current });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

module.exports = { createDraft, prospectSyncHandler, prospectsHandler, publicSummary, runDiscovery };
