const crypto = require("crypto");

const IRRELEVANT_DOMAINS = new Set([
  "adobe.com",
  "altinn.no",
  "apple.com",
  "jottacloud.com",
  "dropbox.com",
  "box.com",
  "dnb.no",
  "fiken.no",
  "bankid.no",
  "digipost.no",
  "domeneshop.no",
  "google.com",
  "github.com",
  "klarna.com",
  "mailchimp.com",
  "microsoft.com",
  "microsoftonline.com",
  "nets.eu",
  "nordea.no",
  "notion.so",
  "openai.com",
  "paypal.com",
  "poweroffice.no",
  "sbanken.no",
  "skatteetaten.no",
  "slack.com",
  "sparebank1.no",
  "vercel.com",
  "vipps.no",
  "stripe.com",
  "resend.com",
  "tripletex.no",
  "xero.com",
  "zoom.us",
]);

const ADMINISTRATIVE_PHRASES = [
  "abonnement",
  "account statement",
  "automatisk svar",
  "betaling mottatt",
  "betalingspåminnelse",
  "billing notice",
  "bekreft innlogging",
  "bekreft e-post",
  "driftsmelding",
  "faktura",
  "invoice",
  "jottacloud",
  "dnb",
  "bankid",
  "kontoutskrift",
  "kvittering",
  "monthly report",
  "newsletter",
  "nyhetsbrev",
  "passord",
  "password reset",
  "payment receipt",
  "personvernerklæring",
  "security alert",
  "sikkerhetsvarsel",
  "storage notification",
  "subscription",
  "transaksjon",
  "two-factor",
  "usage notification",
  "verification code",
];

const AUTOMATED_LOCAL_PART = /^(?:auto(?:mated)?|billing|do-?not-?reply|faktura|invoice|mailer-daemon|news(?:letter)?|no-?reply|notifications?|notify|security|system|varsling)(?:[._+-].*)?$/;

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function addressDomain(value) {
  return cleanEmail(value).split("@")[1] || "";
}

function domainIsService(domain) {
  return [...IRRELEVANT_DOMAINS].some((known) => domain === known || domain.endsWith(`.${known}`));
}

function headerText(message = {}) {
  return Buffer.isBuffer(message.headers) ? message.headers.toString("utf8") : String(message.headers || "");
}

function automationHeaderReason(message = {}) {
  const headers = headerText(message).replace(/\r?\n[ \t]+/g, " ").toLowerCase();
  if (/^list-(?:id|unsubscribe):/m.test(headers)) return "Nyhetsbrev eller e-postliste";
  if (/^precedence:\s*(?:bulk|junk|list)/m.test(headers)) return "Automatisk masseutsendelse";
  if (/^auto-submitted:\s*(?!no\b)/m.test(headers)) return "Automatisk systemmelding";
  if (/^x-auto-response-suppress:/m.test(headers)) return "Automatisk systemmelding";
  return "";
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

function isUnread(message = {}) {
  const flags = message.flags instanceof Set ? [...message.flags] : Array.isArray(message.flags) ? message.flags : [];
  return !flags.some((flag) => String(flag).toLowerCase() === "\\seen");
}

function irrelevantReason(message = {}, contact = {}) {
  const envelope = message.envelope || {};
  const domain = addressDomain(contact.address);
  const local = cleanEmail(contact.address).split("@")[0] || "";
  const haystack = `${contact.name || ""} ${envelope.subject || ""} ${contact.address || ""}`.toLowerCase();
  const headerReason = automationHeaderReason(message);
  if (headerReason) return headerReason;
  if (domainIsService(domain)) return "Administrativ tjeneste eller leverandør";
  if (AUTOMATED_LOCAL_PART.test(local)) return "Automatisk avsender";
  if (ADMINISTRATIVE_PHRASES.some((phrase) => haystack.includes(phrase))) return "Administrativt varsel";
  return "";
}

function classifyEnvelope(message = {}, override = null) {
  const envelope = message.envelope || {};
  const formspree = isFormspreeEnvelope(envelope);
  const contact = chooseContact(envelope, formspree);
  const automaticReason = formspree ? "" : irrelevantReason(message, contact);
  const automaticIrrelevant = Boolean(automaticReason);
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
    source: formspree ? "Formspree" : category === "irrelevant" ? "Automatisk filtrert" : "E-post",
    filterReason: category === "irrelevant" ? (override === "irrelevant" ? "Markert som ikke relevant" : automaticReason) : "",
    isLead: category === "formspree" || category === "customer",
    priority: category === "formspree" ? 100 : category === "customer" ? 50 : 0,
    state: category === "formspree" ? "Nytt Formspree-lead" : category === "irrelevant" ? "Ikke relevant" : "Trenger svar",
    unread: isUnread(message),
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

module.exports = { automationHeaderReason, classifyEnvelope, cleanEmail, irrelevantReason, isFormspreeEnvelope, isUnread, messageKey, sortMessages };
