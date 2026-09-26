const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.CRM_AUTH_SECRET = "test-only-secret-that-is-longer-than-thirty-two-characters";
process.env.MAIL_ADDRESS = "post@lokilyd.no";
process.env.MAIL_USERNAME = "lokilyd1";
process.env.MAIL_PASSWORD = "test-only-password";

const auth = require("../lib/crm-auth");
const { audioPathname, sanitizeTrack } = require("../lib/crm-audio");
const { cleanTimestamp, commentsForTrack, sanitizeAudioComment } = require("../lib/crm-audio-comments");
const { calendarFeedUrl, parseIcsCalendar, parseIcsDate } = require("../lib/crm-calendar");
const { documentPathname, jottacloudDocumentUrl, mergeDocumentIndex, publicDocument, sanitizeIndexedDocument, sanitizeUploadedDocument } = require("../lib/crm-documents");
const { dateMentions, plainText } = require("../lib/crm-funding");
const { inferLeadDetails, normalizePhone } = require("../lib/crm-lead-enrichment");
const { classifyEnvelope } = require("../lib/crm-mail-sort");
const { isOpenLead, leadPriority, mailPreferenceForLead, sortLeads, suppressedByMailPreference } = require("../lib/crm-leads");
const { mailConfig, sendMail } = require("../lib/crm-mail");
const { openGrant, sealGrant, summarizeFiken } = require("../lib/crm-fiken");
const { bookingConflict, sanitizeActivity, sanitizeBooking, sanitizeQuote } = require("../lib/crm-operations");
const { ONLINE_WINDOW_MS, presenceCollection, presenceHeartbeat, presenceLogin, presenceOffline, presenceOwners, presenceStatus } = require("../lib/crm-presence");
const { actorName, notificationPayload, publicKey: pushPublicKey, publicSubscriptionStatus, sanitizeSubscription, taskNotification } = require("../lib/crm-push");
const { apnsBearerToken, sanitizeNativeDevice } = require("../lib/crm-native-push");
const { createProjectExport, planProjectDeletion } = require("../lib/crm-project-export");
const { parseSpotifyUrl, sanitizePatch, sanitizeProject, sanitizeSpotifyReferences, sanitizeTimeEntries } = require("../lib/crm-projects");
const { cleanContractPath, cleanJottacloudUrl, paymentId, sanitizePayment, sanitizeRoomKeys, sanitizeTenant, seedRentalItems, splitRentalItems } = require("../lib/crm-rentals");
const { cleanUrl, discoveryModel, mergeProspects, prospectKey, prospectScore, sanitizeProspect } = require("../lib/crm-prospects");
const { decodeXlsxBase64, fikenContactsFromRows } = require("../lib/fiken-contact-import");
const { publicSummary } = require("../lib/crm-prospect-handler");
const { sanitizeGoal, sanitizeNote, sanitizeTask } = require("../lib/crm-workspace");
const {
  bookingConflict: tenantBookingConflict,
  SESSION_MAX_AGE_SECONDS,
  createLoginChallenge: createTenantLoginChallenge,
  createSessionToken: createTenantSessionToken,
  publicAccount: publicTenantAccount,
  sanitizeAccount: sanitizeTenantAccount,
  sanitizeBooking: sanitizeTenantBooking,
  sessionCookie: tenantSessionCookie,
  sessionFromRequest: tenantSessionFromRequest,
  verifyLoginCode: verifyTenantLoginCode,
} = require("../lib/tenant-booking");
const { sanitizeLead, splitLeadViews } = require("../api/crm/leads")._test;

test("only active owners can receive CRM tokens", () => {
  const token = auth.createToken("leon@lokilyd.no", "login", 60);
  assert.equal(auth.verifyToken(token, "login").email, "leon@lokilyd.no");
  assert.equal(auth.createToken("charles@lokilyd.no", "login", 60) !== null, true);
  assert.equal(auth.createToken("daniel@lokilyd.no", "login", 60), null);
});

test("CRM shell includes an accessible persistent theme switcher", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "theme.js"), "utf8");
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /aria-label="Bytt til dark mode"/);
  assert.match(html, /crmplatform\/theme\.css/);
  assert.match(html, /crmplatform\/theme\.js/);
  assert.match(script, /loki-crm-theme/);
  assert.match(script, /aria-pressed/);
  assert.equal(html.indexOf('class="workspace-grid"') < html.indexOf('class="panel rental-workbook"'), true);
  assert.equal(html.indexOf('class="panel rental-workbook"') < html.indexOf('class="panel goals-panel"'), true);
});

test("tokens cannot be reused for another purpose", () => {
  const token = auth.createToken("leon@lokilyd.no", "login", 60);
  assert.equal(auth.verifyToken(token, "session"), null);
});

test("email login challenges issue a six-digit code bound to email and browser", () => {
  const challenge = auth.createLoginChallenge("leon@lokilyd.no", 60);
  assert.match(challenge.code, /^\d{6}$/);
  assert.equal(auth.verifyToken(challenge.token, "login-code").email, "leon@lokilyd.no");

  const req = { headers: { cookie: `loki_crm_login_challenge=${encodeURIComponent(challenge.token)}` } };
  assert.equal(auth.verifyLoginCode(req, "leon@lokilyd.no", challenge.code).email, "leon@lokilyd.no");
  assert.equal(auth.verifyLoginCode(req, "charles@lokilyd.no", challenge.code), null);
  assert.equal(auth.verifyLoginCode(req, "leon@lokilyd.no", "000000"), null);
  assert.match(auth.loginChallengeCookie(challenge.token), /HttpOnly; Secure; SameSite=Strict; Max-Age=900/);
});

test("a valid emailed code creates an owner session and consumes the browser challenge", async () => {
  const handler = require("../api/crm/auth-request");
  const challenge = auth.createLoginChallenge("charles@lokilyd.no", 60);
  const result = { headers: {} };
  const req = {
    method: "POST",
    body: { email: "charles@lokilyd.no", code: challenge.code },
    headers: {
      cookie: `loki_crm_login_challenge=${encodeURIComponent(challenge.token)}`,
      "x-forwarded-for": "192.0.2.44",
    },
  };
  const res = {
    setHeader(name, value) { result.headers[name] = value; return this; },
    status(value) { result.status = value; return this; },
    json(value) { result.body = value; return value; },
  };
  await handler(req, res);
  assert.equal(result.status, 200);
  assert.equal(result.body.user.email, "charles@lokilyd.no");
  assert.equal(Array.isArray(result.headers["Set-Cookie"]), true);
  assert.match(result.headers["Set-Cookie"][0], /^loki_crm_session=/);
  assert.match(result.headers["Set-Cookie"][1], /^loki_crm_login_challenge=;/);
});

test("CRM owner sessions persist on a device and renew on a valid status check", async () => {
  assert.equal(auth.SESSION_MAX_AGE_SECONDS, 60 * 60 * 24 * 400);
  const cookie = auth.sessionCookie("leon@lokilyd.no");
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict; Max-Age=34560000/);
  const token = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
  assert.equal(auth.verifyToken(token, "session").email, "leon@lokilyd.no");
  const handler = require("../api/crm/auth-status");
  const result = { headers: {} };
  await handler({ method: "GET", headers: { cookie: cookie.split(";")[0] } }, {
    setHeader(name, value) { result.headers[name] = value; return this; },
    status(value) { result.status = value; return this; },
    json(value) { result.body = value; return value; },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.user.email, "leon@lokilyd.no");
  assert.match(result.headers["Set-Cookie"], /^loki_crm_session=/);
});

test("mobile tasks shortcut uses the private CRM workspace and its own start URL", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "tasks.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "tasks.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "crm-tasks.webmanifest"), "utf8"));
  assert.equal(manifest.start_url, "/crmplatform/tasks.html");
  assert.match(html, /Legg til på Hjem-skjerm/);
  assert.match(script, /\/api\/crm\/auth-status/);
  assert.match(script, /\/api\/studio\?action=workspace/);
  assert.match(script, /method: "PATCH"/);
  assert.match(script, /method: "POST"/);
});

test("CRM login offers both an emailed one-time code and a secure link", () => {
  const login = fs.readFileSync(path.join(__dirname, "..", "crm-login.html"), "utf8");
  const request = fs.readFileSync(path.join(__dirname, "..", "api", "crm", "auth-request.js"), "utf8");
  assert.match(login, /id="code-form"/);
  assert.match(login, /autocomplete="one-time-code"/);
  assert.match(login, /\/api\/crm\/auth-request/);
  assert.match(login, /Du kan også trykke på innloggingslenken/);
  assert.match(request, /Din engangskode til Loki Studio/);
  assert.match(request, /Logg inn med lenke/);
  assert.match(request, /verifyLoginCode/);
  assert.match(request, /clearLoginChallengeCookie/);
  assert.match(request, /presenceLogin/);
});

test("CRM has a dedicated touch-safe mobile layout", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "index.html"), "utf8");
  const mobile = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "mobile.css"), "utf8");
  assert.match(html, /crmplatform\/mobile\.css/);
  assert.match(mobile, /@media screen and \(max-width: 760px\)/);
  assert.match(mobile, /position: fixed !important/);
  assert.match(mobile, /safe-area-inset-bottom/);
  assert.match(mobile, /\.inbox-list-panel \{ max-height: 58dvh/);
  assert.match(mobile, /\.crm-category-switch[\s\S]*overflow-x: auto/);
  assert.match(mobile, /\.google-calendar-grid \{ min-width: 650px/);
  assert.match(mobile, /font-size: 16px !important/);
});

test("customer listening tokens are scoped and expire independently of owner access", () => {
  const token = auth.createScopedToken("track-123", "audio-share", 60);
  assert.equal(auth.verifyScopedToken(token, "audio-share").subject, "track-123");
  assert.equal(auth.verifyScopedToken(token, "session"), null);
  assert.equal(auth.verifyToken(token, "audio-share"), null);
});

test("project patches preserve chosen channels and enforce the 32-channel interface limit", () => {
  const patch = sanitizePatch([
    { channel: 1, source: "Vokal", microphone: "U87", phantom: true },
    { channel: 32, source: "Talkback", destination: "ADAT 32" },
    { channel: 33, source: "Skal avvises" },
  ]);
  assert.equal(patch.length, 2);
  assert.deepEqual(patch.map((row) => row.channel), [1, 32]);
  assert.equal(patch[0].source, "Vokal");
  assert.equal(patch[0].phantom, true);
  assert.equal(patch[1].destination, "ADAT 32");
  assert.deepEqual(sanitizePatch([]), []);
  assert.equal(sanitizePatch().length, 32);
});

test("projects sanitize status, email and patch data", () => {
  const project = sanitizeProject({
    name: "  Ny   singel  ",
    clientEmail: "ARTIST@EXAMPLE.COM",
    status: "Ikke gyldig",
    patch: [{ channel: 2, source: "Kick in" }],
  });
  assert.equal(project.name, "Ny singel");
  assert.equal(project.clientEmail, "artist@example.com");
  assert.equal(project.status, "Planlegges");
  assert.equal(project.patch.length, 1);
  assert.equal(project.patch[0].channel, 2);
  assert.equal(project.patch[0].source, "Kick in");
  assert.deepEqual(sanitizeProject({ patch: [] }, project).patch, []);
});

test("project workspace can add and remove patch channels up to 32", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "index.html"), "utf8");
  const studio = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "studio.js"), "utf8");
  assert.match(html, /patch-dynamic\.css/);
  assert.match(studio, /id="add-patch-channel"/);
  assert.match(studio, /data-remove-channel/);
  assert.match(studio, /Maks 32 kanaler/);
  assert.match(studio, /removeEmptyPatchChannels/);
});

test("project time entries keep billable studio categories and valid hours", () => {
  const entries = sanitizeTimeEntries([
    { id: "one", date: "2026-09-15", category: "Innspilling", hours: 2.5, worker: "Leon", notes: "Vokal" },
    { id: "two", date: "2026-09-16", category: "Editering", hours: 1.25, worker: "Charles" },
    { id: "three", date: "2026-09-17", category: "Miks", hours: 3, worker: "Leon" },
    { id: "invalid-category", category: "Mastering", hours: 4 },
    { id: "invalid-hours", category: "Miks", hours: 25 },
  ]);
  assert.deepEqual(entries.map((entry) => entry.category), ["Innspilling", "Editering", "Miks"]);
  assert.deepEqual(entries.map((entry) => entry.hours), [2.5, 1.25, 3]);
  assert.equal(entries[0].notes, "Vokal");
});

test("project workspace exposes per-project time logging and backup", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "index.html"), "utf8");
  const studio = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "studio.js"), "utf8");
  assert.match(html, /project-time\.css/);
  assert.match(studio, /Timer på prosjektet/);
  assert.match(studio, /Innspilling/);
  assert.match(studio, /Editering/);
  assert.match(studio, /data-delete-time/);
  assert.match(studio, /timelogg\.csv/);
  assert.match(studio, /timeTotals\(project\)\.total/);
});

test("projects keep only canonical Spotify reference tracks and playlists", () => {
  const references = sanitizeSpotifyReferences([
    { url: "https://open.spotify.com/playlist/37i9dQZF1DX4JAvHpjipBk?si=secret", title: "Miksepalett", note: "Rom og trommer" },
    { url: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", title: "Vokalreferanse" },
    { url: "https://open.spotify.com/playlist/37i9dQZF1DX4JAvHpjipBk", title: "Duplikat" },
    { url: "https://evil.example/playlist/37i9dQZF1DX4JAvHpjipBk", title: "Avvises" },
  ]);
  assert.equal(references.length, 2);
  assert.equal(references[0].url, "https://open.spotify.com/playlist/37i9dQZF1DX4JAvHpjipBk");
  assert.equal(references[0].embedUrl, "https://open.spotify.com/embed/playlist/37i9dQZF1DX4JAvHpjipBk");
  assert.equal(references[0].note, "Rom og trommer");
  assert.equal(references[1].type, "track");
  assert.equal(parseSpotifyUrl("https://open.spotify.com/intl-no/album/4aawyAB9vmqN3uQ7FjRGTy").type, "album");
  assert.equal(parseSpotifyUrl("https://open.spotify.com.evil.example/track/4uLU6hMCjMI75M1A2tKUQC"), null);

  const project = sanitizeProject({ spotifyReferences: references });
  assert.equal(project.spotifyReferences.length, 2);
});

test("project workspace embeds Spotify references behind the CRM CSP", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "index.html"), "utf8");
  const studio = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "studio.js"), "utf8");
  const vercel = fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8");
  assert.match(html, /spotify-references\.css/);
  assert.match(studio, /Referanselåter/);
  assert.match(studio, /spotify-reference-form/);
  assert.match(studio, /open\.spotify\.com\/embed/);
  assert.match(vercel, /frame-src https:\/\/open\.spotify\.com/);
});

test("Fiken customer exports become complete archived contact profiles", () => {
  const contacts = fikenContactsFromRows([
    {
      Navn: "VANARY AS",
      Kundenr: "10022",
      Orgnr: "930674958",
      "E-post": "POST@VANARY.NO",
      Telefon: "55555555",
      Adresse: "Testveien 1",
      Postnr: "5003",
      Poststed: "Bergen",
      Land: "Norge",
      Kontaktperson: "Kari Test",
    },
    { Navn: "VANARY RECORDS AS", Kundenr: "10023", Orgnr: "922182973", "E-post": "post@vanary.no" },
    { Navn: "Kunde uten kontaktkanal", Kundenr: "10024" },
  ]);
  assert.equal(contacts.length, 3);
  assert.deepEqual(contacts.map((contact) => contact.id), ["fiken-customer-10022", "fiken-customer-10023", "fiken-customer-10024"]);
  assert.equal(contacts[0].email, "POST@VANARY.NO");
  assert.equal(contacts[0].stage, "Ferdig");
  assert.equal(contacts[0].profileCompleted, true);
  assert.match(contacts[0].notes, /Organisasjonsnummer: 930674958/);
  assert.match(contacts[0].notes, /Kontaktperson: Kari Test/);
  assert.equal(contacts[2].preferredContact, "Ingen preferanse");
  assert.equal(decodeXlsxBase64(Buffer.from("xlsx").toString("base64")).toString(), "xlsx");
});

test("Fiken contacts keep stable external identifiers and no artificial follow-up", () => {
  const lead = sanitizeLead({
    name: "Fiken-kunde",
    source: "Fiken",
    stage: "Ferdig",
    externalSource: "Fiken",
    externalId: "10024",
    profileCompleted: true,
  });
  assert.equal(lead.externalSource, "Fiken");
  assert.equal(lead.externalId, "10024");
  assert.equal(lead.followUpDate, "");
  assert.equal(splitLeadViews([lead], []).leads.length, 1);
});

test("contact register exposes an authenticated Fiken XLSX importer", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "index.html"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "fiken-import.js"), "utf8");
  const api = fs.readFileSync(path.join(__dirname, "..", "api", "crm", "leads.js"), "utf8");
  assert.match(html, /id="import-fiken-contacts"/);
  assert.match(html, /accept="\.xlsx/);
  assert.match(client, /importFikenXlsx/);
  assert.match(client, /credentials: "same-origin"/);
  assert.match(api, /parseFikenContacts/);
  assert.match(api, /externalSource/);
});

test("Cold Call Pool keeps only safe public contact fields and gates outreach readiness", () => {
  const prospect = sanitizeProspect({
    name: "  Bergensbandet  ",
    artistName: "Bergensbandet",
    location: "Bergen",
    contactName: "Kari Booking",
    contactRole: "Bookingansvarlig",
    publicEmail: "BOOKING@BAND.NO",
    publicPhone: "+47 55 12 34 56",
    contactSourceUrl: "https://band.no/kontakt",
    instagramUrl: "https://instagram.com/bergensbandet",
    facebookUrl: "javascript:alert(1)",
    services: ["Innspilling", "Miks", "Ukjent"],
    status: "Klar for kontakt",
    contactBasis: "Ikke vurdert",
    adultConfirmed: false,
    needEvidence: "Har offentlig annonsert arbeid med en ny EP.",
  }, {}, "leon@lokilyd.no");
  assert.equal(prospect.name, "Bergensbandet");
  assert.equal(prospect.publicEmail, "booking@band.no");
  assert.equal(prospect.publicPhone, "+47 55 12 34 56");
  assert.equal(prospect.contactName, "Kari Booking");
  assert.equal(prospect.contactRole, "Bookingansvarlig");
  assert.equal(prospect.contactSourceUrl, "https://band.no/kontakt");
  assert.equal(prospect.facebookUrl, "");
  assert.deepEqual(prospect.services, ["Innspilling", "Miks"]);
  assert.equal(prospect.status, "Vurderes");
  assert.equal(prospect.score >= 70, true);
  assert.equal(cleanUrl("https://instagram.com/example", ["instagram.com"]).startsWith("https://instagram.com/"), true);
  assert.equal(cleanUrl("https://example.com/not-instagram", ["instagram.com"]), "");
  assert.equal(sanitizeProspect({ name: "Band B", publicPhone: "ring-me<script>" }).publicPhone, "");
});

test("Cold Call Pool deduplicates public identities and preserves suppression", () => {
  const blocked = sanitizeProspect({ name: "Band A", publicEmail: "hei@band.no", status: "Ikke kontakt", contactBasis: "Ikke kontakt" });
  const merged = mergeProspects([blocked], [{ name: "Band A ny", publicEmail: "hei@band.no", location: "Bergen", needEvidence: "Ny singel" }]);
  assert.equal(merged.prospects.length, 1);
  assert.equal(merged.prospects[0].status, "Ikke kontakt");
  assert.equal(merged.added, 0);
  assert.equal(prospectKey(merged.prospects[0]), "email:hei@band.no");
  assert.equal(prospectScore({ location: "Bergen", needEvidence: "Ny musikk", services: ["Miks"] }) > prospectScore({ location: "Oslo", services: [] }), true);
});

test("Cold Call Pool refresh preserves previously documented contact details", () => {
  const existing = sanitizeProspect({
    name: "Bandet",
    artistName: "Bandet",
    location: "Bergen",
    websiteUrl: "https://bandet.no",
    contactName: "Kari Booking",
    contactRole: "Manager",
    publicEmail: "booking@bandet.no",
    publicPhone: "+47 55 12 34 56",
    contactSourceUrl: "https://bandet.no/kontakt",
  });
  const incoming = { name: "Bandet", artistName: "Bandet", location: "Bergen", websiteUrl: "https://bandet.no" };
  const merged = mergeProspects([existing], [incoming], "system");
  assert.equal(merged.prospects.length, 1);
  assert.equal(merged.prospects[0].contactName, "Kari Booking");
  assert.equal(merged.prospects[0].publicEmail, "booking@bandet.no");
  assert.equal(merged.prospects[0].publicPhone, "+47 55 12 34 56");
});

test("Cold Call Pool recognizes Vercel runtime OIDC headers", () => {
  const summary = publicSummary([], [], { headers: { "x-vercel-oidc-token": "short-lived-test-token" } });
  assert.equal(summary.discoveryConfigured, true);
});

test("Cold Call Pool defaults to a Vercel free-tier compatible discovery model", () => {
  const configured = process.env.LEAD_DISCOVERY_MODEL;
  delete process.env.LEAD_DISCOVERY_MODEL;
  try {
    assert.equal(discoveryModel(false), "openai/gpt-5-nano");
    assert.equal(discoveryModel(true), "gpt-5-nano");
    process.env.LEAD_DISCOVERY_MODEL = "openai/custom-model";
    assert.equal(discoveryModel(false), "openai/custom-model");
  } finally {
    if (configured === undefined) delete process.env.LEAD_DISCOVERY_MODEL;
    else process.env.LEAD_DISCOVERY_MODEL = configured;
  }
});

test("document uploads use private safe paths and reject active web content", () => {
  const id = "document-123e4567-e89b-12d3-a456-426614174000";
  assert.equal(documentPathname(id, "Avtale 2026.pdf"), `loki-crm/documents/${id}/Avtale-2026.pdf`);
  assert.equal(documentPathname(id, "nettside.html"), "");
  assert.equal(documentPathname("short", "avtale.pdf"), "");
  assert.equal(sanitizeIndexedDocument({ path: "Passord /hemmelig.pdf" }), null);
  assert.equal(sanitizeIndexedDocument({ path: "Mikser (Cloud)/opptak.pdf" }), null);
});

test("indexed documents get authenticated Jottacloud deep links", () => {
  const indexed = sanitizeIndexedDocument({ path: "Markedsføring/Avtale #1.pdf", size: 100 });
  const visible = publicDocument(indexed);
  assert.equal(visible.available, true);
  assert.equal(visible.downloadable, false);
  assert.equal(visible.status, "Jottacloud");
  assert.equal(
    visible.jottacloudUrl,
    "https://jottacloud.com/web/sync/list/name/Loki%20Lydstudio/Dokumenter%20%28Cloud%29/Markedsf%C3%B8ring/Avtale%20%231.pdf",
  );
  assert.equal(jottacloudDocumentUrl("Passord/hemmelig.pdf"), "");
  const legacyVisible = publicDocument({ ...indexed, source: undefined, note: "Gammel indeksrad" });
  assert.equal(legacyVisible.available, true);
  assert.equal(legacyVisible.jottacloudUrl, visible.jottacloudUrl);
});

test("document reindexing preserves private uploads without exposing storage metadata", () => {
  const path = "Avtaler/Studioavtale.pdf";
  const indexed = mergeDocumentIndex([{ path, name: "Studioavtale.pdf", type: "PDF", size: 100, modifiedAt: "2026-09-01" }], []);
  const pathname = documentPathname(indexed[0].id, indexed[0].name);
  const uploaded = sanitizeUploadedDocument(
    { id: indexed[0].id, name: indexed[0].name, path },
    { pathname, size: 100, contentType: "application/pdf" },
    "leon@lokilyd.no",
    indexed[0],
  );
  const refreshed = mergeDocumentIndex([{ path, name: "Studioavtale.pdf", type: "PDF", size: 100, modifiedAt: "2026-09-02" }], [uploaded]);
  assert.equal(refreshed[0].pathname, pathname);
  assert.equal(refreshed[0].status, "Tilgjengelig");
  const visible = publicDocument(refreshed[0]);
  assert.equal(visible.available, true);
  assert.equal("pathname" in visible, false);
  assert.equal("uploadedBy" in visible, false);
});

test("project exports include only selected project files and no private blob details", () => {
  const projects = [
    { id: "project-1", name: "Første", patch: [], spotifyReferences: [{ id: "spotify-1", title: "Miksereferanser", type: "playlist", spotifyId: "37i9dQZF1DX4JAvHpjipBk", url: "https://open.spotify.com/playlist/37i9dQZF1DX4JAvHpjipBk", embedUrl: "https://open.spotify.com/embed/playlist/37i9dQZF1DX4JAvHpjipBk" }] },
    { id: "project-2", name: "Andre", patch: [] },
  ];
  const tracks = [
    { id: "track-1", projectId: "project-1", filename: "miks.wav", title: "Miks", version: "V1", size: 120, contentType: "audio/wav", pathname: "loki-crm/private/track-1", uploadedBy: "leon@lokilyd.no" },
    { id: "track-2", projectId: "project-2", filename: "demo.mp3", title: "Demo", version: "V2", size: 80, contentType: "audio/mpeg", pathname: "loki-crm/private/track-2", uploadedBy: "charles@lokilyd.no" },
  ];
  const comments = [{
    id: "comment-1",
    trackId: "track-1",
    timestampSeconds: 34,
    body: "Basstrommen er litt høy her.",
    authorName: "Kari",
    authorType: "customer",
    createdAt: "2026-09-14T07:00:00.000Z",
  }];
  const manifest = createProjectExport(projects, tracks, "project-1", comments);
  assert.equal(manifest.scope, "project");
  assert.deepEqual(manifest.projects.map((project) => project.id), ["project-1"]);
  assert.deepEqual(manifest.files.map((file) => file.trackId), ["track-1"]);
  assert.equal(manifest.files[0].downloadUrl, "/api/studio?action=internal-stream&id=track-1");
  assert.equal("pathname" in manifest.projects[0].tracks[0], false);
  assert.equal("uploadedBy" in manifest.projects[0].tracks[0], false);
  assert.equal(JSON.stringify(manifest).includes("loki-crm/private"), false);
  assert.equal(manifest.projects[0].tracks[0].comments[0].timestampSeconds, 34);
  assert.equal(manifest.projects[0].spotifyReferences[0].title, "Miksereferanser");
});

test("project deletion cascades to its audio metadata only", () => {
  const projects = [{ id: "project-1" }, { id: "project-2" }];
  const tracks = [
    { id: "track-1", projectId: "project-1" },
    { id: "track-2", projectId: "project-1" },
    { id: "track-3", projectId: "project-2" },
  ];
  const deletion = planProjectDeletion(projects, tracks, "project-1");
  assert.deepEqual(deletion.attachedTracks.map((track) => track.id), ["track-1", "track-2"]);
  assert.deepEqual(deletion.remainingProjects.map((project) => project.id), ["project-2"]);
  assert.deepEqual(deletion.remainingTracks.map((track) => track.id), ["track-3"]);
  assert.equal(planProjectDeletion(projects, tracks, "missing"), null);
});

test("client ZIP creates a valid archive response", async () => {
  const { downloadZip } = await import("client-zip");
  const archive = new Uint8Array(await downloadZip([{ name: "README.txt", input: "Hei", size: 4 }]).arrayBuffer());
  assert.deepEqual([...archive.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(new TextDecoder().decode(archive).includes("README.txt"), true);
});

test("audio metadata must match a private CRM pathname and supported audio type", () => {
  const id = "track-123e4567-e89b-12d3-a456-426614174000";
  const pathname = audioPathname(id, "Min miks.wav");
  assert.equal(pathname, `loki-crm/audio/${id}/Min-miks.wav`);
  const track = sanitizeTrack(
    { id, projectId: "project-1", filename: "Min miks.wav", pathname, title: "Min miks" },
    { pathname, size: 12_000_000, contentType: "audio/wav" },
    "leon@lokilyd.no",
  );
  assert.equal(track.filename, "Min-miks.wav");
  assert.equal(track.jottaSyncedAt, null);
  assert.equal(sanitizeTrack(
    { id, projectId: "project-1", filename: "Min miks.wav", pathname: "public/min-miks.wav" },
    { pathname: "public/min-miks.wav", size: 100, contentType: "audio/wav" },
    "leon@lokilyd.no",
  ), null);
});

test("audio feedback is timestamped, sanitized and scoped to one track", () => {
  const trackId = "track-123e4567-e89b-12d3-a456-426614174000";
  const customer = sanitizeAudioComment({
    trackId,
    timestampSeconds: 34.26,
    authorName: "  Kari  ",
    body: "  Basstrommen er litt høy her.  ",
  }, { type: "customer" });
  const studio = sanitizeAudioComment({
    trackId,
    timestampSeconds: -4,
    body: "Vi senker den 1 dB.",
  }, { type: "studio", email: "leon@lokilyd.no" });
  assert.equal(customer.timestampSeconds, 34.3);
  assert.equal(customer.authorName, "Kari");
  assert.equal(customer.body, "Basstrommen er litt høy her.");
  assert.equal(studio.authorName, "Leon");
  assert.equal(studio.timestampSeconds, 0);
  assert.equal(cleanTimestamp(100_000), 43_200);
  assert.deepEqual(commentsForTrack([customer, studio, { ...customer, trackId: "track-other" }], trackId).map((comment) => comment.id), [studio.id, customer.id]);
  assert.equal(sanitizeAudioComment({ trackId, authorName: "Kari", body: "" }, { type: "customer" }), null);
});

test("mix feedback is available in both internal and customer players", () => {
  const studioApi = fs.readFileSync(path.join(__dirname, "..", "api", "studio.js"), "utf8");
  const internalScript = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "studio.js"), "utf8");
  const customerPlayer = fs.readFileSync(path.join(__dirname, "..", "lytt", "index.html"), "utf8");
  assert.match(studioApi, /action === "audio-comments"/);
  assert.match(studioApi, /action === "public-comments"/);
  assert.match(studioApi, /audioComments: audioComments\.map/);
  assert.match(internalScript, /action=audio-comments/);
  assert.match(internalScript, /data-comment-capture/);
  assert.match(customerPlayer, /action=public-comments/);
  assert.match(customerPlayer, /TIDSSTEMPLET FEEDBACK/);
});

test("mail defaults use TLS-compatible Domeneshop ports", () => {
  const config = mailConfig();
  assert.equal(config.imapHost, "imap.domeneshop.no");
  assert.equal(config.imapPort, 993);
  assert.equal(config.smtpHost, "smtp.domeneshop.no");
  assert.equal(config.smtpPort, 587);
});

test("transactional email uses Resend when its secret is configured", async () => {
  const originalFetch = global.fetch;
  process.env.RESEND_API_KEY = "test-resend-key";
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ id: "email_123" }) };
  };

  try {
    const result = await sendMail({
      from: "Loki Studio <post@lokilyd.no>",
      to: "leon@lokilyd.no",
      subject: "Test",
      text: "Hei",
      replyTo: "post@lokilyd.no",
    });
    assert.equal(result.provider, "resend");
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.options.headers.authorization, "Bearer test-resend-key");
    const body = JSON.parse(request.options.body);
    assert.deepEqual(body.to, ["leon@lokilyd.no"]);
    assert.equal(body.reply_to, "post@lokilyd.no");
  } finally {
    global.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
  }
});

test("funding monitor extracts Norwegian deadline mentions", () => {
  assert.deepEqual(dateMentions("Frist 15. september 2026 og 01.10.26"), ["15. september 2026", "01.10.26"]);
  assert.equal(plainText("<style>x</style><p>Søknadsfrist&nbsp;snart</p>"), "Søknadsfrist snart");
});

test("Formspree submissions are prioritized and use the customer's reply-to address", () => {
  const message = classifyEnvelope({
    uid: 42,
    envelope: {
      from: [{ name: "Formspree", address: "noreply@formspree.io" }],
      replyTo: [{ name: "Ny Artist", address: "artist@example.com" }],
      subject: "New submission from Loki Lydstudio",
      messageId: "<form-42@example.com>",
      date: new Date("2026-09-12T08:00:00Z"),
    },
  });
  assert.equal(message.category, "formspree");
  assert.equal(message.email, "artist@example.com");
  assert.equal(message.isLead, true);
  assert.equal(message.priority, 100);
});

test("mail unread state follows the IMAP Seen flag", () => {
  const envelope = { from: [{ name: "Artist", address: "artist@example.com" }], subject: "Ny låt" };
  assert.equal(classifyEnvelope({ uid: 1, envelope, flags: new Set() }).unread, true);
  assert.equal(classifyEnvelope({ uid: 2, envelope, flags: new Set(["\\Seen"]) }).unread, false);
});

test("Formspree body fields enrich the editable lead profile", () => {
  const enrichment = inferLeadDetails({
    subject: "Ny melding fra kontaktskjema",
    body: "Hey there. name: Cesilie Helen email: Cesilie_Helen@Hotmail.com phone: +47 912 34 567 message: Jeg synger og vil spille inn vokal og få ferdig en låt. Submitted 08:31 AM - 07 September 2026 You are receiving this because you confirmed this email address on Formspree.",
  });
  assert.equal(enrichment.name, "Cesilie Helen");
  assert.equal(enrichment.email, "cesilie_helen@hotmail.com");
  assert.equal(enrichment.phone, "+4791234567");
  assert.equal(enrichment.role, "Artist");
  assert.equal(enrichment.project, "Jeg synger og vil spille inn vokal og få ferdig en låt.");
});

test("Jottacloud and DNB notifications are filtered unless restored manually", () => {
  const raw = {
    uid: 7,
    envelope: {
      from: [{ name: "Jottacloud", address: "notifications@jottacloud.com" }],
      subject: "Storage notification",
      messageId: "<jotta-7@example.com>",
    },
  };
  assert.equal(classifyEnvelope(raw).category, "irrelevant");
  assert.equal(classifyEnvelope(raw).isLead, false);
  assert.equal(classifyEnvelope(raw, "inbox").category, "customer");
});

test("generic suppliers, administrative subjects and mailing lists are filtered", () => {
  const supplier = classifyEnvelope({
    uid: 8,
    envelope: { from: [{ name: "Tripletex", address: "varsling@tripletex.no" }], subject: "Månedsrapport" },
  });
  const invoice = classifyEnvelope({
    uid: 9,
    envelope: { from: [{ name: "Leverandør", address: "billing@unknown-service.example" }], subject: "Ny faktura" },
  });
  const newsletter = classifyEnvelope({
    uid: 10,
    envelope: { from: [{ name: "Bransjenytt", address: "hei@bransjenytt.example" }], subject: "Denne ukens nyheter" },
    headers: Buffer.from("List-Unsubscribe: <https://bransjenytt.example/unsubscribe>\r\n"),
  });
  assert.equal(supplier.category, "irrelevant");
  assert.equal(invoice.category, "irrelevant");
  assert.equal(newsletter.category, "irrelevant");
  assert.match(newsletter.filterReason, /Nyhetsbrev/);
});

test("human studio enquiries remain in the customer pipeline", () => {
  const message = classifyEnvelope({
    uid: 11,
    envelope: {
      from: [{ name: "Mina Artist", address: "mina@example.com" }],
      subject: "Booking av innspilling og miks",
    },
  });
  assert.equal(message.category, "customer");
  assert.equal(message.isLead, true);
});

test("lead details are inferred conservatively from an email", () => {
  const inferred = inferLeadDetails({
    subject: "Forespørsel om produksjon",
    body: "Artistnavn: Neon Fjord Telefon: +47 412 34 567 Rolle: artist og produsent Nettside: https://neonfjord.no Instagram: https://instagram.com/neonfjord Sted: Bergen",
  });
  assert.equal(inferred.phone, "+4741234567");
  assert.equal(inferred.role, "Artist og produsent");
  assert.equal(inferred.artistName, "Neon Fjord");
  assert.equal(inferred.location, "Bergen");
  assert.equal(inferred.website, "https://neonfjord.no");
  assert.equal(inferred.social, "https://instagram.com/neonfjord");
  assert.equal(normalizePhone("ordre 123"), "");
});

test("lead pipeline follows inbox priority and keeps finished work below open leads", () => {
  const sorted = sortLeads([
    { id: "manual", source: "Manuelt", stage: "Nytt lead", receivedAt: "2026-09-12T12:00:00Z" },
    { id: "email", source: "E-post", stage: "Kontaktet", receivedAt: "2026-09-12T11:00:00Z" },
    { id: "older-email", source: "E-post", stage: "Nytt lead", receivedAt: "2026-09-12T09:00:00Z" },
    { id: "finished-form", source: "Formspree", category: "formspree", stage: "Ferdig", receivedAt: "2026-09-12T13:00:00Z" },
    { id: "booked", source: "E-post", stage: "Booket", receivedAt: "2026-09-12T08:00:00Z" },
    { id: "form", source: "Formspree", category: "formspree", stage: "Nytt lead", receivedAt: "2026-09-12T10:00:00Z" },
  ]);
  assert.deepEqual(sorted.map((lead) => lead.id), ["form", "email", "older-email", "booked", "manual", "finished-form"]);
  assert.equal(leadPriority(sorted[0]), 100);
  assert.equal(leadPriority(sorted[1]), 50);
  assert.equal(isOpenLead({ stage: "Booket" }), true);
  assert.equal(isOpenLead({ stage: "Ferdig" }), false);
});

test("mailbox preferences also suppress matching CRM leads", () => {
  const preferences = [
    { key: "abc123", category: "irrelevant", sender: "" },
    { key: "sender-rule", category: "irrelevant", sender: "varsling@example.com" },
    { key: "restored", category: "inbox", sender: "artist@example.com" },
  ];
  assert.equal(suppressedByMailPreference({ messageKey: "abc123", email: "artist@example.com" }, preferences), true);
  assert.equal(suppressedByMailPreference({ messageKey: "other", email: "VARSLING@example.com" }, preferences), true);
  assert.equal(suppressedByMailPreference({ messageKey: "restored", email: "artist@example.com" }, preferences), false);
  assert.equal(mailPreferenceForLead({ messageKey: "restored", email: "artist@example.com" }, preferences), "inbox");
});

test("manual customers persist in the customer register without an email address", () => {
  const customer = sanitizeLead({
    name: "  Ny studiokunde  ",
    phone: "+47 900 00 000",
    project: "Innspilling av demo",
    source: "Manuelt",
  });
  assert.equal(customer.name, "Ny studiokunde");
  assert.equal(customer.email, "");
  assert.equal(customer.phone, "+47 900 00 000");
  const views = splitLeadViews([customer], []);
  assert.deepEqual(views.leads.map((lead) => lead.id), [customer.id]);
  assert.equal(views.irrelevantLeads.length, 0);
});

test("shared tasks and meeting notes are normalized", () => {
  const task = sanitizeTask({ title: "  Følg opp artist  ", assignee: "Leon", priority: "Høy", dueDate: "2026-09-20" }, {}, "leon@lokilyd.no");
  assert.equal(task.title, "Følg opp artist");
  assert.equal(task.assignee, "Leon");
  assert.equal(task.priority, "Høy");
  const note = sanitizeNote({ type: "møte", title: "Ukemøte", content: "Neste steg", attendees: "Leon, Charles" }, {}, "charles@lokilyd.no");
  assert.equal(note.type, "møte");
  assert.equal(note.attendees, "Leon, Charles");
});

test("shared task list can filter by exact assignee", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "index.html"), "utf8");
  const workspace = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "workspace.js"), "utf8");
  assert.match(html, /id="task-assignee-filter"/);
  assert.match(html, /Filtrer gjøremålslisten etter ansvarlig/);
  assert.match(workspace, /\["Alle", "Leon", "Charles", "Begge"\]/);
  assert.match(workspace, /task\.assignee === taskAssigneeFilter/);
  assert.match(workspace, /data-task-filter/);
});

test("CRM push subscriptions are private, owner-scoped and safely normalized", () => {
  const subscription = sanitizeSubscription({
    endpoint: "https://push.example.test/send/device-1",
    keys: { p256dh: "A_secure-public-key_123", auth: "auth_secret_123" },
    device: "  iPhone  ",
  }, "leon@lokilyd.no");
  assert.equal(subscription.userEmail, "leon@lokilyd.no");
  assert.equal(subscription.device, "iPhone");
  assert.equal(subscription.id.length, 32);
  assert.match(pushPublicKey(), /^[A-Za-z0-9_-]{80,100}$/);
  assert.equal(sanitizeSubscription({ endpoint: "http://push.example.test", keys: subscription.keys }, "leon@lokilyd.no"), null);
  assert.equal(sanitizeSubscription({ endpoint: subscription.endpoint, keys: subscription.keys }, "daniel@lokilyd.no"), null);
  assert.deepEqual(publicSubscriptionStatus([subscription], "leon@lokilyd.no"), {
    subscribed: true,
    deviceCount: 1,
    devices: [{ id: subscription.id, device: "iPhone", updatedAt: subscription.updatedAt }],
  });
});

test("task push messages identify who created or completed the task", () => {
  const task = { id: "task-1", title: "Ring artisten", assignee: "Charles", completed: false };
  const created = taskNotification(null, task, "leon@lokilyd.no");
  assert.equal(actorName("leon@lokilyd.no"), "Leon");
  assert.match(created.body, /Leon la til/);
  assert.match(created.body, /Ansvarlig: Charles/);
  const completed = taskNotification(task, { ...task, completed: true }, "charles@lokilyd.no");
  assert.match(completed.title, /fullført/i);
  assert.match(completed.body, /Charles fullførte/);
  assert.equal(taskNotification(task, { ...task, priority: "Høy" }, "leon@lokilyd.no"), null);
  assert.equal(notificationPayload({ url: "https://evil.example/" }).url, "/crmplatform/");
});

test("native iPhone push devices require an approved CRM owner and a valid APNs token", () => {
  const input = { token: "a".repeat(64), environment: "sandbox", device: "Leon iPhone" };
  const device = sanitizeNativeDevice(input, "leon@lokilyd.no");
  assert.equal(device.userEmail, "leon@lokilyd.no");
  assert.equal(device.environment, "sandbox");
  assert.ok(sanitizeNativeDevice({ ...input, token: "b".repeat(80) }, "leon@lokilyd.no"));
  assert.equal(sanitizeNativeDevice(input, "daniel@lokilyd.no"), null);
  assert.equal(sanitizeNativeDevice({ ...input, token: "short" }, "leon@lokilyd.no"), null);
  assert.equal(sanitizeNativeDevice({ ...input, environment: "other" }, "leon@lokilyd.no"), null);
});

test("APNs bearer tokens use an ES256 signature", () => {
  const crypto = require("node:crypto");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  process.env.APNS_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  process.env.APNS_KEY_ID = "TESTKEY123";
  process.env.APNS_TEAM_ID = "TESTTEAM12";
  const [header, claims, signature] = apnsBearerToken().split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "ES256");
  assert.equal(JSON.parse(Buffer.from(claims, "base64url")).iss, "TESTTEAM12");
  assert.equal(crypto.verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")), true);
  delete process.env.APNS_PRIVATE_KEY;
  delete process.env.APNS_KEY_ID;
  delete process.env.APNS_TEAM_ID;
});

test("CRM is installable and exposes user-activated iPhone and Android push", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "index.html"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "push.js"), "utf8");
  const worker = fs.readFileSync(path.join(__dirname, "..", "crm-sw.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "crm-manifest.webmanifest"), "utf8"));
  const studio = fs.readFileSync(path.join(__dirname, "..", "api", "studio.js"), "utf8");
  assert.match(html, /id="push-toggle"/);
  assert.match(html, /crm-manifest\.webmanifest/);
  assert.match(client, /Notification\.requestPermission/);
  assert.match(client, /registration\.pushManager\.subscribe/);
  assert.match(client, /Legg til på Hjem-skjermen/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /notificationclick/);
  assert.match(studio, /action === "push"/);
  assert.match(studio, /taskNotification/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "/crmplatform/");
});

test("internal savings goals calculate bounded progress", () => {
  const goal = sanitizeGoal({
    title: "  Tur til Dublin  ",
    type: "Sparemål",
    currentAmount: "7500",
    targetAmount: "25000",
    targetDate: "2027-04-01",
  }, {}, "leon@lokilyd.no");
  assert.equal(goal.title, "Tur til Dublin");
  assert.equal(goal.progress, 30);
  assert.equal(goal.completed, false);
  const completed = sanitizeGoal({ currentAmount: 30000 }, goal, "charles@lokilyd.no");
  assert.equal(completed.progress, 100);
  assert.equal(completed.completed, true);
  assert.equal(sanitizeGoal({ title: "" }), null);
});

test("rental register seeds the 11 active workbook agreements and exact room totals", () => {
  const seeded = seedRentalItems("leon@lokilyd.no");
  const data = splitRentalItems(seeded);
  assert.equal(data.tenants.length, 11);
  assert.equal(data.rooms.length, 3);
  assert.equal(data.payments.length, 0);
  assert.equal(data.tenants.filter((tenant) => tenant.active).reduce((sum, tenant) => sum + tenant.monthlyRent, 0), 31_967);
  assert.equal(data.tenants.filter((tenant) => tenant.room === "Studio B").reduce((sum, tenant) => sum + tenant.monthlyRent, 0), 6_000);
  assert.equal(data.tenants.filter((tenant) => tenant.room === "Studio C").reduce((sum, tenant) => sum + tenant.monthlyRent, 0), 14_000);
  assert.equal(data.tenants.filter((tenant) => tenant.room === "Studio D").reduce((sum, tenant) => sum + tenant.monthlyRent, 0), 11_967);
  assert.equal(data.tenants.filter((tenant) => tenant.name === "Oskar / Oliver").length, 1);
  assert.equal(data.rooms.every((room) => room.issuedKeys === 0), true);
  assert.equal(JSON.stringify(seeded).includes("Daniel"), false);
  assert.equal(JSON.stringify(seeded).includes("Frydenbølien 19"), false);
});

test("rental contacts, contracts, payments and room keys are sanitized", () => {
  const tenant = sanitizeTenant({
    name: "  Ny leietaker  ",
    room: "Studio C",
    monthlyRent: "4200",
    email: "KONTAKT@example.com",
    phone: "+47 900 00 000",
    contractPath: "AS/Kontrakter/Utleie/Studio C/Navn/signert.pdf",
  }, {}, "charles@lokilyd.no");
  assert.equal(tenant.name, "Ny leietaker");
  assert.equal(tenant.email, "kontakt@example.com");
  assert.equal(tenant.monthlyRent, 4200);
  assert.equal(tenant.contractStatus, "Kontrakt funnet");
  assert.equal(splitRentalItems([{ ...tenant, kind: "tenant" }]).tenants[0].contractUrl.includes("jottacloud.com/web/sync/list/name/"), true);
  assert.equal(cleanContractPath("AS/Kontrakter/Utleie/Arkiv_utflyttet/gammel.pdf"), "");
  assert.equal(cleanContractPath("../AS/Kontrakter/Utleie/avtale.pdf"), "");
  assert.equal(cleanJottacloudUrl("https://evil.example/contract.pdf"), "");

  const payment = sanitizePayment({ tenantId: tenant.id, year: 2026, month: 9, paid: true, paidAt: "2026-09-12" }, {}, "leon@lokilyd.no");
  assert.equal(payment.id, paymentId(tenant.id, 2026, 9));
  assert.equal(payment.paidAt, "2026-09-12");
  assert.equal(sanitizePayment({ tenantId: tenant.id, year: 2019, month: 13 }), null);

  const keys = sanitizeRoomKeys({ room: "Studio D", issuedKeys: 150 }, {}, "leon@lokilyd.no");
  assert.equal(keys.issuedKeys, 100);
  assert.equal(sanitizeRoomKeys({ room: "Studio X", issuedKeys: 1 }), null);
});

test("studio bookings validate times and reject overlaps", () => {
  const first = sanitizeBooking({
    title: "Artist – innspilling",
    date: "2026-09-20",
    startTime: "10:00",
    endTime: "14:00",
    service: "Innspilling",
    assignee: "Leon",
  }, {}, "leon@lokilyd.no");
  const overlap = sanitizeBooking({ title: "Ny økt", date: "2026-09-20", startTime: "13:30", endTime: "16:00" });
  const after = sanitizeBooking({ title: "Sen økt", date: "2026-09-20", startTime: "14:00", endTime: "16:00" });
  assert.equal(first.service, "Innspilling");
  assert.equal(first.assignee, "Leon");
  assert.equal(bookingConflict([first], overlap).id, first.id);
  assert.equal(bookingConflict([first], after), null);
  assert.equal(sanitizeBooking({ title: "Ugyldig", date: "2026-09-20", startTime: "15:00", endTime: "12:00" }), null);
});

test("quote totals are recalculated on the server", () => {
  const quote = sanitizeQuote({
    customerName: "Ny Artist",
    customerEmail: "ARTIST@example.com",
    projectName: "Singel",
    items: [
      { description: "Innspilling", quantity: 4, unit: "time", unitPrice: 550, lineTotal: 1 },
      { description: "Mastering", quantity: 1, unit: "låt", unitPrice: 750, lineTotal: 1 },
    ],
  }, {}, "charles@lokilyd.no");
  assert.equal(quote.customerEmail, "artist@example.com");
  assert.equal(quote.items[0].lineTotal, 2200);
  assert.equal(quote.total, 2950);
  assert.match(quote.number, /^L-\d{8}-[A-F0-9]{4}$/);
});

test("customer activities require a lead and details", () => {
  const activity = sanitizeActivity({ leadId: "lead-1", type: "Telefon", details: "Avtalte ny samtale fredag." }, {}, "leon@lokilyd.no");
  assert.equal(activity.type, "Telefon");
  assert.equal(activity.createdBy, "leon@lokilyd.no");
  assert.equal(sanitizeActivity({ leadId: "lead-1", details: "" }), null);
  assert.equal(sanitizeActivity({ details: "Mangler kunde" }), null);
});

test("Fiken summary remains read-only and totals unpaid invoices in øre", () => {
  const summary = summarizeFiken(
    { name: "Loki Lydstudio", slug: "loki", organizationNumber: "123456789" },
    [
      { invoiceId: 1, invoiceNumber: 1001, customer: { name: "Artist" }, gross: 125000, dueDate: "2020-01-01", settled: false },
      { invoiceId: 2, invoiceNumber: 1002, customer: { name: "Band" }, gross: 50000, dueDate: "2020-01-02", settled: true },
    ],
    [{ contactId: 1 }],
  );
  assert.equal(summary.readOnly, true);
  assert.equal(summary.metrics.unpaidCount, 1);
  assert.equal(summary.metrics.overdueCount, 1);
  assert.equal(summary.metrics.outstandingOre, 125000);
  assert.equal(summary.metrics.contactCount, 1);
});

test("Fiken OAuth grants are encrypted before private storage", () => {
  const grant = { access_token: "access-secret", refresh_token: "refresh-secret", expiresAt: Date.now() + 60_000 };
  const sealed = sealGrant(grant);
  assert.equal(sealed.includes("access-secret"), false);
  assert.deepEqual(openGrant(sealed), grant);
});

test("Google Calendar ICS dates preserve Oslo time and all-day dates", () => {
  const timed = parseIcsDate({ params: { TZID: "Europe/Oslo" }, value: "20260920T100000" });
  const allDay = parseIcsDate({ params: { VALUE: "DATE" }, value: "20260921" });
  assert.equal(timed.date.toISOString(), "2026-09-20T08:00:00.000Z");
  assert.equal(timed.localDate, "2026-09-20");
  assert.equal(timed.localTime, "10:00");
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.localDate, "2026-09-21");
});

test("Google Calendar parser expands recurrence, exclusions and moved occurrences", () => {
  const source = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "X-WR-CALNAME:Loki testkalender",
    "BEGIN:VEVENT",
    "UID:single-event",
    "DTSTART;TZID=Europe/Oslo:20260920T100000",
    "DTEND;TZID=Europe/Oslo:20260920T120000",
    "SUMMARY:Studioøkt",
    "DESCRIPTION:Første linje\\nAndre linje",
    "LOCATION:Studio A",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:all-day-event",
    "DTSTART;VALUE=DATE:20260921",
    "DTEND;VALUE=DATE:20260922",
    "SUMMARY:Hele dagen",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:weekly-event",
    "DTSTART;TZID=Europe/Oslo:20260914T090000",
    "DTEND;TZID=Europe/Oslo:20260914T100000",
    "RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO",
    "EXDATE;TZID=Europe/Oslo:20260921T090000",
    "SUMMARY:Fast møte",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:weekly-event",
    "RECURRENCE-ID;TZID=Europe/Oslo:20260928T090000",
    "DTSTART;TZID=Europe/Oslo:20260929T130000",
    "DTEND;TZID=Europe/Oslo:20260929T140000",
    "SUMMARY:Flyttet møte",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const parsed = parseIcsCalendar(source, {
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-10-10T00:00:00.000Z",
    now: new Date("2026-09-15T10:00:00.000Z"),
  });
  assert.equal(parsed.calendarName, "Loki testkalender");
  assert.deepEqual(parsed.events.map((event) => event.date), ["2026-09-14", "2026-09-20", "2026-09-21", "2026-09-29", "2026-10-05"]);
  assert.equal(parsed.events.some((event) => event.date === "2026-09-21" && event.title === "Fast møte"), false);
  assert.equal(parsed.events.find((event) => event.title === "Flyttet møte").startTime, "13:00");
  assert.equal(parsed.events.find((event) => event.title === "Hele dagen").allDay, true);
  assert.equal(parsed.events.find((event) => event.title === "Studioøkt").description, "Første linje\nAndre linje");
  assert.equal(parsed.events.every((event) => /^gcal-[a-f0-9]{24}$/.test(event.id)), true);
});

test("Google Calendar feed accepts only private Google ICS URLs", () => {
  const valid = calendarFeedUrl("https://calendar.google.com/calendar/ical/test%40group.calendar.google.com/private-token/basic.ics");
  assert.equal(valid.hostname, "calendar.google.com");
  assert.equal(calendarFeedUrl("http://calendar.google.com/calendar/ical/test/private-token/basic.ics"), null);
  assert.equal(calendarFeedUrl("https://calendar.google.com.evil.example/calendar/ical/test/private-token/basic.ics"), null);
  assert.equal(calendarFeedUrl("https://calendar.google.com/calendar/ical/test/public/basic.ics"), null);
});

test("CRM calendar UI uses an authenticated server feed without exposing its private URL", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "index.html"), "utf8");
  const operations = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "operations.js"), "utf8");
  const studioApi = fs.readFileSync(path.join(__dirname, "..", "api", "studio.js"), "utf8");
  assert.match(html, /id="google-calendar-grid"/);
  assert.match(html, /id="calendar-previous"/);
  assert.match(html, /KOMMENDE AVTALER/);
  assert.match(operations, /action=google-calendar/);
  assert.match(operations, /calendarCursor/);
  assert.match(studioApi, /requireUser\(req, res\)/);
  assert.match(studioApi, /loadGoogleCalendar/);
  assert.doesNotMatch(html, /private-[a-z0-9_-]+\/basic\.ics/i);
  assert.doesNotMatch(operations, /private-[a-z0-9_-]+\/basic\.ics/i);
});

test("presence is limited to the two active Loki owners and expires quickly", () => {
  const now = new Date("2026-09-15T10:00:00.000Z");
  const leonLogin = presenceLogin("leon@lokilyd.no", {}, new Date("2026-09-15T09:30:00.000Z"));
  const charlesLogin = presenceLogin("charles@lokilyd.no", {}, new Date("2026-09-14T08:15:00.000Z"));
  const owners = presenceOwners();
  assert.deepEqual(owners.map((owner) => owner.name).sort(), ["Charles", "Leon"]);
  assert.equal(presenceCollection("leon@lokilyd.no"), "presence-leon");
  assert.equal(presenceCollection("daniel@lokilyd.no"), null);
  assert.equal(presenceHeartbeat("daniel@lokilyd.no", {}, now), null);

  const records = [
    presenceHeartbeat("leon@lokilyd.no", leonLogin, now),
    presenceHeartbeat("charles@lokilyd.no", charlesLogin, new Date(now.getTime() - ONLINE_WINDOW_MS - 1)),
    { email: "outside@example.com", name: "Ukjent", lastSeen: now.toISOString() },
  ];
  const visible = presenceStatus(records, "leon@lokilyd.no", now);
  assert.deepEqual(visible.map((owner) => owner.name), ["Leon", "Charles"]);
  assert.equal(visible[0].online, true);
  assert.equal(visible[0].isCurrent, true);
  assert.equal(visible[0].lastLoginAt, leonLogin.lastLoginAt);
  assert.equal(visible[1].online, false);
  assert.equal(visible[1].lastLoginAt, charlesLogin.lastLoginAt);
  const loggedOut = presenceOffline("leon@lokilyd.no", records[0], now);
  assert.equal(loggedOut.online, false);
  assert.equal(loggedOut.lastLoginAt, leonLogin.lastLoginAt);
});

test("CRM sidebar exposes authenticated live presence without hard-coded status", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "index.html"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "presence.js"), "utf8");
  const endpoint = fs.readFileSync(path.join(__dirname, "..", "api", "studio.js"), "utf8");
  assert.match(html, /id="presence-list"/);
  assert.match(html, /Pålogget nå/);
  assert.match(client, /\/api\/studio\?action=presence/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /Sist pålogget/);
  assert.match(client, /name: "Leon"/);
  assert.match(client, /name: "Charles"/);
  assert.match(endpoint, /requireUser\(req, res\)/);
  assert.match(endpoint, /presenceStatus/);
  assert.doesNotMatch(client, /charles@lokilyd\.no|leon@lokilyd\.no/);
});

test("successful magic-link login records the actual login time", () => {
  const callback = fs.readFileSync(path.join(__dirname, "..", "api", "crm", "auth-callback.js"), "utf8");
  assert.match(callback, /presenceLogin/);
  assert.match(callback, /writeCollection/);
  assert.match(callback, /Could not record CRM login/);
});

test("tenant booking accounts are limited to Studio C or Studio D", () => {
  const account = sanitizeTenantAccount({ name: "  Ola   Musiker ", email: "OLA@EXAMPLE.COM", studio: "Studio C" });
  assert.equal(account.name, "Ola Musiker");
  assert.equal(account.email, "ola@example.com");
  assert.equal(account.studio, "Studio C");
  assert.equal(account.status, "pending");
  assert.equal(sanitizeTenantAccount({ name: "Ugyldig", email: "u@example.com", studio: "Studio B" }), null);
  assert.deepEqual(Object.keys(publicTenantAccount(account)).sort(), ["email", "id", "name", "status", "studio"]);
});

test("approved tenant accounts use a separate signed login challenge and session cookie", () => {
  const account = sanitizeTenantAccount({ name: "Dina", email: "dina@example.com", studio: "Studio D", status: "approved" });
  const challenge = createTenantLoginChallenge(account, 60);
  assert.match(challenge.code, /^\d{6}$/);
  const request = { headers: { cookie: `loki_booking_challenge=${encodeURIComponent(challenge.token)}` } };
  assert.equal(verifyTenantLoginCode(request, account.email, challenge.code).accountId, account.id);
  assert.equal(verifyTenantLoginCode(request, "annen@example.com", challenge.code), null);
  assert.match(tenantSessionCookie(account), /^loki_booking_session=/);
  assert.match(tenantSessionCookie(account), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(SESSION_MAX_AGE_SECONDS, 60 * 60 * 24 * 400);
  assert.match(tenantSessionCookie(account), /Max-Age=34560000/);
  assert.equal(createTenantLoginChallenge({ ...account, status: "pending" }), null);
});

test("tenant sessions remain valid on the same device but account changes revoke them", async () => {
  const account = sanitizeTenantAccount({ name: "Kari", email: "kari@example.com", studio: "Studio C", status: "approved" });
  const token = createTenantSessionToken(account);
  const request = { headers: { cookie: `loki_booking_session=${encodeURIComponent(token)}` } };
  assert.equal(tenantSessionFromRequest(request).accountId, account.id);
  const { tenantForRequest } = require("../lib/tenant-booking-handler")._test;
  assert.equal((await tenantForRequest(request, [account])).id, account.id);
  assert.equal(await tenantForRequest(request, [{ ...account, status: "suspended" }]), null);
  assert.equal(await tenantForRequest(request, [{ ...account, sessionVersion: 1 }]), null);
  assert.equal(await tenantForRequest(request, [{ ...account, studio: "Studio D" }]), null);
});

test("tenant bookings collide only inside their own studio", () => {
  const accountC = sanitizeTenantAccount({ name: "C-bruker", email: "c@example.com", studio: "Studio C", status: "approved" });
  const accountD = sanitizeTenantAccount({ name: "D-bruker", email: "d@example.com", studio: "Studio D", status: "approved" });
  const bookingC = sanitizeTenantBooking({ title: "Øving", date: "2026-10-10", startTime: "10:00", endTime: "12:00" }, accountC);
  const overlapC = sanitizeTenantBooking({ title: "Produksjon", date: "2026-10-10", startTime: "11:30", endTime: "13:00" }, accountC);
  const sameTimeD = sanitizeTenantBooking({ title: "Miks", date: "2026-10-10", startTime: "11:30", endTime: "13:00" }, accountD);
  assert.equal(tenantBookingConflict([bookingC], overlapC).id, bookingC.id);
  assert.equal(tenantBookingConflict([bookingC], sameTimeD), null);
  assert.equal(bookingC.studio, "Studio C");
  assert.equal(sanitizeTenantBooking({ title: "Baklengs", date: "2026-10-10", startTime: "14:00", endTime: "13:00" }, accountC), null);
});

test("external booking portal is isolated from CRM and exposes approval administration", () => {
  const portal = fs.readFileSync(path.join(__dirname, "..", "booking", "index.html"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "booking", "booking.js"), "utf8");
  const api = fs.readFileSync(path.join(__dirname, "..", "lib", "tenant-booking-handler.js"), "utf8");
  const studioApi = fs.readFileSync(path.join(__dirname, "..", "api", "studio.js"), "utf8");
  const crm = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "index.html"), "utf8");
  assert.match(portal, /Søk om tilgang/);
  assert.match(portal, /Studio C/);
  assert.match(portal, /Studio D/);
  assert.match(portal, /kan ikke slettes eller endres/);
  assert.doesNotMatch(client, /crm-login|crmplatform/);
  assert.match(client, /action=tenant-/);
  assert.match(api, /requireUser\(req, res\)/);
  assert.match(api, /item\.studio === account\.studio/);
  assert.match(api, /req\.method !== "POST"/);
  assert.match(api, /action === "admin-booking"/);
  assert.match(studioApi, /tenantBookingHandler/);
  assert.match(api, /to: address/);
  assert.match(crm, /id="tenant-user-list"/);
  assert.match(crm, /Åpne bookingportalen/);
});

test("project customer email fields suggest saved CRM contacts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "index.html"), "utf8");
  const studio = fs.readFileSync(path.join(__dirname, "..", "crmplatform", "studio.js"), "utf8");
  assert.match(html, /name="clientEmail"[^>]+aria-autocomplete="list"/);
  assert.match(html, /id="project-contact-suggestions-new" role="listbox" hidden/);
  assert.match(html, /LokiStudio\.init\(\{user:data\.user,getContacts:\(\)=>leads\}\)/);
  assert.match(studio, /function contactEmailChoices\(query = ""\)/);
  assert.match(studio, /request\("\/api\/crm\/leads"\)/);
  assert.match(studio, /email: "leon@lokilyd\.no"/);
  assert.match(studio, /email: "charles@lokilyd\.no"/);
  assert.match(studio, /key\.startsWith\(needle\)/);
  assert.match(studio, /nameInput\.value = contact\.artistName \|\| contact\.name \|\| contact\.company/);
  assert.match(studio, /data-contact-suggestions="project-contact-suggestions-editor"/);
  assert.match(studio, /data-contact-email=/);
});
