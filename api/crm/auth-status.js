const { currentUser } = require("../../lib/crm-auth");

module.exports = async function handler(req, res) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ authenticated: false });
  return res.status(200).json({ authenticated: true, user });
};
