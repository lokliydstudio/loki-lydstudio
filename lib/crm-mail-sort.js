const crypto = require("crypto");

const IRRELEVANT_DOMAINS = new Set([
  "jottacloud.com",
  "dnb.no",
  "bankid.no",
  "digipost.no",
  "domeneshop.no",
  "github.com",
  "vercel.com",
  "stripe.com",
  "resend.com",
]);

const IRRELEVANT_WORDS = [
  "jottacloud",
  "dnb",
  "bankid",
  "kontoutskrift",
  "driftsmelding",
  "sikkerhetsvarsel",
  "storage notification",
  "usage notification",
];

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function addressDomain(value) {
  return cleanEmail(value).split("@")[1] || "";
}

function firstAddress(addresses) {
  const first = Array.isArray(addresses) ? addresses[0] : null;
  return { name: String(first?.name || "").trim(), address: cleanEmail(first?.address) };
}

function isFormspreeEnvelope(envelope = {}) {
  const haystack = [
    ...((envelope.from || []).map((entry) => `${entry?.name || ""} ${entry?.address || ""}`)),
    ...((envelope.sender || []).map((entry) => `${entry?.name || ""} ${entry?.address || ""}`)),
    envelope.subject || "",
  ].join(" ").toLowerCase();
  return haystack.includes("formspree");
}

function chooseContact(envelope = {}, formspree = isFormspreeEnvelope(envelope)) {
  const from = firstAddress(envelope.from);
  if (!formspree) return from;
  const replyTo = firstAddress(envelope.replyTo);
  if (replyTo.address && !replyTo.address.endsWith("@formspree.io") && !replyTo.address.endsWith("@lokilyd.no")) {
    return replyTo;
  }
  return from;
}

function messageKey(message = {}) {
  const stable = String(message.messageId || "").trim().toLowerCase()
    || `${message.uid || ""}|${message.email || ""}|${message.subject || ""}`.toLowerCase();
  return crypto.createHash("sha256").update(stable).digest("hex").slice(0, 32);
}

function looksAutomated(envelope = {}, contact = {}) {
  const domain = addressDomain(contact.address);
  const local = cleanEmail(contact.address).split("@")[0] || "";
  const haystack = `${contact.name || ""} ${envelope.subject || ""} ${contact.address || ""}`.toLowerCase();
  return IRRELEVANT_DOMAINS.has(domain)
    || /^(no-?reply|mailer-daemon|notifications?|varsling)$/.test(local)
    || IRRELEVANT_WORDS.some((word) => haystack.includes(word));
}

function classifyEnvelope(message = {}, override = null) {
  const envelope = message.envelope || {};
  const formspree = isFormspreeEnvelope(envelope);
  const contact = chooseContact(envelope, formspree);
  const automaticIrrelevant = !formspree && looksAutomated(envelope, contact);
  const category = override === "irrelevant" ? "irrelevant"
    : override === "inbox" ? (formspree ? "formspree" : "customer")
      : formspree ? "formspree"
        : automaticIrrelevant ? "irrelevant"
          : "customer";

  const base = {
    id: message.uid,
    uid: message.uid,
    name: contact.name || contact.address || "Ukjent avsender",
    email: contact.address,
    transportEmail: firstAddress(envelope.from).address,
    subject: envelope.subject || "Uten emne",
    received: envelope.date || null,
    messageId: envelope.messageId || null,
    summary: "Åpne meldingen for å lese innholdet.",
    category,
    source: formspree ? "Formspree" : automaticIrrelevant ? "Systemmelding" : "E-post",
    isLead: category === "formspree" || category === "customer",
    priority: category === "formspree" ? 100 : category === "customer" ? 50 : 0,
    state: category === "formspree" ? "Nytt Formspree-lead" : category === "irrelevant" ? "Ikke relevant" : "Trenger svar",
    live: true,
  };
  return { ...base, key: messageKey(base) };
}

function sortMessages(messages) {
  return [...messages].sort((left, right) => {
    if (left.category === "irrelevant" && right.category !== "irrelevant") return 1;
    if (right.category === "irrelevant" && left.category !== "irrelevant") return -1;
    if (right.priority !== left.priority) return right.priority - left.priority;
    return new Date(right.received || 0).getTime() - new Date(left.received || 0).getTime();
  });
}

module.exports = { classifyEnvelope, cleanEmail, isFormspreeEnvelope, messageKey, sortMessages };
