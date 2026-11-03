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

test("camp registration requires the fee acknowledgement and stores the March 2027 event", () => {
  assert.match(normalizeApplication({ ...valid, feeAccepted: false }).error, /participation fee/);
  const result = normalizeApplication(valid);
  assert.equal(result.error, undefined);
  assert.equal(result.application.feeNok, 1500);
  assert.equal(result.application.campId, "loki-songs-2027-03");
  assert.equal(result.application.campStart, "2027-03-04");
  assert.equal(result.application.campEnd, "2027-03-06");
  assert.deepEqual(result.application.roles, ["Artist", "Låtskriver"]);
});

test("dietary details need separate consent while deferring them does not", () => {
  assert.match(normalizeApplication({ ...valid, dietary: "Glutenfri" }).error, /Consent/);
  const result = normalizeApplication({ ...valid, dietary: "Glutenfri", dietaryConsent: true });
  assert.equal(result.application.dietary, "Glutenfri");
  assert.equal(result.application.dietaryConsent, true);
});

test("form is unlisted and shows the March 2027 camp details", () => {
  const root = path.join(__dirname, "..");
  const form = fs.readFileSync(path.join(root, "camp-application/index.html"), "utf8");
  assert.doesNotMatch(form, /event timing|16th.?20th sept|frydenbølien 19/i);
  assert.match(form, /FRYDENBØLIEN 17/);
  assert.match(form, /<html lang="en">/);
  assert.match(form, /4–6 MARCH 2027/);
  assert.match(form, /NOK 1,500/);
  assert.doesNotMatch(form, /NOK 1,300|future songwriting camp/i);
  assert.match(form, /href="\/en\/personvern_en.html"/);
  for (const publicPage of ["index.html", "en/index_en.html", "loki-songs-camp.html", "en/loki-songs-camp_en.html"]) {
    if (fs.existsSync(path.join(root, publicPage))) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, publicPage), "utf8"), /camp-application/);
    }
  }
});
