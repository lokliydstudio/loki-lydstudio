const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("membership information is retained but not linked from the public navigation", () => {
  assert.ok(fs.existsSync(path.join(root, "blimedlem.html")));
  assert.match(read("blimedlem.html"), /<h1>Bli medlem<\/h1>/);

  const publicEntrypoints = ["index.html", "en/index.html", "folk.html", "en/team.html"];
  for (const page of publicEntrypoints) {
    assert.doesNotMatch(read(page), /href="\/blimedlem\.html"/);
  }
});
