const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("team pages present the confirmed founders in both languages", () => {
  const norwegian = read("folk.html");
  const english = read("en/team.html");

  assert.match(norwegian, /<html lang="no">/);
  assert.match(norwegian, /Leon Frick og Charles Wise grunnla Loki Lydstudio/);
  assert.match(norwegian, /Grunnlegger · Loki Lydstudio/g);
  assert.match(english, /<html lang="en">/);
  assert.match(english, /Leon Frick and Charles Wise founded Loki Lydstudio/);
  assert.match(english, /Founder · Loki Lydstudio/g);

  for (const html of [norwegian, english]) {
    assert.match(html, /\/images\/leon\.frick\.jpg/);
    assert.match(html, /\/images\/charles-wise\.jpg/);
    assert.match(html, /mailto:leon@lokilyd\.no/);
    assert.match(html, /mailto:charles@lokilyd\.no/);
    assert.doesNotMatch(html, /Daniel/i);
  }
});

test("homepages link to the localized team pages", () => {
  assert.match(read("index.html"), /href="\/folk\.html">FOLKA VÅRE<\/a>/);
  assert.match(read("en/index.html"), /href="\/en\/team\.html">TEAM<\/a>/);
});

test("broader community profiles are described without exposing the private tenant register", () => {
  const norwegian = read("folk.html");
  const english = read("en/team.html");
  assert.match(norwegian, /i samråd med den enkelte/);
  assert.match(english, /with each person’s agreement/);
  assert.doesNotMatch(norwegian, /tanjatjong|knallbein|tordvaernes/i);
});

test("team layout has responsive founder cards and stable portraits", () => {
  const css = read("team.css");
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /aspect-ratio: 5 \/ 4/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /\.founder-grid[\s\S]*grid-template-columns: 1fr/);
  assert.ok(fs.existsSync(path.join(root, "images/leon.frick.jpg")));
  assert.ok(fs.existsSync(path.join(root, "images/charles-wise.jpg")));
});
