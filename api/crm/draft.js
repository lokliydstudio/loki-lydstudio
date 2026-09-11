const { requireUser } = require("../../lib/crm-auth");

module.exports = async function handler(req, res) {
  if (!requireUser(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (process.env.AI_DRAFTS_ENABLED !== "true") return res.status(503).json({ error: "AI-utkast er ikke aktivert ennå." });
  const senderName = String(req.body?.senderName || "kunde").slice(0, 120);
  const subject = String(req.body?.subject || "").slice(0, 250);
  const message = String(req.body?.message || "").slice(0, 8000);
  try {
    const { generateText } = await import("ai");
    const result = await generateText({
      model: process.env.AI_DRAFT_MODEL || "openai/gpt-5.4",
      system: "Du skriver korte, varme og profesjonelle e-postutkast på norsk for Loki Lydstudio i Bergen. Målet er å få seriøse leads til å booke en konkret samtale eller studiotid. Aldri finn på ledige tider, rabatter eller tjenester. Gjeldende priser: innspilling 550 kr/time, miks 550 kr/time, mastering 750 kr/låt, produksjon 650 kr/time. Avslutt med Hilsen Leon og Charles / Loki Lydstudio.",
      prompt: `Skriv et personlig svar til ${senderName}. Emne: ${subject}\n\nKundens melding:\n${message}`,
      maxOutputTokens: 450,
      temperature: 0.4,
    });
    return res.status(200).json({ draft: result.text });
  } catch (error) {
    console.error("AI draft failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke lage AI-utkast akkurat nå." });
  }
};
