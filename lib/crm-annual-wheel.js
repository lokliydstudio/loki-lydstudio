const MONTHS = [
  "Januar", "Februar", "Mars", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Desember",
];

const DEFAULT_MONTHS = [
  ["Planlegging og økonomi", [
    "Fastsette årsbudsjett og omsetningsmål.",
    "Lage oversikt over aktive kunder, prosjekter og leietakere.",
    "Kontrollere kontrakter, husleie og nøkler.",
    "Lage vedlikeholds- og innkjøpsplan.",
    "Kartlegge støtteordninger for året.",
  ]],
  ["Campforberedelser og salg", [
    "Ferdigstille deltakerliste og program for Loki Songs.",
    "Inngå avtaler med deltakere og samarbeidspartnere.",
    "Planlegge bemanning, rom, utstyr og mat.",
    "Kontakte nye artister og følge opp gamle leads.",
  ]],
  ["Loki Songs – 4.–6. mars", [
    "Gjennomføre låtskrivercampen.",
    "Registrere deltakelse og kostnader.",
    "Samle bilder, video og tilbakemeldinger.",
    "Følge opp aktuelle produksjoner og studiobookinger etter campen.",
    "Evaluere campen innen to uker.",
  ]],
  ["Oppfølging og utvikling", [
    "Følge opp musikk og relasjoner fra campen.",
    "Kontakte deltakere med tilbud om innspilling, produksjon og miks.",
    "Oppdatere nettside og portefølje.",
    "Kontrollere økonomien for første kvartal.",
  ]],
  ["Utstyr og lokaler", [
    "Teknisk kontroll av studioene.",
    "Vedlikeholde kabler, mikrofoner, patching, maskiner og akustikk.",
    "Prioritere innkjøp.",
    "Dokumentere behov til støttesøknader.",
  ]],
  ["Halvårsevaluering", [
    "Sammenligne omsetning, utgifter og timebruk med budsjettet.",
    "Vurdere priser og kapasitet.",
    "Rydde kontaktregisteret og prosjektarkivet.",
    "Planlegge høstens kampanjer og aktiviteter.",
  ]],
  ["Lavsesong og vedlikehold", [
    "Praktiske oppgraderinger og større vedlikehold.",
    "Backup av ferdige prosjekter til cold storage.",
    "Rydde Jottacloud og CRM-dokumenter.",
    "Produsere innhold til høstens markedsføring.",
  ]],
  ["Høstlansering og leads", [
    "Kampanje mot artister, band og studenter.",
    "Kontakte samarbeidspartnere og musikkutdanninger.",
    "Følge opp Cold Call Pool.",
    "Planlegge eventuelle høst- og vintercamper.",
  ]],
  ["Prosjektproduksjon", [
    "Prioritere innspilling, produksjon og miks.",
    "Følge opp alle tilbud og leads.",
    "Kontrollere timeføring og lønnsomhet per prosjekt.",
    "Vurdere åpne støtteordninger og prosjektmuligheter.",
  ]],
  ["Neste års camps og støtte", [
    "Bestemme foreløpige campdatoer og konsepter for 2028.",
    "Utarbeide budsjett og søknadstekster.",
    "Invitere mulige samarbeidspartnere.",
    "Kartlegge utstyrs- og lokalbehov for neste år.",
  ]],
  ["Budsjett og årsavslutning", [
    "Utarbeide foreløpig budsjett for 2028.",
    "Kontrollere ubetalte fakturaer og husleie.",
    "Gjennomgå leieavtaler.",
    "Prioritere søknader, investeringer og vedlikehold.",
  ]],
  ["Avslutning og evaluering", [
    "Avslutte og arkivere ferdige prosjekter.",
    "Ta full CRM- og prosjektbackup.",
    "Lage årsrapport for kunder, inntekter, timer, camps og resultater.",
    "Sette mål og publiseringsplan for 2028.",
  ]],
];

const DEFAULT_RHYTHMS = {
  weekly: [
    "Mandag: gjennomgå gjøreliste, bookinger og leads.",
    "Onsdag: følge opp ubesvarte Formspree-henvendelser og tilbud.",
    "Fredag: kontrollere timeføring, prosjektstatus og kommende uke.",
    "Følge opp nye leads innen én arbeidsdag.",
  ],
  monthly: [
    "Kontrollere husleiebetalinger og føre betalingsdato.",
    "Sende fakturaer og følge opp ubetalte krav i Fiken.",
    "Kontrollere bank, bilag og dokumentasjon.",
    "Oppdatere prosjektstatus og arkivere ferdige prosjekter.",
    "Gjennomgå støtteordninger og kommende frister.",
    "Ta backup av nye eller ferdigstilte prosjektdata.",
    "Publisere minst én relevant oppdatering fra studioet.",
    "Kontrollere at kundelenker og lydleveranser fungerer.",
  ],
  quarterly: [
    "Gjennomgå økonomi, omsetning og kostnader.",
    "Evaluere leads, tilbud, bookinger og konverteringsgrad.",
    "Gjennomgå leietakere, kontrakter og nøkler.",
    "Kontrollere utstyr, kabler, akustikk og programvare.",
    "Oppdatere innkjøpslisten.",
    "Ha strategimøte mellom Leon og Charles.",
  ],
};

const DEFAULT_GOALS = [
  "Øke antall leads som blir betalende studiokunder.",
  "Arrangere minst én profesjonelt gjennomført låtskrivercamp.",
  "Søke relevant støtte til utstyr og lokaleoppgraderinger.",
  "Holde alle prosjekter timeført og økonomisk dokumentert.",
  "Ha oppdatert oversikt over leietakere, kontrakter og betalinger.",
  "Arkivere og sikkerhetskopiere alle ferdige prosjekter.",
  "Bygge sterkere relasjoner til artister, produsenter og kulturaktører i Bergen.",
];

function cleanText(value, maxLength) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanItems(value, fallback = [], limit = 16) {
  if (!Array.isArray(value)) return [...fallback];
  return value.map((item) => cleanText(item, 400)).filter(Boolean).slice(0, limit);
}

function defaultAnnualWheel() {
  return {
    id: "loki-annual-wheel",
    year: 2027,
    title: "Loki Lydstudio",
    months: DEFAULT_MONTHS.map(([focus, items], index) => ({
      month: index + 1,
      name: MONTHS[index],
      focus,
      items: [...items],
    })),
    rhythms: [
      { id: "weekly", label: "Hver uke", items: [...DEFAULT_RHYTHMS.weekly] },
      { id: "monthly", label: "Hver måned", items: [...DEFAULT_RHYTHMS.monthly] },
      { id: "quarterly", label: "Hvert kvartal", items: [...DEFAULT_RHYTHMS.quarterly] },
    ],
    goals: [...DEFAULT_GOALS],
    updatedAt: "",
    updatedBy: "",
  };
}

function sanitizeAnnualWheel(input = {}, existing = defaultAnnualWheel(), userEmail = "") {
  const fallback = existing && typeof existing === "object" ? existing : defaultAnnualWheel();
  const defaults = defaultAnnualWheel();
  const requestedYear = Number(input.year ?? fallback.year);
  const year = Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= 2100 ? requestedYear : fallback.year;
  const inputMonths = Array.isArray(input.months) ? input.months : [];
  const fallbackMonths = Array.isArray(fallback.months) ? fallback.months : defaults.months;
  const inputRhythms = Array.isArray(input.rhythms) ? input.rhythms : [];
  const fallbackRhythms = Array.isArray(fallback.rhythms) ? fallback.rhythms : defaults.rhythms;

  return {
    id: "loki-annual-wheel",
    year,
    title: cleanText(input.title ?? fallback.title, 100) || "Loki Lydstudio",
    months: MONTHS.map((name, index) => {
      const proposed = inputMonths.find((month) => Number(month?.month) === index + 1) || inputMonths[index] || {};
      const previous = fallbackMonths.find((month) => Number(month?.month) === index + 1) || fallbackMonths[index] || defaults.months[index];
      return {
        month: index + 1,
        name,
        focus: cleanText(proposed.focus ?? previous.focus, 160),
        items: cleanItems(proposed.items, previous.items, 12),
      };
    }),
    rhythms: defaults.rhythms.map((definition) => {
      const proposed = inputRhythms.find((rhythm) => rhythm?.id === definition.id) || {};
      const previous = fallbackRhythms.find((rhythm) => rhythm?.id === definition.id) || definition;
      return {
        id: definition.id,
        label: definition.label,
        items: cleanItems(proposed.items, previous.items, 16),
      };
    }),
    goals: cleanItems(input.goals, fallback.goals || defaults.goals, 20),
    updatedAt: userEmail ? new Date().toISOString() : cleanText(input.updatedAt ?? fallback.updatedAt, 40),
    updatedBy: userEmail ? cleanText(userEmail, 160).toLowerCase() : cleanText(input.updatedBy ?? fallback.updatedBy, 160).toLowerCase(),
  };
}

module.exports = { MONTHS, defaultAnnualWheel, sanitizeAnnualWheel };
