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

test("public homepages introduce the new Loki Songs camp", () => {
  for (const relativePath of ["index.html", "en/index.html"]) {
    const html = read(relativePath);
    assert.match(html, /Camps for emerging artists, songwriters &amp; producers/);
    assert.match(html, /We’re excited to introduce a brand new songwriting camp from Loki Songs/);
    assert.match(html, /Over three inspiring days/);
    assert.match(html, /SIGN UP FOR UPDATES/);
  }
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

test("dedicated camp pages contain general camp information without an invented date", () => {
  for (const relativePath of ["loki-songs-camp.html", "en/loki-songs-camp_en.html"]) {
    const html = read(relativePath);
    assert.match(html, /SONGWRITING CAMPS FOR EMERGING CREATIVES/);
    assert.match(html, /Write together/);
    assert.match(html, /Develop your craft/);
    assert.match(html, /Build connections/);
    assert.match(html, /GET CAMP UPDATES/);
  }
});
