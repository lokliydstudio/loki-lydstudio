(() => {
  const INTERVAL_MS = 60_000;
  let timer = null;
  let stopped = false;

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  function render(users = [], error = "") {
    const list = document.getElementById("presence-list");
    const count = document.getElementById("presence-count");
    if (!list || !count) return;
    count.textContent = error ? "—" : String(users.length);
    if (error) {
      list.innerHTML = `<li class="presence-empty">${esc(error)}</li>`;
      return;
    }
    const otherUsers = users.filter((user) => !user.isCurrent);
    list.innerHTML = users.map((user) => `<li class="presence-user${user.isCurrent ? " current" : ""}"><span class="presence-avatar">${esc(user.initial)}</span><span><strong>${esc(user.name)}</strong><small>${user.isCurrent ? "Denne brukeren" : "Aktiv nå"}</small></span><i aria-label="Pålogget"></i></li>`).join("")
      + (otherUsers.length ? "" : '<li class="presence-empty">Ingen andre er aktive nå.</li>');
  }

  async function refresh() {
    if (stopped || document.hidden) return;
    try {
      const response = await fetch("/api/studio?action=presence", { method: "POST", credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        stopped = true;
        clearInterval(timer);
        return;
      }
      if (!response.ok) throw new Error(data.error || "Status utilgjengelig");
      render(data.users || []);
    } catch (error) {
      render([], error.message || "Status utilgjengelig");
    }
  }

  function leave() {
    stopped = true;
    clearInterval(timer);
    return fetch("/api/studio?action=presence", { method: "DELETE", credentials: "same-origin", keepalive: true }).catch(() => {});
  }

  function init() {
    refresh();
    timer = window.setInterval(refresh, INTERVAL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    document.getElementById("logout")?.addEventListener("click", () => { void leave(); }, { capture: true });
  }

  init();
  window.LokiPresence = { leave, refresh };
})();
