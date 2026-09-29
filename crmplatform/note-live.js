(() => {
  const Y = window.LokiY;
  let session = null;
  let generation = 0;
  const textarea = () => document.querySelector('#note-form textarea[name="content"]');
  const status = () => document.getElementById("note-live-status");
  const info = () => document.getElementById("note-live-info");
  const editors = () => document.getElementById("note-live-editors");
  const bytesToBase64 = (bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  };
  const base64ToBytes = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  async function request(id, operation, extra = {}) {
    const url = `/api/crm/note-live?id=${encodeURIComponent(id)}`;
    const response = await fetch(url, {
      credentials: "same-origin",
      ...(operation === "get" ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, operation, ...extra }) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Kunne ikke synkronisere notatet.");
    return data;
  }
  function showEditors(list) {
    editors().textContent = list?.length
      ? list.map((editor) => editor.typing ? `${editor.name} skriver nå …` : `${editor.name} er inne i notatet`).join(" · ")
      : "Ingen andre redigerer akkurat nå";
  }
  function replaceText(next, previous) {
    const field = textarea();
    if (field.value === next) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    field.value = next;
    if (document.activeElement === field) {
      const delta = next.length - previous.length;
      field.setSelectionRange(Math.max(0, start + delta), Math.max(0, end + delta));
    }
  }
  function announceContent(current) {
    if (session === current) window.dispatchEvent(new CustomEvent("loki-note-content", { detail: { id: current.id, content: current.doc.getText("content").toString() } }));
  }
  function applyRemote(current, state) {
    const before = current.doc.getText("content").toString();
    Y.applyUpdate(current.doc, base64ToBytes(state), "remote");
    if (session === current) {
      replaceText(current.doc.getText("content").toString(), before);
      if (before !== current.doc.getText("content").toString()) announceContent(current);
    }
  }
  async function flush(current = session) {
    if (!current?.doc || !current.dirty) return current?.saving || Promise.resolve();
    if (current.saving) { await current.saving; return flush(current); }
    clearTimeout(current.saveTimer);
    current.dirty = false;
    const state = bytesToBase64(Y.encodeStateAsUpdate(current.doc));
    current.saving = request(current.id, "update", { state }).then((result) => {
      applyRemote(current, result.state);
      if (session === current) status().textContent = current.dirty ? "Lagrer endringer …" : "Alle endringer er lagret";
    }).catch((error) => {
      current.dirty = true;
      if (session === current) status().textContent = `Ikke lagret: ${error.message}`;
      if (session === current) current.saveTimer = setTimeout(() => { flush(current).catch(() => {}); }, 3000);
      throw error;
    }).finally(() => { current.saving = null; });
    return current.saving;
  }
  function scheduleSave(current) {
    clearTimeout(current.saveTimer);
    current.saveTimer = setTimeout(() => { flush(current).catch(() => {}); }, 700);
  }
  function onInput() {
    const current = session;
    if (!current?.doc) return;
    const value = textarea().value;
    const text = current.doc.getText("content");
    const before = text.toString();
    if (before === value) return;
    let prefix = 0;
    while (prefix < before.length && prefix < value.length && before[prefix] === value[prefix]) prefix++;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < value.length - prefix && before[before.length - suffix - 1] === value[value.length - suffix - 1]) suffix++;
    current.doc.transact(() => {
      if (before.length - prefix - suffix) text.delete(prefix, before.length - prefix - suffix);
      if (value.length - prefix - suffix) text.insert(prefix, value.slice(prefix, value.length - suffix));
    });
    current.dirty = true;
    current.lastInput = Date.now();
    announceContent(current);
    status().textContent = "Lagrer endringer …";
    scheduleSave(current);
    if (Date.now() - current.lastPresence > 2000) presence(current);
  }
  async function presence(current) {
    if (session !== current) return;
    current.lastPresence = Date.now();
    try {
      const data = await request(current.id, "presence", { typing: Date.now() - current.lastInput < 3500 });
      if (session === current) showEditors(data.editors);
    } catch { /* Polling retries presence. */ }
  }
  async function poll(current) {
    if (session !== current || current.polling) return;
    current.polling = true;
    try {
      const data = await request(current.id, "get");
      if (session !== current) return;
      applyRemote(current, data.state);
      showEditors(data.editors);
      if (!current.dirty && !current.saving) status().textContent = "Alle endringer er lagret · synkronisert";
    } catch (error) {
      if (session === current) status().textContent = `Synkronisering avbrutt: ${error.message}`;
    } finally { current.polling = false; }
  }
  async function open(id) {
    close();
    const token = ++generation;
    info().hidden = false;
    status().textContent = "Kobler til felles redigering …";
    editors().textContent = "";
    textarea().readOnly = true;
    try {
      if (!Y) throw new Error("Redigeringsmodulen kunne ikke lastes.");
      const data = await request(id, "get");
      if (token !== generation) return;
      const doc = new Y.Doc();
      Y.applyUpdate(doc, base64ToBytes(data.state));
      const current = { id, doc, dirty: false, saving: null, saveTimer: null, lastInput: 0, lastPresence: 0, polling: false };
      session = current;
      textarea().value = doc.getText("content").toString();
      textarea().readOnly = false;
      textarea().addEventListener("input", onInput);
      status().textContent = "Felles redigering aktiv · lagres automatisk";
      showEditors(data.editors);
      presence(current);
      current.pollTimer = setInterval(() => poll(current), 2000);
      current.presenceTimer = setInterval(() => presence(current), 4000);
    } catch (error) {
      if (token !== generation) return;
      textarea().readOnly = true;
      status().textContent = `Kan ikke redigere trygt: ${error.message}`;
    }
  }
  function close() {
    generation++;
    const current = session;
    session = null;
    textarea().removeEventListener("input", onInput);
    textarea().readOnly = false;
    info().hidden = true;
    if (!current) return;
    clearTimeout(current.saveTimer);
    clearInterval(current.pollTimer);
    clearInterval(current.presenceTimer);
    flush(current).catch(() => {});
    request(current.id, "leave").catch(() => {});
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && session?.dirty) flush(session).catch(() => {});
  });
  window.addEventListener("beforeunload", (event) => {
    if (!session?.dirty && !session?.saving) return;
    event.preventDefault();
    event.returnValue = "";
  });
  window.LokiNoteLive = { open, close, flush, active: (id) => session?.id === id, content: () => session?.doc?.getText("content").toString() };
})();
