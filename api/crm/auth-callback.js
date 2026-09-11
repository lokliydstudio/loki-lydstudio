const { sessionCookie, verifyToken } = require("../../lib/crm-auth");

module.exports = async function handler(req, res) {
  const data = verifyToken(req.query?.token, "login");
  if (!data) return res.status(401).send("Innloggingslenken er ugyldig eller utløpt.");
  res.setHeader("Set-Cookie", sessionCookie(data.email));
  return res.redirect(302, "/crmplatform/");
};
