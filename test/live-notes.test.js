const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Y = require("yjs");
const {
  activeEditors, contentFromState, initialLiveState, mergeLiveState,
  noteCollection, notesWithLiveContent, updateEditor,
} = require("../lib/crm-live-notes");

test("simultaneous note edits merge instead of replacing the other writer", () => {
  const seed = initialLiveState("Møtenotater: ");
  const leon = new Y.Doc();
  const charles = new Y.Doc();
  Y.applyUpdate(leon, Buffer.from(seed, "base64"));
  Y.applyUpdate(charles, Buffer.from(seed, "base64"));
  leon.getText("content").insert(13, "Leon: idé. ");
  charles.getText("content").insert(13, "Charles: neste steg.");
  const first = mergeLiveState(seed, Buffer.from(Y.encodeStateAsUpdate(leon)).toString("base64"));
  const second = mergeLiveState(first.state, Buffer.from(Y.encodeStateAsUpdate(charles)).toString("base64"));
  assert.match(second.content, /Leon: idé/);
  assert.match(second.content, /Charles: neste steg/);
  assert.equal(mergeLiveState(second.state, Buffer.from(Y.encodeStateAsUpdate(leon)).toString("base64")).content, second.content);
  assert.equal(contentFromState(second.state), second.content);
});

test("editor presence only shows other active people and their typing status", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");
  let records = updateEditor([], "note-12345678", "leon@lokilyd.no", true, now);
  records = updateEditor(records, "note-12345678", "charles@lokilyd.no", true, now);
  assert.deepEqual(activeEditors(records, "note-12345678", "leon@lokilyd.no", now.getTime()), [{ name: "Charles", typing: true }]);
  assert.deepEqual(activeEditors(records, "note-12345678", "leon@lokilyd.no", now.getTime() + 13000), []);
});

test("workspace and backups receive live content without exposing CRDT state", async () => {
  const note = { id: "note-12345678", kind: "note", content: "Gammelt innhold" };
  const result = await notesWithLiveContent([note, { id: "task-1", kind: "task" }], async (collection) => {
    assert.equal(collection, noteCollection(note.id));
    return [{ state: initialLiveState("Oppdatert sammen"), updatedBy: "charles@lokilyd.no" }];
  });
  assert.equal(result[0].content, "Oppdatert sammen");
  assert.equal(result[0].updatedBy, "charles@lokilyd.no");
  assert.equal(result[0].state, undefined);
  assert.equal(result[1].kind, "task");
});

test("CRM serves the authenticated collaborative editor and status UI", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "crmplatform/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "crmplatform/note-live.js"), "utf8");
  assert.match(html, /note-live-status/);
  assert.match(html, /note-live-editors/);
  assert.match(html, /note-yjs\.js/);
  assert.match(script, /setInterval\(\(\) => poll\(current\), 2000\)/);
  assert.match(script, /"presence", \{ typing:/);
});
