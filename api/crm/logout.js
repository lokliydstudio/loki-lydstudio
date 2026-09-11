const { clearSessionCookie } = require("../../lib/crm-auth");

module.exports = async function handler(req, res) {
  res.setHeader("Set-Cookie", clearSessionCookie());
  return res.status(200).json({ ok: true });
};
