function clean(value, max = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function labeledValue(text, labels) {
  const nextLabel = "(?:fullt\\s*navn|navn|name|e-?post|email|telefon|tlf|mobil|phone|artist(?:navn)?|artist\\s*name|band(?:navn)?|prosjekt(?:navn)?|rolle|selskap|management|label|sted|by|location|nettside|website|instagram|spotify|melding|beskjed|message)";
  const pattern = new RegExp(`(?:${labels.join("|")})\\s*[:–-]\\s*(.{2,140}?)(?=\\s${nextLabel}\\s*[:–-]|$)`, "i");
  return clean(text.match(pattern)?.[1], 120);
}

function formMessage(text) {
  const value = text.match(/\b(?:message|melding|beskjed)\s*:\s*(.{2,2000}?)(?=\s+(?:submitted\b|innsendt\b|you are receiving this\b)|$)/i)?.[1];
  return clean(value, 600);
}

function labeledEmail(text) {
  const value = labeledValue(text, ["e-?post", "email"]);
  return clean(value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0], 254).toLowerCase();
}

function normalizePhone(value) {
  const raw = clean(value, 40);
  if (!raw) return "";
  const leadingPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return `${leadingPlus ? "+" : ""}${digits}`;
}

function inferRole(text) {
  const artist = /\b(?:artist|vokalist|sanger|singer|rapper|låtskriver|songwriter|synger)\b/i.test(text);
  const producer = /\b(?:produsent|producer|produksjon)\b/i.test(text);
  if (artist && producer) return "Artist og produsent";
  if (producer) return "Produsent";
  if (/\b(?:manager|management|plateselskap|record label|label)\b/i.test(text)) return "Management / label";
  if (/\b(?:band|duo|gruppe)\b/i.test(text)) return "Band";
  if (artist) return "Artist";
  return "";
}

function inferLeadDetails({ subject = "", body = "" } = {}) {
  const text = clean(`${subject} ${body}`, 5000);
  const labeledPhone = labeledValue(text, ["telefon", "tlf\\.?", "mobil", "phone"]);
  const fallbackPhone = text.match(/(?:\+47[ .-]?)?(?:\d[ .-]?){8}\b/)?.[0] || "";
  const urls = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  const socialUrl = urls.find((url) => /instagram\.com|spotify\.com|soundcloud\.com|tiktok\.com|facebook\.com|youtube\.com/i.test(url)) || "";
  const website = urls.find((url) => url !== socialUrl && !/formspree\.io/i.test(url)) || "";
  const name = labeledValue(text, ["fullt\\s*navn", "navn", "name"]);

  return {
    name: name && !name.includes("@") ? name : "",
    email: labeledEmail(text),
    phone: normalizePhone(labeledPhone || fallbackPhone),
    role: inferRole(text),
    artistName: labeledValue(text, ["artistnavn", "artist name", "bandnavn", "prosjektnavn"]),
    company: labeledValue(text, ["selskap", "management", "plateselskap", "label"]),
    location: labeledValue(text, ["sted", "by", "location"]),
    website: clean(website.replace(/[),.;]+$/, ""), 300),
    social: clean(socialUrl.replace(/[),.;]+$/, ""), 300),
    project: formMessage(text),
  };
}

module.exports = { formMessage, inferLeadDetails, inferRole, labeledEmail, labeledValue, normalizePhone };
