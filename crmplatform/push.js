(() => {
  const button = document.getElementById("push-toggle");
  const label = document.getElementById("push-label");
  if (!button || !label) return;

  let registration = null;
  let server = null;

  const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Varsler kunne ikke oppdateres.");
    return data;
  };

  function supported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function iosNeedsInstall() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    return ios && !standalone;
  }

  function decodeKey(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  }

  function deviceName() {
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return "iPhone / iPad";
    if (/Android/.test(navigator.userAgent)) return "Android";
    return "Nettleser";
  }

  function render(state = {}) {
    const active = Boolean(state.active);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    label.textContent = active ? "Varsler på" : "Varsler";
    button.title = state.message || (active ? "Pushvarsler er aktivert på denne enheten" : "Aktiver pushvarsler på denne enheten");
    button.disabled = Boolean(state.disabled);
  }

  async function localSubscription() {
    registration ||= await navigator.serviceWorker.register("/crm-sw.js", { scope: "/crmplatform/" });
    return registration.pushManager.getSubscription();
  }

  async function refresh() {
    if (!supported()) {
      render({ disabled: true, message: "Denne nettleseren støtter ikke pushvarsler." });
      return;
    }
    try {
      server = await api("/api/studio?action=push");
      if (!server.configured) {
        render({ disabled: true, message: "Pushvarsler er ikke ferdig konfigurert på serveren." });
        return;
      }
      if (iosNeedsInstall()) {
        render({ message: "På iPhone: legg CRM-en på Hjem-skjermen først, åpne den derfra og trykk Varsler." });
        return;
      }
      const subscription = await localSubscription();
      render({ active: Boolean(subscription) && Notification.permission === "granted" });
    } catch (error) {
      render({ message: error.message || "Varselstatus er utilgjengelig." });
    }
  }

  async function enable() {
    if (iosNeedsInstall()) {
      alert("På iPhone må du først velge Del → Legg til på Hjem-skjermen. Åpne deretter Loki CRM fra Hjem-skjermen og trykk «Varsler» igjen.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Varsler ble ikke tillatt i nettleseren.");
    const current = await localSubscription();
    const subscription = current || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeKey(server.publicKey),
    });
    await api("/api/studio?action=push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: { ...subscription.toJSON(), device: deviceName() } }),
    });
    render({ active: true });
  }

  async function disable() {
    const subscription = await localSubscription();
    if (subscription) {
      await api("/api/studio?action=push", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
    render({ active: false });
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const active = supported() && Notification.permission === "granted" && await localSubscription();
      if (active) await disable(); else await enable();
    } catch (error) {
      alert(error.message || "Varsler kunne ikke oppdateres.");
    } finally {
      button.disabled = false;
    }
  });

  window.addEventListener("loki-authenticated", refresh, { once: true });
  if (!document.getElementById("auth-gate") || document.getElementById("auth-gate").classList.contains("hidden")) refresh();
  window.LokiPush = { refresh };
})();
