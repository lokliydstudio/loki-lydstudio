const { clearSessionCookie, currentUser, sessionCookie } = require("../../lib/crm-auth");
const { resolveCrmAccess } = require("../../lib/crm-access");
const { COLLECTION: NATIVE_PUSH_COLLECTION } = require("../../lib/crm-native-push");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");

module.exports = async function handler(req, res) {
  if (req.method === "POST") {
    const user = currentUser(req);
    if (user && isConfigured()) {
      try {
        const devices = await readCollection(NATIVE_PUSH_COLLECTION);
        await writeCollection(NATIVE_PUSH_COLLECTION, devices.filter((item) => item.userEmail !== user.email));
      } catch (error) { console.error("Could not revoke native push devices on logout", error?.message); }
    }
    res.setHeader("Set-Cookie", clearSessionCookie());
    return res.status(200).json({ ok: true });
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const user = currentUser(req);
  if (!user) return res.status(401).json({ authenticated: false });
  const access = await resolveCrmAccess(user.email);
  if (!access) {
    res.setHeader("Set-Cookie", clearSessionCookie());
    return res.status(403).json({ authenticated: false, error: "CRM-tilgangen er deaktivert." });
  }
  res.setHeader("Set-Cookie", sessionCookie(user.email));
  return res.status(200).json({ authenticated: true, user: access });
};
