const {
  allowedUsers,
  clearLoginChallengeCookie,
  createLoginChallenge,
  createToken,
  loginChallengeCookie,
} = require("../../lib/crm-auth");
const { sendMail } = require("../../lib/crm-mail");

const attempts = new Map();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0];
  const lastAttempt = attempts.get(ip) || 0;
  if (Date.now() - lastAttempt < 60000) return res.status(429).json({ error: "Vent ett minutt før du prøver igjen." });
  attempts.set(ip, Date.now());

  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!allowedUsers().has(email)) {
    res.setHeader("Set-Cookie", clearLoginChallengeCookie());
    return res.status(200).json({ ok: true });
  }

  const token = createToken(email, "login", 15 * 60);
  const challenge = createLoginChallenge(email, 15 * 60);
  const baseUrl = String(process.env.CRM_BASE_URL || "https://www.lokilyd.no").replace(/\/$/, "");
  const link = `${baseUrl}/api/crm/auth-callback?token=${encodeURIComponent(token)}`;
  try {
    await sendMail({
      from: `Loki Studio <${process.env.MAIL_ADDRESS}>`,
      replyTo: process.env.MAIL_ADDRESS,
      to: email,
      subject: "Din innloggingskode til Loki Studio",
      text: `Din engangskode til Loki Studio er ${challenge.code}.\n\nSkriv koden på innloggingssiden, eller bruk denne lenken:\n${link}\n\nKoden og lenken er gyldige i 15 minutter. Hvis du ikke ba om innloggingen, kan du ignorere meldingen.`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#191918"><p>Din engangskode til Loki Studio er:</p><p style="margin:22px 0;font-size:32px;font-weight:800;letter-spacing:.22em">${challenge.code.slice(0, 3)} ${challenge.code.slice(3)}</p><p>Skriv koden på innloggingssiden, eller bruk knappen under.</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#d9ff53;color:#171716;font-weight:700;text-decoration:none">Logg inn med lenke</a></p><p style="color:#777;font-size:12px">Koden og lenken er gyldige i 15 minutter. Hvis du ikke ba om innloggingen, kan du ignorere meldingen.</p></div>`,
    });
    res.setHeader("Set-Cookie", loginChallengeCookie(challenge.token));
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Login email failed", error?.message);
    res.setHeader("Set-Cookie", clearLoginChallengeCookie());
    return res.status(503).json({ error: "Kunne ikke sende innloggingskoden." });
  }
};
