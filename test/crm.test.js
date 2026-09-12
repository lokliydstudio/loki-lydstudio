const assert = require("node:assert/strict");
const test = require("node:test");

process.env.CRM_AUTH_SECRET = "test-only-secret-that-is-longer-than-thirty-two-characters";
process.env.MAIL_ADDRESS = "post@lokilyd.no";
process.env.MAIL_USERNAME = "lokilyd1";
process.env.MAIL_PASSWORD = "test-only-password";

const auth = require("../lib/crm-auth");
const { audioPathname, sanitizeTrack } = require("../lib/crm-audio");
const { dateMentions, plainText } = require("../lib/crm-funding");
const { classifyEnvelope } = require("../lib/crm-mail-sort");
const { mailConfig, sendMail } = require("../lib/crm-mail");
const { summarizeFiken } = require("../lib/crm-fiken");
const { sanitizePatch, sanitizeProject } = require("../lib/crm-projects");
const { sanitizeNote, sanitizeTask } = require("../lib/crm-workspace");

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

test("shared tasks and meeting notes are normalized", () => {
  const task = sanitizeTask({ title: "  Følg opp artist  ", assignee: "Leon", priority: "Høy", dueDate: "2026-09-20" }, {}, "leon@lokilyd.no");
  assert.equal(task.title, "Følg opp artist");
  assert.equal(task.assignee, "Leon");
  assert.equal(task.priority, "Høy");
  const note = sanitizeNote({ type: "møte", title: "Ukemøte", content: "Neste steg", attendees: "Leon, Charles" }, {}, "charles@lokilyd.no");
  assert.equal(note.type, "møte");
  assert.equal(note.attendees, "Leon, Charles");
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
