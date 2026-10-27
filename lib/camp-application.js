const crypto = require("node:crypto");

const ROLES = new Set(["Artist", "Låtskriver", "Produsent", "Topliner"]);
const DIETARY = new Set(["Oppgis senere", "Ingen", "Vegetar", "Vegan", "Kosher", "Glutenfri", "Pescetarian", "Annet"]);

function clean(value, max = 200) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanMultiline(value, max = 4000) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function validEmail(value) {
  const email = clean(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeApplication(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Invalid application." };
  const name = clean(input.name, 160);
  const address = clean(input.address, 300);
  const phone = clean(input.phone, 50);
  const email = validEmail(input.email);
  const management = clean(input.management, 200);
  const roles = [...new Set(Array.isArray(input.roles) ? input.roles.filter((role) => ROLES.has(role)) : [])];
  const bio = cleanMultiline(input.bio, 4000);
  const songs = cleanMultiline(input.songs, 2500);
  const splits = clean(input.splits, 20);
  const dietary = clean(input.dietary, 20);
  const dietaryOther = clean(input.dietaryOther, 160);
  const wordCount = bio.split(/\s+/).filter(Boolean).length;

  if (name.length < 2 || !address || !phone || !email || roles.length === 0 || !bio) {
    return { error: "Please provide your name, address, phone number, email, role and short biography." };
  }
  if (wordCount > 500) return { error: "Your biography must be 500 words or fewer." };
  if (!/^[+0-9 ()-]{6,50}$/.test(phone)) return { error: "Enter a valid phone number with country code." };
  if (!new Set(["agree", "disagree"]).has(splits)) return { error: "Choose whether you agree to the songwriting splits." };
  if (!DIETARY.has(dietary) || (dietary === "Annet" && !dietaryOther)) return { error: "Choose a dietary option and describe it if you select Other." };
  if (!["Ingen", "Oppgis senere"].includes(dietary) && input.dietaryConsent !== true) return { error: "Consent to the use of dietary information or choose 'I'll share this later'." };
  if (input.feeAccepted !== true || input.privacyAccepted !== true) return { error: "Confirm the participation fee and privacy notice before submitting." };

  return {
    application: {
      id: `camp-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      name, address, phone, email, management, roles, bio, songs, splits,
      dietary, dietaryOther: dietary === "Annet" ? dietaryOther : "",
      dietaryConsent: input.dietaryConsent === true,
      feeNok: 1300,
    },
  };
}

function notificationText(application) {
  return [
    "Ny søknad til Loki Songs låtskrivercamp",
    `Søknads-ID: ${application.id}`,
    `Mottatt: ${application.createdAt}`,
    "",
    `Navn: ${application.name}`,
    `Adresse: ${application.address}`,
    `Telefon: ${application.phone}`,
    `E-post: ${application.email}`,
    `Management/label/publishing/booking: ${application.management || "Ikke oppgitt"}`,
    `Roller: ${application.roles.join(", ")}`,
    `Splits: ${application.splits === "agree" ? "Godtar lik fordeling" : "Godtar ikke lik fordeling"}`,
    `Matbehov: ${application.dietary === "Annet" ? application.dietaryOther : application.dietary}`,
    "Avgift: Bekreftet 1 300 kr ved akseptert invitasjon, uten refusjon.",
    "",
    "Musikkbiografi:",
    application.bio,
    "",
    "Låteksempler og rolle:",
    application.songs || "Ikke oppgitt",
  ].join("\n");
}

module.exports = { normalizeApplication, notificationText };
