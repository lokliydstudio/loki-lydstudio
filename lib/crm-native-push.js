const crypto = require("crypto");
const http2 = require("http2");
const { allowedUsers } = require("./crm-auth");
const { isConfigured: storeConfigured, readCollection, writeCollection } = require("./crm-store");

const COLLECTION = "ios-push-devices";
const MAX_DEVICES = 20;

function nativePushConfigured() {
  return Boolean(
    storeConfigured()
    && process.env.APNS_TEAM_ID
    && process.env.APNS_KEY_ID
    && process.env.APNS_PRIVATE_KEY
    && process.env.APNS_BUNDLE_ID,
  );
}

function deviceId(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex").slice(0, 32);
}

function sanitizeNativeDevice(input, userEmail, existing = {}) {
  const token = String(input?.token || "").trim().toLowerCase();
  const email = String(userEmail || "").trim().toLowerCase();
  const environment = String(input?.environment || "");
  // APNs tokens are opaque and variable-length. Bound input size without assuming 32 bytes.
  if (!/^[a-f0-9]{32,512}$/.test(token) || token.length % 2 || !allowedUsers().has(email) || !["sandbox", "production"].includes(environment)) return null;
  return {
    id: deviceId(token),
    token,
    userEmail: email,
    environment,
    device: String(input?.device || existing.device || "iPhone").replace(/\s+/g, " ").trim().slice(0, 80),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function apnsBearerToken(now = Date.now()) {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(now / 1000) })).toString("base64url");
  const unsigned = `${header}.${claims}`;
  const privateKey = crypto.createPrivateKey(String(process.env.APNS_PRIVATE_KEY).replace(/\\n/g, "\n"));
  const signature = crypto.sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${unsigned}.${signature}`;
}

function sendOne(device, notification, bearer) {
  const host = device.environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  return new Promise((resolve) => {
    const client = http2.connect(host);
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      client.close();
      resolve(result);
    };
    client.on("error", (error) => finish({ sent: false, reason: error.message }));
    client.setTimeout(6000, () => finish({ sent: false, reason: "timeout" }));
    const stream = client.request({
      ":method": "POST",
      ":path": `/3/device/${device.token}`,
      authorization: `bearer ${bearer}`,
      "apns-topic": process.env.APNS_BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let response = "";
    stream.setTimeout(6000, () => { stream.close(); finish({ sent: false, reason: "timeout" }); });
    stream.on("response", (headers) => { status = Number(headers[":status"] || 0); });
    stream.on("data", (chunk) => { response += chunk.toString().slice(0, 1000); });
    stream.on("error", (error) => finish({ sent: false, reason: error.message }));
    stream.on("end", () => {
      let reason = "";
      try { reason = JSON.parse(response).reason || ""; } catch { /* A successful APNs response has no body. */ }
      finish({ sent: status === 200, expired: status === 410 || ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"].includes(reason), reason });
    });
    stream.end(JSON.stringify({
      aps: { alert: { title: notification.title, body: notification.body }, sound: "default", "content-available": 1 },
      url: notification.url,
    }));
  });
}

async function sendNativePush(actorEmail, notification, options = {}) {
  if (!nativePushConfigured()) return { sent: 0, removed: 0 };
  try {
    const devices = await readCollection(COLLECTION);
    const recipients = devices.filter((item) => !options.excludeActor || item.userEmail !== actorEmail);
    if (!recipients.length) return { sent: 0, removed: 0 };
    const bearer = apnsBearerToken();
    const results = await Promise.all(recipients.map((item) => sendOne(item, notification, bearer)));
    const expired = new Set(results.flatMap((result, index) => result.expired ? [recipients[index].id] : []));
    if (expired.size) await writeCollection(COLLECTION, devices.filter((item) => !expired.has(item.id)));
    return { sent: results.filter((item) => item.sent).length, removed: expired.size };
  } catch (error) {
    console.error("Native CRM push failed", error?.message);
    return { sent: 0, removed: 0 };
  }
}

module.exports = { COLLECTION, MAX_DEVICES, apnsBearerToken, deviceId, nativePushConfigured, sanitizeNativeDevice, sendNativePush };
