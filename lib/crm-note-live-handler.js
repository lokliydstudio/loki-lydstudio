const { requireUser } = require("./crm-auth");
const { readCollection, mutateCollection } = require("./crm-store");
const { activeEditors, initialLiveState, liveNoteId, mergeLiveState, noteCollection, updateEditor } = require("./crm-live-notes");

async function noteById(id) {
  return (await readCollection("workspace")).find((item) => item.kind === "note" && item.id === id);
}

module.exports = async function handler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const id = liveNoteId(req.query?.id || req.body?.id);
  if (!id) return res.status(400).json({ error: "Ugyldig notat-ID." });
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  try {
    const liveCollection = noteCollection(id);
    const editorsCollection = noteCollection(id, "note-editors");
    if (req.method === "GET") {
      const existing = (await readCollection(liveCollection))[0];
      let initialized = { result: existing };
      if (!existing?.state) {
        const note = await noteById(id);
        if (!note) return res.status(404).json({ error: "Notatet ble ikke funnet." });
        initialized = await mutateCollection(liveCollection, (items) => {
          if (items[0]?.state) return { items, result: items[0] };
          const record = { id, state: initialLiveState(note.content), updatedAt: note.updatedAt, updatedBy: note.updatedBy };
          return { items: [record], result: record };
        });
      }
      const editors = activeEditors(await readCollection(editorsCollection), id, user.email);
      return res.status(200).json({ state: initialized.result.state, editors });
    }
    const operation = String(req.body?.operation || "");
    if (operation === "update") {
      const incoming = req.body?.state;
      const change = await mutateCollection(liveCollection, (items) => {
        if (!items[0]?.state) return { error: "Åpne notatet på nytt før du skriver." };
        const merged = mergeLiveState(items[0].state, incoming);
        const record = { ...items[0], state: merged.state, updatedAt: new Date().toISOString(), updatedBy: user.email };
        return { items: [record], result: record };
      });
      if (change.error) return res.status(409).json({ error: change.error });
      return res.status(200).json({ state: change.result.state, updatedAt: change.result.updatedAt });
    }
    if (operation === "presence" || operation === "leave") {
      if (!(await readCollection(liveCollection))[0]?.state) return res.status(404).json({ error: "Notatet ble ikke funnet." });
      const change = await mutateCollection(editorsCollection, (items) => ({
        items: operation === "leave"
          ? items.filter((record) => !(record.id === id && record.email === user.email))
          : updateEditor(items, id, user.email, req.body?.typing === true),
      }));
      return res.status(200).json({ editors: activeEditors(change.items, id, user.email) });
    }
    return res.status(400).json({ error: "Ukjent handling." });
  } catch (error) {
    console.error("Note live error", error);
    return res.status(400).json({ error: error.message || "Kunne ikke redigere notatet." });
  }
};
