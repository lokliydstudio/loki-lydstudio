const { createToken, allowedUsers } = require("../../lib/crm-auth");
const { createSmtpClient } = require("../../lib/crm-mail");

const attempts = new Map();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0];
  const lastAttempt = attempts.get(ip) || 0;
  if (Date.now() - lastAttempt < 60000) return res.status(429).json({ error: "Vent ett minutt før du prøver igjen." });
  attempts.set(ip, Date.now());

  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!allowedUsers().has(email)) return res.status(200).json({ ok: true });

  const token = createToken(email, "login", 15 * 60);
  const baseUrl = String(process.env.CRM_BASE_URL || "https://www.lokilyd.no").replace(/\/$/, "");
  const link = `${baseUrl}/api/crm/auth-callback?token=${encodeURIComponent(token)}`;
  try {
    await createSmtpClient().sendMail({
      from: `Loki Studio <${process.env.MAIL_ADDRESS}>`,
      to: email,
      subject: "Logg inn i Loki Studio",
      text: `Bruk denne lenken for å logge inn i Loki Studio. Lenken er gyldig i 15 minutter:\n\n${link}\n\nHvis du ikke ba om lenken, kan du ignorere meldingen.`,
      html: `<p>Bruk knappen under for å logge inn i Loki Studio. Lenken er gyldig i 15 minutter.</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#d9ff53;color:#171716;font-weight:700;text-decoration:none">Logg inn i Loki Studio</a></p><p style="color:#777;font-size:12px">Hvis du ikke ba om lenken, kan du ignorere meldingen.</p>`,
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Login email failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke sende innloggingslenken." });
  }
};
