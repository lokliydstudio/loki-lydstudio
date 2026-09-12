const crypto = require("crypto");

const PROJECT_STATUSES = new Set(["Planlegges", "Booket", "Innspilling", "Miks", "Mastering", "Levert", "På vent"]);

function cleanText(value, max = 250) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function emptyPatch() {
  return Array.from({ length: 32 }, (_, index) => ({
    channel: index + 1,
    source: "",
    connection: "",
    microphone: "",
    preamp: "",
    destination: `Input ${index + 1}`,
    phantom: false,
    notes: "",
  }));
}

function sanitizePatch(input) {
  const byChannel = new Map(
    (Array.isArray(input) ? input : [])
      .map((row) => [Math.trunc(Number(row?.channel)), row])
      .filter(([channel]) => channel >= 1 && channel <= 32),
  );

  return emptyPatch().map((fallback) => {
    const row = byChannel.get(fallback.channel) || {};
    return {
      channel: fallback.channel,
      source: cleanText(row.source, 100),
      connection: cleanText(row.connection, 100),
      microphone: cleanText(row.microphone, 100),
      preamp: cleanText(row.preamp, 100),
      destination: cleanText(row.destination || fallback.destination, 100),
      phantom: row.phantom === true,
      notes: cleanText(row.notes, 240),
    };
  });
}

function sanitizeProject(input, existing = {}) {
  const requestedStatus = cleanText(input?.status ?? existing.status ?? "Planlegges", 40);
  const now = new Date().toISOString();
  const hasPatch = Array.isArray(input?.patch);

  return {
    id: cleanText(existing.id || input?.id, 120) || `project-${crypto.randomUUID()}`,
    name: cleanText(input?.name ?? existing.name, 150) || "Nytt studioprosjekt",
    clientName: cleanText(input?.clientName ?? existing.clientName, 150),
    clientEmail: cleanEmail(input?.clientEmail ?? existing.clientEmail),
    status: PROJECT_STATUSES.has(requestedStatus) ? requestedStatus : "Planlegges",
    sessionDate: cleanText(input?.sessionDate ?? existing.sessionDate, 20),
    notes: cleanText(input?.notes ?? existing.notes, 1000),
    patch: sanitizePatch(hasPatch ? input.patch : existing.patch),
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

module.exports = { PROJECT_STATUSES, cleanText, emptyPatch, sanitizePatch, sanitizeProject };
