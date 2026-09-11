const assert = require("node:assert/strict");
const test = require("node:test");

process.env.CRM_AUTH_SECRET = "test-only-secret-that-is-longer-than-thirty-two-characters";
process.env.MAIL_ADDRESS = "post@lokilyd.no";
process.env.MAIL_USERNAME = "lokilyd1";
process.env.MAIL_PASSWORD = "test-only-password";

const auth = require("../lib/crm-auth");
const { dateMentions, plainText } = require("../lib/crm-funding");
const { mailConfig } = require("../lib/crm-mail");

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

test("mail defaults use TLS-compatible Domeneshop ports", () => {
  const config = mailConfig();
  assert.equal(config.imapHost, "imap.domeneshop.no");
  assert.equal(config.imapPort, 993);
  assert.equal(config.smtpHost, "smtp.domeneshop.no");
  assert.equal(config.smtpPort, 587);
});

test("funding monitor extracts Norwegian deadline mentions", () => {
  assert.deepEqual(dateMentions("Frist 15. september 2026 og 01.10.26"), ["15. september 2026", "01.10.26"]);
  assert.equal(plainText("<style>x</style><p>Søknadsfrist&nbsp;snart</p>"), "Søknadsfrist snart");
});
