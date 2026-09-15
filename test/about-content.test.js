const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("about sections use matching cards, images and localized headings", () => {
  const norwegian = read("index.html");
  const english = read("en/index.html");

  assert.equal((norwegian.match(/<article class="about-col">/g) || []).length, 2);
  assert.equal((english.match(/<article class="about-col">/g) || []).length, 2);
  assert.equal((norwegian.match(/<div class="about-thumb">/g) || []).length, 2);
  assert.equal((english.match(/<div class="about-thumb">/g) || []).length, 2);
  assert.match(norwegian, /<h3>STUDIOET<\/h3>/);
  assert.match(norwegian, /<h3>ARBEIDSMÅTEN VÅR<\/h3>/);
  assert.match(english, /<h3>THE STUDIO<\/h3>/);
  assert.match(english, /<h3>OUR APPROACH<\/h3>/);
  assert.doesNotMatch(norwegian, /profesjonelle ¨/);
});

test("about cards share one responsive image and layout system", () => {
  const css = read("templatemo-parallax-starter.css");
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /aspect-ratio: 16 \/ 9/);
  assert.match(css, /\.about-copy/);
  assert.doesNotMatch(css, /\.thumb-top-left/);
  assert.doesNotMatch(css, /\.about-thumb-wide/);
});
