const assert = require("node:assert/strict");
const test = require("node:test");

process.env.CRM_AUTH_SECRET = "test-only-secret-that-is-longer-than-thirty-two-characters";
process.env.MAIL_ADDRESS = "post@lokilyd.no";
process.env.MAIL_USERNAME = "lokilyd1";
process.env.MAIL_PASSWORD = "test-only-password";

const auth = require("../lib/crm-auth");
const { audioPathname, sanitizeTrack } = require("../lib/crm-audio");
const { documentPathname, mergeDocumentIndex, publicDocument, sanitizeIndexedDocument, sanitizeUploadedDocument } = require("../lib/crm-documents");
const { dateMentions, plainText } = require("../lib/crm-funding");
const { inferLeadDetails, normalizePhone } = require("../lib/crm-lead-enrichment");
const { classifyEnvelope } = require("../lib/crm-mail-sort");
const { isOpenLead, leadPriority, mailPreferenceForLead, sortLeads, suppressedByMailPreference } = require("../lib/crm-leads");
const { mailConfig, sendMail } = require("../lib/crm-mail");
const { openGrant, sealGrant, summarizeFiken } = require("../lib/crm-fiken");
const { bookingConflict, sanitizeActivity, sanitizeBooking, sanitizeQuote } = require("../lib/crm-operations");
const { createProjectExport, planProjectDeletion } = require("../lib/crm-project-export");
const { sanitizePatch, sanitizeProject } = require("../lib/crm-projects");
const { sanitizeNote, sanitizeTask } = require("../lib/crm-workspace");
const { sanitizeLead, splitLeadViews } = require("../api/crm/leads")._test;

test("only active owners can receive CRM tokens", () => {
  const token = auth.createToken("leon@lokilyd.no", "login", 60);
  assert.equal(auth.verifyToken(token, "login").email, "leon@lokilyd.no");
  assert.equal(auth.createToken("charles@lokilyd.no", "login", 60) !== null, true);
  assert.equal(auth.createToken("daniel@lokilyd.no", "login", 60), null);
});

test("tokens cannot be reused for another purpose", () => {
  const token = auth.createToken("leon@lokilyd.no", "login", 60);
  assert.equal(auth.verifyToken(token, "session"), null);
});

test("customer listening tokens are scoped and expire independently of owner access", () => {
  const token = auth.createScopedToken("track-123", "audio-share", 60);
  assert.equal(auth.verifyScopedToken(token, "audio-share").subject, "track-123");
  assert.equal(auth.verifyScopedToken(token, "session"), null);
  assert.equal(auth.verifyToken(token, "audio-share"), null);
});

test("project patches always contain exactly 32 numbered channels", () => {
  const patch = sanitizePatch([
    { channel: 1, source: "Vokal", microphone: "U87", phantom: true },
    { channel: 32, source: "Talkback", destination: "ADAT 32" },
    { channel: 33, source: "Skal avvises" },
  ]);
  assert.equal(patch.length, 32);
  assert.deepEqual(patch.map((row) => row.channel), Array.from({ length: 32 }, (_, index) => index + 1));
  assert.equal(patch[0].source, "Vokal");
  assert.equal(patch[0].phantom, true);
  assert.equal(patch[31].destination, "ADAT 32");
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
  assert.equal(project.patch[1].source, "Kick in");
});

test("document uploads use private safe paths and reject active web content", () => {
  const id = "document-123e4567-e89b-12d3-a456-426614174000";
  assert.equal(documentPathname(id, "Avtale 2026.pdf"), `loki-crm/documents/${id}/Avtale-2026.pdf`);
  assert.equal(documentPathname(id, "nettside.html"), "");
  assert.equal(documentPathname("short", "avtale.pdf"), "");
  assert.equal(sanitizeIndexedDocument({ path: "Passord /hemmelig.pdf" }), null);
  assert.equal(sanitizeIndexedDocument({ path: "Mikser (Cloud)/opptak.pdf" }), null);
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
    { id: "project-1", name: "Første", patch: [] },
    { id: "project-2", name: "Andre", patch: [] },
  ];
  const tracks = [
    { id: "track-1", projectId: "project-1", filename: "miks.wav", title: "Miks", version: "V1", size: 120, contentType: "audio/wav", pathname: "loki-crm/private/track-1", uploadedBy: "leon@lokilyd.no" },
    { id: "track-2", projectId: "project-2", filename: "demo.mp3", title: "Demo", version: "V2", size: 80, contentType: "audio/mpeg", pathname: "loki-crm/private/track-2", uploadedBy: "charles@lokilyd.no" },
  ];
  const manifest = createProjectExport(projects, tracks, "project-1");
  assert.equal(manifest.scope, "project");
  assert.deepEqual(manifest.projects.map((project) => project.id), ["project-1"]);
  assert.deepEqual(manifest.files.map((file) => file.trackId), ["track-1"]);
  assert.equal(manifest.files[0].downloadUrl, "/api/studio?action=internal-stream&id=track-1");
  assert.equal("pathname" in manifest.projects[0].tracks[0], false);
  assert.equal("uploadedBy" in manifest.projects[0].tracks[0], false);
  assert.equal(JSON.stringify(manifest).includes("loki-crm/private"), false);
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
