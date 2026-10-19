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

test("public homepages promote Loki New Voices in their selected language", () => {
  const norwegian = read("index.html");
  assert.match(norwegian, /<html lang="no">/);
  assert.match(norwegian, /Søknaden er åpen: Loki New Voices/);
  assert.match(norwegian, /4\.–6\. desember 2026/);
  assert.match(norwegian, /Søknaden til Loki New Voices er nå åpen/);
  assert.match(norwegian, /SØK TIL LOKI NEW VOICES/);
  assert.match(norwegian, /href="\/loki-songs-camp\.html"/);
  assert.doesNotMatch(norwegian, /Applications are now open for Loki New Voices/);

  const english = read("en/index.html");
  assert.match(english, /<html lang="en">/);
  assert.match(english, /Applications open: Loki New Voices/);
  assert.match(english, /4–6 December 2026/);
  assert.match(english, /Applications are now open for Loki New Voices/);
  assert.match(english, /APPLY TO LOKI NEW VOICES/);
  assert.match(english, /href="\/en\/loki-songs-camp_en\.html"/);
  assert.doesNotMatch(english, /Søknaden til Loki New Voices er nå åpen/);
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
  assert.match(norwegian, /SØK NÅ/);
  assert.doesNotMatch(norwegian, /SONGWRITING CAMPS FOR EMERGING CREATIVES/);

  const english = read("en/loki-songs-camp_en.html");
  assert.match(english, /<title>LOKI NEW VOICES \| LOKI LYDSTUDIO<\/title>/);
  assert.match(english, /<h1 class="section-title hero-title">LOKI NEW VOICES<\/h1>/);
  assert.match(english, /4–6 DECEMBER 2026/);
  assert.match(english, /Write together/);
  assert.match(english, /Develop your craft/);
  assert.match(english, /Build connections/);
  assert.match(english, /APPLY NOW/);
  assert.doesNotMatch(english, /LÅTSKRIVERCAMPER FOR NYE TALENTER/);
});

test("every campaign page links safely to the published application form", () => {
  for (const relativePath of publicCampPages) {
    const html = read(relativePath);
    assert.match(html, new RegExp(`href="${applicationUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*target="_blank"[^>]*rel="noopener noreferrer"`));
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
