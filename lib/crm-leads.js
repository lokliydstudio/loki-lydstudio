const SOURCE_PRIORITY = {
  formspree: 100,
  nettside: 90,
  "e-post": 50,
  email: 50,
  henvisning: 40,
  manuelt: 30,
};

const STAGE_PRIORITY = {
  "Nytt lead": 30,
  Kontaktet: 20,
  "Tilbud sendt": 10,
  Booket: 0,
  Tapt: -10,
};

function leadPriority(lead = {}) {
  const category = String(lead.category || "").toLowerCase();
  const source = String(lead.source || "").trim().toLowerCase();
  if (category === "formspree") return 100;
  return SOURCE_PRIORITY[source] ?? 30;
}

function isOpenLead(lead = {}) {
  return !new Set(["Booket", "Tapt"]).has(lead.stage);
}

function leadTimestamp(lead = {}) {
  const value = new Date(lead.receivedAt || lead.lastSeenAt || lead.firstSeenAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function sortLeads(leads) {
  return [...leads].sort((left, right) => {
    if (isOpenLead(left) !== isOpenLead(right)) return isOpenLead(left) ? -1 : 1;
    const sourceDifference = leadPriority(right) - leadPriority(left);
    if (sourceDifference) return sourceDifference;
    const stageDifference = (STAGE_PRIORITY[right.stage] || 0) - (STAGE_PRIORITY[left.stage] || 0);
    if (stageDifference) return stageDifference;
    return leadTimestamp(right) - leadTimestamp(left);
  });
}

function mailPreferenceForLead(lead, preferences) {
  const keyed = lead.messageKey && preferences.find((preference) => preference.key === lead.messageKey);
  if (keyed) return keyed.category;
  const email = String(lead.email || "").toLowerCase();
  return preferences.find((preference) => preference.sender && String(preference.sender).toLowerCase() === email)?.category || null;
}

function suppressedByMailPreference(lead, preferences) {
  return mailPreferenceForLead(lead, preferences) === "irrelevant";
}

module.exports = { isOpenLead, leadPriority, mailPreferenceForLead, sortLeads, suppressedByMailPreference };
