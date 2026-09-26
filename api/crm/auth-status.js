const { clearSessionCookie, currentUser, sessionCookie } = require("../../lib/crm-auth");

module.exports = async function handler(req, res) {
  if (req.method === "POST") {
    res.setHeader("Set-Cookie", clearSessionCookie());
    return res.status(200).json({ ok: true });
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const user = currentUser(req);
  if (!user) return res.status(401).json({ authenticated: false });
  res.setHeader("Set-Cookie", sessionCookie(user.email));
  return res.status(200).json({ authenticated: true, user });
};
