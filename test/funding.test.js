const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { upcomingGrants } = require("../crmplatform/funding");

test("expired grant deadlines are hidden and upcoming deadlines are sorted first", () => {
  const grants = [
    { name: "Unknown deadline", deadlineAt: null },
    { name: "Later", deadlineAt: "2026-10-20T13:00:00+02:00" },
    { name: "Expired", deadlineAt: "2026-09-15T13:00:00+02:00" },
    { name: "Sooner", deadlineAt: "2026-10-02T13:00:00+02:00" },
  ];

  assert.deepEqual(
    upcomingGrants(grants, "2026-09-29T12:00:00+02:00").map((grant) => grant.name),
    ["Sooner", "Later", "Unknown deadline"]
  );
  assert.equal(grants[0].name, "Unknown deadline", "source order stays unchanged");
});

test("deadline remains visible until its exact time, then disappears", () => {
  const grant = { name: "Today", deadlineAt: "2026-09-29T13:00:00+02:00" };
  assert.equal(upcomingGrants([grant], "2026-09-29T13:00:00+02:00").length, 1);
  assert.equal(upcomingGrants([grant], "2026-09-29T13:00:01+02:00").length, 0);
});

test("invalid deadline does not appear as an active grant", () => {
  assert.deepEqual(upcomingGrants([{ name: "Invalid", deadlineAt: "not-a-date" }]), []);
});

test("overview and funding view share the same upcoming-grant selector", () => {
  const html = fs.readFileSync(path.join(__dirname, "../crmplatform/index.html"), "utf8");
  assert.match(html, /src="\/crmplatform\/funding\.js"/);
  assert.match(html, /const upcoming=window\.LokiFunding\.upcomingGrants\(grants\)/);
  assert.match(html, /id="overview-funding"/);
  assert.doesNotMatch(html, /<article class="grant-mini"><div class="calendar"><strong>15<\/strong>/);
});
