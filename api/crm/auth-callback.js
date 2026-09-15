const { sessionCookie, verifyToken } = require("../../lib/crm-auth");
const { presenceCollection, presenceLogin } = require("../../lib/crm-presence");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");

module.exports = async function handler(req, res) {
  const data = verifyToken(req.query?.token, "login");
  if (!data) return res.status(401).send("Innloggingslenken er ugyldig eller utløpt.");
  if (isConfigured()) {
    try {
      const collection = presenceCollection(data.email);
      if (collection) {
        const existing = (await readCollection(collection))[0] || {};
        await writeCollection(collection, [presenceLogin(data.email, existing)]);
      }
    } catch (error) {
      console.error("Could not record CRM login", error?.message);
    }
  }
  res.setHeader("Set-Cookie", sessionCookie(data.email));
  return res.redirect(302, "/crmplatform/");
};
