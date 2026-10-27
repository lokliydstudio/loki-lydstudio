const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeApplication } = require("../lib/camp-application");

const valid = {
  name: "Test Artist", address: "Frydenbølien 17, Bergen", phone: "+47 123 45 678",
  email: "test@example.com", roles: ["Artist", "Låtskriver"],
  bio: "Jeg lager popmusikk og vil skrive med andre.",
  splits: "agree", dietary: "Oppgis senere", feeAccepted: true, privacyAccepted: true,
};

test("camp application requires the fee acknowledgement and stores it as 1300 NOK", () => {
  assert.match(normalizeApplication({ ...valid, feeAccepted: false }).error, /participation fee/);
  const result = normalizeApplication(valid);
  assert.equal(result.error, undefined);
  assert.equal(result.application.feeNok, 1300);
  assert.deepEqual(result.application.roles, ["Artist", "Låtskriver"]);
});

test("dietary details need separate consent while deferring them does not", () => {
  assert.match(normalizeApplication({ ...valid, dietary: "Glutenfri" }).error, /Consent/);
  const result = normalizeApplication({ ...valid, dietary: "Glutenfri", dietaryConsent: true });
  assert.equal(result.application.dietary, "Glutenfri");
  assert.equal(result.application.dietaryConsent, true);
});

test("form is unlisted and has no event timing", () => {
  const root = path.join(__dirname, "..");
  const form = fs.readFileSync(path.join(root, "camp-application/index.html"), "utf8");
  assert.doesNotMatch(form, /event timing|16th.?20th sept|frydenbølien 19/i);
  assert.match(form, /FRYDENBØLIEN 17/);
  assert.match(form, /<html lang="en">/);
  assert.match(form, /NOK 1,300/);
  assert.match(form, /href="\/en\/personvern_en.html"/);
  for (const publicPage of ["index.html", "en/index_en.html", "loki-songs-camp.html", "en/loki-songs-camp_en.html"]) {
    if (fs.existsSync(path.join(root, publicPage))) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, publicPage), "utf8"), /camp-application/);
    }
  }
});
