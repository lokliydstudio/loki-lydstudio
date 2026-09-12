function clean(value, max = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function labeledValue(text, labels) {
  const nextLabel = "(?:e-?post|email|telefon|tlf|mobil|phone|artist(?:navn)?|band(?:navn)?|prosjekt(?:navn)?|rolle|selskap|management|label|sted|by|nettside|website|instagram|spotify|melding|beskjed)";
  const pattern = new RegExp(`(?:${labels.join("|")})\\s*[:–-]\\s*(.{2,140}?)(?=\\s${nextLabel}\\s*[:–-]|$)`, "i");
  return clean(text.match(pattern)?.[1], 120);
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
  const artist = /\b(?:artist|vokalist|sanger|singer|rapper|låtskriver|songwriter)\b/i.test(text);
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

  return {
    phone: normalizePhone(labeledPhone || fallbackPhone),
    role: inferRole(text),
    artistName: labeledValue(text, ["artistnavn", "artist name", "bandnavn", "prosjektnavn"]),
    company: labeledValue(text, ["selskap", "management", "plateselskap", "label"]),
    location: labeledValue(text, ["sted", "by", "location"]),
    website: clean(website.replace(/[),.;]+$/, ""), 300),
    social: clean(socialUrl.replace(/[),.;]+$/, ""), 300),
  };
}

module.exports = { inferLeadDetails, inferRole, labeledValue, normalizePhone };
