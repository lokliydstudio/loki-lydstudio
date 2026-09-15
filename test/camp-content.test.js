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

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("public homepages introduce the new Loki Songs camp in their selected language", () => {
  const norwegian = read("index.html");
  assert.match(norwegian, /<html lang="no">/);
  assert.match(norwegian, /Låtskrivercamper for unge artister, låtskrivere og produsenter/);
  assert.match(norwegian, /Vi gleder oss til å presentere en helt ny låtskrivercamp fra Loki Songs/);
  assert.match(norwegian, /Over tre inspirerende dager/);
  assert.match(norwegian, /MELD DEG PÅ FOR OPPDATERINGER/);
  assert.doesNotMatch(norwegian, /We’re excited to introduce/);

  const english = read("en/index.html");
  assert.match(english, /<html lang="en">/);
  assert.match(english, /Camps for emerging artists, songwriters &amp; producers/);
  assert.match(english, /We’re excited to introduce a brand new songwriting camp from Loki Songs/);
  assert.match(english, /Over three inspiring days/);
  assert.match(english, /SIGN UP FOR UPDATES/);
  assert.doesNotMatch(english, /Vi gleder oss til å presentere/);
});

test("completed camp campaign is absent from all public camp pages", () => {
  const html = publicCampPages.map(read).join("\n");
  assert.doesNotMatch(html, /Applications open for our songwriting camp/i);
  assert.doesNotMatch(html, /Apply now/i);
  assert.doesNotMatch(html, /SAVE THE DATE/i);
  assert.doesNotMatch(html, /16[.–-]20\. september 2026/i);
  assert.doesNotMatch(html, /September 16[–-]20, 2026/i);
  assert.doesNotMatch(html, /docs\.google\.com\/forms/i);
});

test("dedicated camp pages contain localized general information without an invented date", () => {
  const norwegian = read("loki-songs-camp.html");
  assert.match(norwegian, /LÅTSKRIVERCAMPER FOR NYE TALENTER/);
  assert.match(norwegian, /Skriv sammen/);
  assert.match(norwegian, /Utvikle deg/);
  assert.match(norwegian, /Bygg nettverk/);
  assert.match(norwegian, /FÅ CAMP-OPPDATERINGER/);
  assert.doesNotMatch(norwegian, /SONGWRITING CAMPS FOR EMERGING CREATIVES/);

  const english = read("en/loki-songs-camp_en.html");
  assert.match(english, /SONGWRITING CAMPS FOR EMERGING CREATIVES/);
  assert.match(english, /Write together/);
  assert.match(english, /Develop your craft/);
  assert.match(english, /Build connections/);
  assert.match(english, /GET CAMP UPDATES/);
  assert.doesNotMatch(english, /LÅTSKRIVERCAMPER FOR NYE TALENTER/);
});
