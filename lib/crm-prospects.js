const crypto = require("crypto");

const STATUSES = new Set(["Ny", "Vurderes", "Klar for kontakt", "Kontaktet", "Svarte", "Konvertert", "Ikke relevant", "Ikke kontakt"]);
const CONTACT_BASES = new Set(["Ikke vurdert", "Uttrykkelig samtykke", "Eksisterende kundeforhold", "Manuelt godkjent", "Ikke kontakt"]);
const SERVICES = new Set(["Innspilling", "Miks", "Mastering", "Produksjon", "Podcast", "Annet"]);
const SOURCE_TYPES = new Set(["Offisiell nettside", "Instagram", "Facebook", "Musikkmedium", "Konsertprogram", "Annet"]);
const DEFAULT_OPENAI_MODEL = "gpt-5-nano";
const DEFAULT_GATEWAY_MODEL = "openai/gpt-5-nano";

function cleanText(value, max = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanLongText(value, max = 4000) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().slice(0, max);
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanPhone(value) {
  const phone = cleanText(value, 40);
  if (!phone || !/^[+()\d\s.-]+$/.test(phone)) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? phone : "";
}

function cleanUrl(value, allowedHosts = []) {
  const raw = cleanText(value, 1000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return "";
    if (url.username || url.password) return "";
    if (allowedHosts.length && !allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return "";
    return url.toString().slice(0, 1000);
  } catch {
    return "";
  }
}

function optional(input, existing, key) {
  return Object.prototype.hasOwnProperty.call(input || {}, key) ? input[key] : existing[key];
}

function normalizeServices(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const canonical = new Map([...SERVICES].map((service) => [service.toLowerCase(), service]));
  return [...new Set(list.map((item) => canonical.get(cleanText(item, 40).toLowerCase())).filter(Boolean))].slice(0, 6);
}

function prospectIdentityKeys(prospect) {
  return [
    prospect.publicEmail ? `email:${prospect.publicEmail}` : "",
    prospect.instagramUrl ? `instagram:${prospect.instagramUrl.replace(/\/$/, "").toLowerCase()}` : "",
    prospect.websiteUrl ? `website:${prospect.websiteUrl.replace(/\/$/, "").toLowerCase()}` : "",
    prospect.sourceUrl ? `source:${prospect.sourceUrl.replace(/\/$/, "").toLowerCase()}` : "",
    `name:${prospect.name.toLowerCase()}|${prospect.location.toLowerCase()}`,
  ].filter(Boolean);
}

function prospectKey(prospect) {
  return prospectIdentityKeys(prospect)[0];
}

function prospectScore(prospect) {
  let score = 10;
  const location = String(prospect.location || "").toLowerCase();
  if (/bergen|askøy|sotra|østera?øy|os|bjørnafjorden|vestland/.test(location)) score += 24;
  if (prospect.needEvidence) score += 22;
  if (prospect.publicEmail) score += 14;
  if (prospect.publicPhone) score += 10;
  if (prospect.contactName) score += 5;
  if (prospect.instagramUrl || prospect.facebookUrl) score += 8;
  if (prospect.websiteUrl) score += 6;
  if ((prospect.services || []).length) score += 10;
  if (prospect.adultConfirmed) score += 6;
  return Math.max(0, Math.min(100, score));
}

function sanitizeProspect(input, existing = {}, actor = "system") {
  const name = cleanText(optional(input, existing, "name"), 160);
  if (!name) return null;
  const statusInput = cleanText(optional(input, existing, "status") || "Ny", 40);
  const basisInput = cleanText(optional(input, existing, "contactBasis") || "Ikke vurdert", 50);
  const sourceTypeInput = cleanText(optional(input, existing, "sourceType") || "Annet", 50);
  const adultConfirmed = Boolean(optional(input, existing, "adultConfirmed"));
  const contactBasis = CONTACT_BASES.has(basisInput) ? basisInput : "Ikke vurdert";
  let status = STATUSES.has(statusInput) ? statusInput : "Ny";
  if (contactBasis === "Ikke kontakt") status = "Ikke kontakt";
  if (status === "Klar for kontakt" && (!adultConfirmed || contactBasis === "Ikke vurdert")) status = "Vurderes";
  const now = new Date().toISOString();
  const prospect = {
    id: cleanText(existing.id || input?.id, 120) || `prospect-${crypto.randomUUID()}`,
    name,
    artistName: cleanText(optional(input, existing, "artistName") || name, 160),
    type: cleanText(optional(input, existing, "type") || "Artist", 60),
    location: cleanText(optional(input, existing, "location") || "Bergen", 160),
    genre: cleanText(optional(input, existing, "genre"), 160),
    services: normalizeServices(optional(input, existing, "services")),
    needEvidence: cleanLongText(optional(input, existing, "needEvidence"), 1200),
    relevanceReason: cleanLongText(optional(input, existing, "relevanceReason"), 1200),
    contactName: cleanText(optional(input, existing, "contactName"), 160),
    contactRole: cleanText(optional(input, existing, "contactRole"), 160),
    publicEmail: cleanEmail(optional(input, existing, "publicEmail")),
    publicPhone: cleanPhone(optional(input, existing, "publicPhone")),
    contactSourceUrl: cleanUrl(optional(input, existing, "contactSourceUrl")),
    contactSourceName: cleanText(optional(input, existing, "contactSourceName"), 200),
    websiteUrl: cleanUrl(optional(input, existing, "websiteUrl")),
    instagramUrl: cleanUrl(optional(input, existing, "instagramUrl"), ["instagram.com"]),
    facebookUrl: cleanUrl(optional(input, existing, "facebookUrl"), ["facebook.com", "fb.com"]),
    sourceUrl: cleanUrl(optional(input, existing, "sourceUrl")),
    sourceName: cleanText(optional(input, existing, "sourceName"), 200),
    sourceType: SOURCE_TYPES.has(sourceTypeInput) ? sourceTypeInput : "Annet",
    status,
    adultConfirmed,
    contactBasis,
    doNotContact: status === "Ikke kontakt" || Boolean(optional(input, existing, "doNotContact")),
    notes: cleanLongText(optional(input, existing, "notes"), 5000),
    outreachDraft: cleanLongText(optional(input, existing, "outreachDraft"), 5000),
    foundAt: existing.foundAt || cleanText(input?.foundAt, 40) || now,
    lastVerifiedAt: cleanText(optional(input, existing, "lastVerifiedAt"), 40) || now,
    lastContactedAt: cleanText(optional(input, existing, "lastContactedAt"), 40),
    createdBy: existing.createdBy || cleanText(actor, 254),
    updatedBy: cleanText(actor, 254),
    updatedAt: now,
  };
  if (prospect.doNotContact) {
    prospect.status = "Ikke kontakt";
    prospect.contactBasis = "Ikke kontakt";
  }
  return { ...prospect, score: prospectScore(prospect) };
}

function mergeProspects(current, incoming, actor = "system") {
  const next = current.map((item) => sanitizeProspect(item, item, item.updatedBy || actor)).filter(Boolean);
  let added = 0;
  let refreshed = 0;
  for (const candidate of incoming.slice(0, 30)) {
    const clean = sanitizeProspect(candidate, {}, actor);
    if (!clean) continue;
    const identities = new Set(prospectIdentityKeys(clean));
    const index = next.findIndex((item) => prospectIdentityKeys(item).some((key) => identities.has(key)));
    if (index < 0) {
      next.unshift(clean);
      added += 1;
      continue;
    }
    const prior = next[index];
    if (prior.doNotContact || prior.status === "Ikke relevant" || prior.status === "Konvertert") continue;
    next[index] = sanitizeProspect({
      ...clean,
      contactName: clean.contactName || prior.contactName,
      contactRole: clean.contactRole || prior.contactRole,
      publicEmail: clean.publicEmail || prior.publicEmail,
      publicPhone: clean.publicPhone || prior.publicPhone,
      contactSourceUrl: clean.contactSourceUrl || prior.contactSourceUrl,
      contactSourceName: clean.contactSourceName || prior.contactSourceName,
      status: prior.status,
      adultConfirmed: prior.adultConfirmed,
      contactBasis: prior.contactBasis,
      notes: prior.notes,
      outreachDraft: prior.outreachDraft,
    }, prior, actor);
    refreshed += 1;
  }
  return { prospects: next.sort((a, b) => Number(b.score) - Number(a.score) || new Date(b.foundAt) - new Date(a.foundAt)), added, refreshed };
}

function responseText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  return (response?.output || []).flatMap((item) => item?.content || []).filter((item) => item?.type === "output_text").map((item) => item.text).join("\n");
}

function discoveryModel(directOpenAi) {
  return process.env.LEAD_DISCOVERY_MODEL || (directOpenAi ? DEFAULT_OPENAI_MODEL : DEFAULT_GATEWAY_MODEL);
}

function discoveryFailure(operation, status, detail) {
  const suffix = detail ? `: ${detail}` : ".";
  const error = new Error(`${operation} feilet hos AI Gateway (${status})${suffix}`);
  error.code = status === 403 ? "DISCOVERY_MODEL_UNAVAILABLE" : status === 429 ? "DISCOVERY_RATE_LIMITED" : "DISCOVERY_UPSTREAM_FAILED";
  error.publicMessage = status === 403
    ? "AI Gateway avviste modellen eller mangler tilgjengelige kreditter. Modelltilgangen kan kontrolleres i Vercel."
    : status === 429
      ? "AI Gateway har for mange forespørsler akkurat nå. Prøv igjen om litt."
      : `${operation} kunne ikke fullføres akkurat nå. Prøv igjen senere.`;
  return error;
}

async function discoverProspects(options = {}) {
  const directOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || options.oidcToken;
  if (!apiKey) return { configured: false, candidates: [], reason: "AI Gateway/OIDC eller OPENAI_API_KEY mangler" };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "artistName", "type", "location", "genre", "services", "needEvidence", "relevanceReason", "contactName", "contactRole", "publicEmail", "publicPhone", "contactSourceUrl", "contactSourceName", "websiteUrl", "instagramUrl", "facebookUrl", "sourceUrl", "sourceName", "sourceType"],
          properties: {
            name: { type: "string" }, artistName: { type: "string" }, type: { type: "string" }, location: { type: "string" }, genre: { type: "string" },
            services: { type: "array", items: { type: "string", enum: [...SERVICES] } },
            needEvidence: { type: "string" }, relevanceReason: { type: "string" }, contactName: { type: "string" }, contactRole: { type: "string" },
            publicEmail: { type: "string" }, publicPhone: { type: "string" }, contactSourceUrl: { type: "string" }, contactSourceName: { type: "string" }, websiteUrl: { type: "string" },
            instagramUrl: { type: "string" }, facebookUrl: { type: "string" }, sourceUrl: { type: "string" }, sourceName: { type: "string" },
            sourceType: { type: "string", enum: [...SOURCE_TYPES] },
          },
        },
      },
    },
  };
  const prompt = `Finn opptil 6 lovende, aktive og fremadstormende artister eller band som holder til i Bergen eller tydelig er knyttet til Bergens musikkliv. Se etter offentlige signaler om ny musikk, demo, release, konsertaktivitet eller annet som gjør innspilling, miks, mastering eller produksjon relevant for Loki Lydstudio. Finn også uttrykkelig publisert profesjonell kontaktinformasjon når det finnes. Bruk maksimalt to nettsøk.\n\nPersonvern og kvalitet:\n- Ikke søk etter eller gjett alder. Ikke ta med noen som kilden oppgir er under 18 år.\n- Bruk bare åpne, profesjonelle artist-/bandsider og offentlige nettsider; aldri private personprofiler eller innlogget innhold.\n- Ikke finn eller utled private telefonnumre, privatadresser eller personlige e-poster. publicEmail og publicPhone må være uttrykkelig publisert som booking-, management-, presse- eller annen profesjonell kontakt.\n- contactName og contactRole skal bare fylles ut når personen er offentlig oppført som manager, bookingkontakt, presse-/labelkontakt eller bandets profesjonelle kontaktperson.\n- contactSourceUrl må peke direkte til siden som dokumenterer kontaktinformasjonen. Ikke kopier kontaktdata fra kataloger som ikke viser hvem som har publisert dem.\n- Ikke gjett behov eller kontaktinformasjon. Beskriv observerbart behovssignal med kort kildebevis.\n- sourceUrl må være den mest konkrete offentlige siden som dokumenterer kandidaten.\n- Instagram/Facebook skal bare være offentlig profil-URL; ingen scraping eller skjult data.\n- Returner tom streng når et felt ikke kan dokumenteres.\n- Unngå etablerte nasjonale artister som åpenbart ikke passer et lokalt studiolead.`;
  const response = await fetch(directOpenAi ? "https://api.openai.com/v1/responses" : "https://ai-gateway.vercel.sh/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: discoveryModel(directOpenAi),
      store: false,
      tools: [{ type: "web_search", search_context_size: "low" }],
      max_tool_calls: 2,
      max_output_tokens: 3200,
      reasoning: { effort: "minimal" },
      input: prompt,
      text: { format: { type: "json_schema", name: "bergen_music_prospects", strict: true, schema } },
    }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const detail = String(failure?.error?.message || failure?.error || "").trim().slice(0, 300);
    throw discoveryFailure("Kandidatsøket", response.status, detail);
  }
  const data = await response.json();
  const parsed = JSON.parse(responseText(data));
  const candidates = (Array.isArray(parsed.candidates) ? parsed.candidates : [])
    .filter((candidate) => cleanUrl(candidate?.sourceUrl))
    .filter((candidate) => /bergen|askøy|sotra|østera?øy|os|bjørnafjorden|vestland/i.test(String(candidate?.location || "")))
    .map((candidate) => cleanUrl(candidate?.contactSourceUrl) ? candidate : {
      ...candidate,
      contactName: "",
      contactRole: "",
      publicEmail: "",
      publicPhone: "",
      contactSourceUrl: "",
      contactSourceName: "",
    });
  return { configured: true, candidates };
}

async function discoverProspectContact(prospect, options = {}) {
  const directOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || options.oidcToken;
  if (!apiKey) return { configured: false, contact: {}, reason: "AI Gateway/OIDC eller OPENAI_API_KEY mangler" };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["contactName", "contactRole", "publicEmail", "publicPhone", "contactSourceUrl", "contactSourceName"],
    properties: {
      contactName: { type: "string" },
      contactRole: { type: "string" },
      publicEmail: { type: "string" },
      publicPhone: { type: "string" },
      contactSourceUrl: { type: "string" },
      contactSourceName: { type: "string" },
    },
  };
  const prompt = `Finn offentlig publisert profesjonell kontaktinformasjon for denne artisten eller dette bandet:\nArtist/band: ${prospect.artistName || prospect.name}\nSted: ${prospect.location || "Bergen"}\nNettside: ${prospect.websiteUrl || "ikke oppgitt"}\nKjent kilde: ${prospect.sourceUrl || "ikke oppgitt"}\n\nBruk maksimalt tre nettsøk. Prioriter artistens offisielle kontaktside, management, bookingbyrå, label eller arrangørside. publicEmail og publicPhone skal bare fylles ut når opplysningen uttrykkelig er publisert for booking, management, presse eller annen profesjonell kontakt. contactName og contactRole skal bare fylles ut når personen er offentlig oppført i denne rollen. Ikke bruk private personprofiler, private telefonnumre, privatadresser, datameglere eller innlogget innhold. Ikke gjett eller utled noe. contactSourceUrl må være den konkrete åpne siden som dokumenterer opplysningene. Hvis ingen konkret kontaktperson, profesjonell e-post eller profesjonell telefon kan dokumenteres, skal alle seks feltene være tomme strenger.`;
  const response = await fetch(directOpenAi ? "https://api.openai.com/v1/responses" : "https://ai-gateway.vercel.sh/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: discoveryModel(directOpenAi),
      store: false,
      tools: [{ type: "web_search", search_context_size: "low" }],
      max_tool_calls: 2,
      max_output_tokens: 700,
      reasoning: { effort: "minimal" },
      input: prompt,
      text: { format: { type: "json_schema", name: "professional_music_contact", strict: true, schema } },
    }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const detail = String(failure?.error?.message || failure?.error || "").trim().slice(0, 300);
    throw discoveryFailure("Kontaktsøket", response.status, detail);
  }
  const data = await response.json();
  const parsed = JSON.parse(responseText(data));
  const contactSourceUrl = cleanUrl(parsed.contactSourceUrl);
  const contactName = cleanText(parsed.contactName, 160);
  const publicEmail = cleanEmail(parsed.publicEmail);
  const publicPhone = cleanPhone(parsed.publicPhone);
  if (!contactSourceUrl || (!contactName && !publicEmail && !publicPhone)) return { configured: true, contact: {} };
  return {
    configured: true,
    contact: {
      contactName,
      contactRole: cleanText(parsed.contactRole, 160),
      publicEmail,
      publicPhone,
      contactSourceUrl,
      contactSourceName: cleanText(parsed.contactSourceName, 200),
    },
  };
}

module.exports = {
  CONTACT_BASES,
  SERVICES,
  STATUSES,
  cleanUrl,
  discoveryModel,
  discoverProspectContact,
  discoverProspects,
  mergeProspects,
  prospectKey,
  prospectScore,
  sanitizeProspect,
};
