self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "Loki Studio";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "Det er en ny oppdatering i CRM-en.",
    icon: data.icon || "/assets/brand/loki-icon-192.png",
    badge: data.badge || "/assets/brand/loki-icon-192.png",
    tag: data.tag || "loki-crm",
    renotify: true,
    data: { url: data.url || "/crmplatform/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/crmplatform/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(`${self.location.origin}/crmplatform/`));
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return clients.openWindow(target);
  })());
});
