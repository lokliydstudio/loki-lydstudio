const crypto = require("node:crypto");
const Y = require("yjs");

const MAX_STATE_BYTES = 1024 * 1024;
const MAX_TEXT_LENGTH = 12000;
const EDITOR_WINDOW_MS = 12_000;

function liveNoteId(value) {
  const id = String(value || "");
  return /^note-[a-zA-Z0-9-]{8,115}$/.test(id) ? id : "";
}

function noteCollection(id, prefix = "note-live") {
  const validId = liveNoteId(id);
  if (!validId || !["note-live", "note-editors"].includes(prefix)) throw new Error("Ugyldig notat-ID.");
  const hex = crypto.createHash("sha256").update(validId).digest("hex");
  const letters = hex.replace(/[0-9a-f]/g, (digit) => "abcdefghijklmnop"[parseInt(digit, 16)]);
  return `${prefix}-${letters}`;
}

function encodeState(doc) {
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  if (state.length > MAX_STATE_BYTES) throw new Error("Notatet har nådd grensen for live-redigering.");
  return state.toString("base64");
}

function decodeState(value) {
  const text = String(value || "");
  if (!text || text.length > Math.ceil(MAX_STATE_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    throw new Error("Ugyldig live-oppdatering.");
  }
  const bytes = Buffer.from(text, "base64");
  if (!bytes.length || bytes.length > MAX_STATE_BYTES) throw new Error("Live-oppdateringen er for stor.");
  return new Uint8Array(bytes);
}

function initialLiveState(content) {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, String(content || "").slice(0, MAX_TEXT_LENGTH));
  return encodeState(doc);
}

function contentFromState(state) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, decodeState(state));
  return doc.getText("content").toString();
}

function mergeLiveState(current, incoming) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, decodeState(current));
  Y.applyUpdate(doc, decodeState(incoming));
  const content = doc.getText("content").toString();
  if (content.length > MAX_TEXT_LENGTH) throw new Error("Notatet kan ikke være lengre enn 12 000 tegn.");
  return { state: encodeState(doc), content };
}

function activeEditors(records, noteId, currentEmail, now = Date.now()) {
  return (records || [])
    .filter((record) => record.id === noteId && record.email !== currentEmail &&
      Number.isFinite(Date.parse(record.at)) && now - Date.parse(record.at) < EDITOR_WINDOW_MS)
    .map((record) => ({
      name: record.email === "leon@lokilyd.no" ? "Leon" : record.email === "charles@lokilyd.no" ? "Charles" : "En kollega",
      typing: Boolean(record.typing && now - Date.parse(record.at) < 4500),
    }));
}

function updateEditor(records, noteId, email, typing, now = new Date()) {
  const time = now.getTime();
  const active = (records || []).filter((record) => record.id !== noteId || record.email !== email)
    .filter((record) => Number.isFinite(Date.parse(record.at)) && time - Date.parse(record.at) < EDITOR_WINDOW_MS);
  return [{ id: noteId, email, at: now.toISOString(), typing: Boolean(typing) }, ...active].slice(0, 20);
}

async function notesWithLiveContent(items, readCollection) {
  return Promise.all(items.map(async (item) => {
    if (item.kind !== "note" || !liveNoteId(item.id)) return item;
    const record = (await readCollection(noteCollection(item.id)))[0];
    if (!record?.state) return item;
    return { ...item, content: contentFromState(record.state), updatedAt: record.updatedAt || item.updatedAt, updatedBy: record.updatedBy || item.updatedBy };
  }));
}

module.exports = {
  activeEditors,
  contentFromState,
  initialLiveState,
  liveNoteId,
  mergeLiveState,
  noteCollection,
  notesWithLiveContent,
  updateEditor,
};
