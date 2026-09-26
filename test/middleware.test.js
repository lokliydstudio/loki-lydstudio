const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.CRM_AUTH_SECRET = "test-only-secret-that-is-longer-than-thirty-two-characters";
process.env.CRM_ALLOWED_EMAILS = "leon@lokilyd.no,charles@lokilyd.no";

const auth = require("../lib/crm-auth");

async function loadMiddleware() {
  const source = fs.readFileSync(path.join(__dirname, "..", "middleware.js"), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("CRM HTML redirects before it is served without a valid session", async () => {
  const { default: middleware } = await loadMiddleware();
  const response = await middleware(new Request("https://www.lokilyd.no/crmplatform/"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://www.lokilyd.no/crm-login.html");
});

test("CRM HTML is available to a signed owner session", async () => {
  const { default: middleware } = await loadMiddleware();
  const session = auth.createToken("leon@lokilyd.no", "session", 60);
  const request = new Request("https://www.lokilyd.no/crmplatform/", {
    headers: { cookie: `loki_crm_session=${encodeURIComponent(session)}` },
  });
  assert.equal(await middleware(request), undefined);
});

test("mobile tasks page uses the same owner-only middleware", async () => {
  const { default: middleware } = await loadMiddleware();
  const unauthorized = await middleware(new Request("https://www.lokilyd.no/crmplatform/tasks.html"));
  assert.equal(unauthorized.status, 307);
  const session = auth.createToken("charles@lokilyd.no", "session", 60);
  const authorized = new Request("https://www.lokilyd.no/crmplatform/tasks.html", {
    headers: { cookie: `loki_crm_session=${encodeURIComponent(session)}` },
  });
  assert.equal(await middleware(authorized), undefined);
});

test("server and iOS source directories are not publicly served", async () => {
  const { default: middleware } = await loadMiddleware();
  for (const path of ["/lib/crm-auth.js", "/test/crm.test.js", "/ios/LokiCRM/project.yml", "/bridge/README.md", "/build/blob-upload-entry.js"]) {
    const response = await middleware(new Request(`https://www.lokilyd.no${path}`));
    assert.equal(response.status, 404, path);
  }
});

test("a token for a former team member cannot unlock CRM HTML", async () => {
  const { default: middleware } = await loadMiddleware();
  const session = auth.createToken("leon@lokilyd.no", "session", 60);
  const [payload, signature] = session.split(".");
  const forgedPayload = Buffer.from(
    JSON.stringify({ email: "daniel@lokilyd.no", purpose: "session", expires: Date.now() + 60_000 }),
  ).toString("base64url");
  const request = new Request("https://www.lokilyd.no/crmplatform/private", {
    headers: { cookie: `loki_crm_session=${forgedPayload}.${signature || payload}` },
  });
  const response = await middleware(request);
  assert.equal(response.status, 307);
});
