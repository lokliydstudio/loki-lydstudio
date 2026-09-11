const { simpleParser } = require("mailparser");
const { requireUser } = require("../../lib/crm-auth");
const { createImapClient } = require("../../lib/crm-mail");

function envelopeToMessage(message) {
  const from = message.envelope?.from?.[0] || {};
  return {
    id: message.uid,
    uid: message.uid,
    name: from.name || from.address || "Ukjent avsender",
    email: from.address || "",
    subject: message.envelope?.subject || "Uten emne",
    received: message.envelope?.date || null,
    messageId: message.envelope?.messageId || null,
    summary: "Åpne meldingen for å lese innholdet.",
    state: "Trenger svar",
    live: true,
  };
}

module.exports = async function handler(req, res) {
  if (!requireUser(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const client = createImapClient();
  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
    const requestedUid = Number.parseInt(req.query?.uid, 10);
    if (Number.isFinite(requestedUid) && requestedUid > 0) {
      const metadata = await client.fetchOne(requestedUid, { uid: true, envelope: true, size: true }, { uid: true });
      if (!metadata) return res.status(404).json({ error: "Meldingen ble ikke funnet." });
      if (metadata.size > 2_000_000) return res.status(413).json({ ...envelopeToMessage(metadata), error: "Meldingen er for stor til å forhåndsvise." });
      const full = await client.fetchOne(requestedUid, { uid: true, envelope: true, source: true }, { uid: true });
      const parsed = await simpleParser(full.source, { skipHtmlToText: false, skipTextToHtml: true });
      return res.status(200).json({ message: { ...envelopeToMessage(full), summary: String(parsed.text || parsed.html || "").replace(/\s+/g, " ").trim().slice(0, 4000), messageId: parsed.messageId || full.envelope?.messageId || null } });
    }

    const allUids = await client.search({ all: true }, { uid: true });
    const uids = allUids.slice(-20);
    if (!uids.length) return res.status(200).json({ messages: [] });
    const rows = await client.fetchAll(uids, { uid: true, envelope: true, flags: true }, { uid: true });
    return res.status(200).json({ messages: rows.reverse().map(envelopeToMessage) });
  } catch (error) {
    console.error("Mailbox connection failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke koble til innboksen." });
  } finally {
    try { await client.logout(); } catch {}
  }
};
