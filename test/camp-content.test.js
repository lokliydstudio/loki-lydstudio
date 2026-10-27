const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const publicCampPages = [
  "index.html",
  "en/index.html",
  "loki-songs-camp.html",
  "en/loki-songs-camp_en.html",
];
const applicationUrl = "https://docs.google.com/forms/d/e/1FAIpQLSc1mYqAHxkRxuM3XNNFo9xzgqCd3k8figatZ0riwIV71vAb5Q/viewform?usp=publish-editor";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("public homepages show Loki New Voices as full in their selected language", () => {
  const norwegian = read("index.html");
  assert.match(norwegian, /<html lang="no">/);
  assert.match(norwegian, /Loki New Voices &middot; 4\.–6\. desember 2026 &middot; Fullbooket/);
  assert.match(norwegian, /4\.–6\. desember 2026/);
  assert.match(norwegian, /Loki New Voices er fullbooket, og søknaden til campen 4\.–6\. desember 2026 er stengt\./);
  assert.doesNotMatch(norwegian, /tredagers låtskrivercamp|for unge og fremadstormende/i);
  assert.match(norwegian, /MELD INTERESSE FOR FREMTIDIGE CAMPER/);
  assert.match(norwegian, /href="\/loki-songs-camp\.html"/);
  assert.doesNotMatch(norwegian, /Applications are now open for Loki New Voices|Søknaden er åpen/);

  const english = read("en/index.html");
  assert.match(english, /<html lang="en">/);
  assert.match(english, /Loki New Voices &middot; 4–6 December 2026 &middot; Fully booked/);
  assert.match(english, /4–6 December 2026/);
  assert.match(english, /Loki New Voices is fully booked, and applications for the 4–6 December 2026 camp are closed\./);
  assert.doesNotMatch(english, /three-day songwriting camp|for emerging songwriters/i);
  assert.match(english, /REGISTER INTEREST IN FUTURE CAMPS/);
  assert.match(english, /href="\/en\/loki-songs-camp_en\.html"/);
  assert.doesNotMatch(english, /Søknaden til Loki New Voices er nå åpen|Applications are now open/);
});

test("the completed September campaign is absent from all public camp pages", () => {
  const html = publicCampPages.map(read).join("\n");
  assert.doesNotMatch(html, /Applications open for our songwriting camp/i);
  assert.doesNotMatch(html, /SAVE THE DATE/i);
  assert.doesNotMatch(html, /16[.–-]20\. september 2026/i);
  assert.doesNotMatch(html, /September 16[–-]20, 2026/i);
});

test("dedicated camp pages contain localized Loki New Voices information", () => {
  const norwegian = read("loki-songs-camp.html");
  assert.match(norwegian, /<title>LOKI NEW VOICES \| LOKI LYDSTUDIO<\/title>/);
  assert.match(norwegian, /<h1 class="section-title hero-title">LOKI NEW VOICES<\/h1>/);
  assert.match(norwegian, /4\.–6\. DESEMBER 2026/);
  assert.match(norwegian, /Skriv sammen/);
  assert.match(norwegian, /Utvikle deg/);
  assert.match(norwegian, /Bygg nettverk/);
  assert.match(norwegian, /Søknaden er stengt, men campen går som planlagt/);
  assert.match(norwegian, /MELD INTERESSE FOR FREMTIDIGE CAMPER/);
  assert.doesNotMatch(norwegian, /tredagers|\bunge\b/i);
  assert.doesNotMatch(norwegian, /SONGWRITING CAMPS FOR EMERGING CREATIVES/);

  const english = read("en/loki-songs-camp_en.html");
  assert.match(english, /<title>LOKI NEW VOICES \| LOKI LYDSTUDIO<\/title>/);
  assert.match(english, /<h1 class="section-title hero-title">LOKI NEW VOICES<\/h1>/);
  assert.match(english, /4–6 DECEMBER 2026/);
  assert.match(english, /Write together/);
  assert.match(english, /Develop your craft/);
  assert.match(english, /Build connections/);
  assert.match(english, /Applications are closed, but the camp will take place as planned/);
  assert.match(english, /REGISTER INTEREST IN FUTURE CAMPS/);
  assert.doesNotMatch(english, /three-day|\bemerging\b/i);
  assert.doesNotMatch(english, /LÅTSKRIVERCAMPER FOR NYE TALENTER/);
});

test("all campaign pages remove the application link and offer future-camp contact", () => {
  for (const relativePath of publicCampPages) {
    const html = read(relativePath);
    assert.doesNotMatch(html, /href="https:\/\/docs\.google\.com\/forms\//);
    assert.ok(!html.includes(applicationUrl));
    assert.match(html, /href="mailto:camps@lokilyd\.no\?subject=/);
  }
});

test("dedicated camp pages expose valid event metadata", () => {
  for (const relativePath of ["loki-songs-camp.html", "en/loki-songs-camp_en.html"]) {
    const html = read(relativePath);
    const match = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(match);
    const event = JSON.parse(match[1]);
    assert.equal(event["@type"], "MusicEvent");
    assert.equal(event.name, "Loki New Voices");
    assert.equal(event.startDate, "2026-12-04");
    assert.equal(event.endDate, "2026-12-06");
    assert.equal(event.location.address.streetAddress, "Frydenbølien 17");
  }
});
