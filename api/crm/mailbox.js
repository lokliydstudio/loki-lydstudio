const { simpleParser } = require("mailparser");
const { requireUser } = require("../../lib/crm-auth");
const { createImapClient } = require("../../lib/crm-mail");
const { inferLeadDetails } = require("../../lib/crm-lead-enrichment");
const { classifyEnvelope, cleanEmail, sortMessages } = require("../../lib/crm-mail-sort");
const { readCollection, writeCollection } = require("../../lib/crm-store");

const SORT_HEADERS = ["list-id", "list-unsubscribe", "auto-submitted", "precedence", "x-auto-response-suppress"];

async function preferenceMap() {
  const preferences = await readCollection("mail-sort");
  return {
    keys: new Map(preferences.map((item) => [item.key, item.category])),
    senders: new Map(preferences.filter((item) => item.sender).map((item) => [item.sender, item.category])),
  };
}

function envelopeToMessage(message, preferences = { keys: new Map(), senders: new Map() }) {
  const automatic = classifyEnvelope(message);
  const override = preferences.keys.get(automatic.key) || preferences.senders.get(automatic.transportEmail);
  return classifyEnvelope(message, override);
}

async function updatePreference(req, res, user) {
  const key = String(req.body?.key || "").toLowerCase();
  const category = String(req.body?.category || "");
  const sender = cleanEmail(req.body?.sender);
  if (!/^[a-f0-9]{32}$/.test(key) || !new Set(["irrelevant", "inbox"]).has(category)) {
    return res.status(400).json({ error: "Ugyldig sorteringsvalg." });
  }
  const preferences = await readCollection("mail-sort");
  const next = preferences.filter((item) => item.key !== key && (!sender || item.sender !== sender));
  next.unshift({ key, category, sender: category === "irrelevant" ? sender : "", updatedAt: new Date().toISOString(), updatedBy: user.email });
  await writeCollection("mail-sort", next.slice(0, 1000));
  return res.status(200).json({ ok: true, key, category });
}

module.exports = async function handler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  if (req.method === "POST") {
    try {
      return await updatePreference(req, res, user);
    } catch (error) {
      console.error("Mailbox preference update failed", error?.message);
      return res.status(503).json({ error: "Kunne ikke lagre e-postsorteringen." });
    }
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const client = createImapClient();
  try {
    const preferences = await preferenceMap();
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
    const requestedUid = Number.parseInt(req.query?.uid, 10);
    if (Number.isFinite(requestedUid) && requestedUid > 0) {
      const metadata = await client.fetchOne(requestedUid, { uid: true, envelope: true, size: true, headers: SORT_HEADERS }, { uid: true });
      if (!metadata) return res.status(404).json({ error: "Meldingen ble ikke funnet." });
      if (metadata.size > 2_000_000) return res.status(413).json({ ...envelopeToMessage(metadata, preferences), error: "Meldingen er for stor til å forhåndsvise." });
      const full = await client.fetchOne(requestedUid, { uid: true, envelope: true, source: true, headers: SORT_HEADERS }, { uid: true });
      const parsed = await simpleParser(full.source, { skipHtmlToText: false, skipTextToHtml: true });
      const summary = String(parsed.text || parsed.html || "").replace(/\s+/g, " ").trim().slice(0, 4000);
      const publicMessage = envelopeToMessage(full, preferences);
      return res.status(200).json({ message: { ...publicMessage, summary, enrichment: inferLeadDetails({ subject: publicMessage.subject, body: summary }), messageId: parsed.messageId || full.envelope?.messageId || null } });
    }

    const allUids = await client.search({ all: true }, { uid: true });
    const uids = allUids.slice(-50);
    if (!uids.length) return res.status(200).json({ messages: [] });
    const rows = await client.fetchAll(uids, { uid: true, envelope: true, flags: true, headers: SORT_HEADERS }, { uid: true });
    return res.status(200).json({ messages: sortMessages(rows.map((row) => envelopeToMessage(row, preferences))) });
  } catch (error) {
    console.error("Mailbox connection failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke koble til innboksen." });
  } finally {
    try { await client.logout(); } catch {}
  }
};
