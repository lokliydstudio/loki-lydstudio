const crypto = require("crypto");
const webPush = require("web-push");
const { allowedUsers } = require("./crm-auth");
const { isConfigured: isStoreConfigured, readCollection, writeCollection } = require("./crm-store");

const COLLECTION = "push-subscriptions";
const MAX_SUBSCRIPTIONS = 20;
let cachedVapidKeys = null;

function cleanText(value, max = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function actorName(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (normalized === "leon@lokilyd.no") return "Leon";
  if (normalized === "charles@lokilyd.no") return "Charles";
  return "En bruker";
}

function vapidKeys() {
  if (cachedVapidKeys) return cachedVapidKeys;
  if (process.env.PUSH_VAPID_PUBLIC_KEY && process.env.PUSH_VAPID_PRIVATE_KEY) {
    cachedVapidKeys = {
      publicKey: cleanText(process.env.PUSH_VAPID_PUBLIC_KEY, 200),
      privateKey: cleanText(process.env.PUSH_VAPID_PRIVATE_KEY, 200),
    };
    return cachedVapidKeys;
  }
  const secret = String(process.env.CRM_AUTH_SECRET || "");
  if (secret.length < 32) return null;
  for (let counter = 0; counter < 8; counter += 1) {
    try {
      const privateKey = crypto.createHmac("sha256", secret).update(`loki-crm-vapid-v1:${counter}`).digest();
      const ecdh = crypto.createECDH("prime256v1");
      ecdh.setPrivateKey(privateKey);
      cachedVapidKeys = {
        publicKey: ecdh.getPublicKey(null, "uncompressed").toString("base64url"),
        privateKey: ecdh.getPrivateKey().toString("base64url"),
      };
      return cachedVapidKeys;
    } catch {
      // A derived scalar outside the P-256 range is extraordinarily rare; try the next domain-separated value.
    }
  }
  return null;
}

function pushConfigured() {
  return Boolean(vapidKeys() && isStoreConfigured());
}

function publicKey() {
  return vapidKeys()?.publicKey || "";
}

function validEndpoint(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.href.length <= 2000 ? url.href : "";
  } catch {
    return "";
  }
}

function validKey(value, max) {
  const key = cleanText(value, max);
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : "";
}

function subscriptionId(endpoint) {
  return crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
}

function sanitizeSubscription(input, userEmail, existing = {}) {
  const endpoint = validEndpoint(input?.endpoint);
  const p256dh = validKey(input?.keys?.p256dh, 300);
  const auth = validKey(input?.keys?.auth, 100);
  const email = String(userEmail || "").trim().toLowerCase();
  if (!endpoint || !p256dh || !auth || !allowedUsers().has(email)) return null;
  return {
    id: subscriptionId(endpoint),
    userEmail: email,
    endpoint,
    keys: { p256dh, auth },
    device: cleanText(input?.device || existing.device || "Nettleser", 120),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function publicSubscriptionStatus(items, userEmail) {
  const email = String(userEmail || "").trim().toLowerCase();
  const devices = (items || [])
    .filter((item) => item.userEmail === email)
    .map((item) => ({ id: item.id, device: item.device, updatedAt: item.updatedAt }));
  return { subscribed: devices.length > 0, deviceCount: devices.length, devices };
}

function notificationPayload(input = {}) {
  const url = cleanText(input.url || "/crmplatform/", 500);
  return {
    title: cleanText(input.title || "Loki Studio", 120),
    body: cleanText(input.body, 300),
    tag: cleanText(input.tag || "loki-crm", 120),
    url: url.startsWith("/crmplatform/") ? url : "/crmplatform/",
    icon: "/assets/brand/loki-icon-192.png",
    badge: "/assets/brand/loki-icon-192.png",
  };
}

async function sendPush(actorEmail, input, options = {}) {
  if (!pushConfigured()) return { sent: 0, removed: 0 };
  try {
    const all = await readCollection(COLLECTION);
    const recipients = all.filter((item) => !options.excludeActor || item.userEmail !== actorEmail);
    if (!recipients.length) return { sent: 0, removed: 0 };
    const payload = JSON.stringify(notificationPayload(input));
    const keys = vapidKeys();
    if (!keys) return { sent: 0, removed: 0 };
    const vapidDetails = {
      subject: "mailto:post@lokilyd.no",
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
    };
    const results = await Promise.allSettled(recipients.map(async (item) => {
      try {
        await webPush.sendNotification({ endpoint: item.endpoint, keys: item.keys }, payload, {
          TTL: 60 * 60,
          urgency: "normal",
          timeout: 5000,
          vapidDetails,
        });
        return { id: item.id, sent: true };
      } catch (error) {
        return { id: item.id, sent: false, expired: error?.statusCode === 404 || error?.statusCode === 410 };
      }
    }));
    const values = results.map((result) => result.status === "fulfilled" ? result.value : null).filter(Boolean);
    const expired = new Set(values.filter((value) => value.expired).map((value) => value.id));
    if (expired.size) await writeCollection(COLLECTION, all.filter((item) => !expired.has(item.id)));
    return { sent: values.filter((value) => value.sent).length, removed: expired.size };
  } catch (error) {
    console.error("CRM push notification failed", error?.message);
    return { sent: 0, removed: 0 };
  }
}

function taskNotification(previous, task, actorEmail) {
  const actor = actorName(actorEmail);
  if (!previous) {
    return notificationPayload({
      title: "Ny oppgave i Loki CRM",
      body: `${actor} la til «${task.title}». Ansvarlig: ${task.assignee}.`,
      tag: `task-${task.id}`,
      url: "/crmplatform/#workspace-tools",
    });
  }
  if (Boolean(previous.completed) !== Boolean(task.completed)) {
    return notificationPayload({
      title: task.completed ? "Oppgave fullført" : "Oppgave åpnet igjen",
      body: `${actor} ${task.completed ? "fullførte" : "åpnet"} «${task.title}»${task.completed ? "" : " igjen"}.`,
      tag: `task-${task.id}`,
      url: "/crmplatform/#workspace-tools",
    });
  }
  return null;
}

module.exports = {
  COLLECTION,
  MAX_SUBSCRIPTIONS,
  actorName,
  notificationPayload,
  publicKey,
  publicSubscriptionStatus,
  pushConfigured,
  sanitizeSubscription,
  sendPush,
  subscriptionId,
  taskNotification,
};
