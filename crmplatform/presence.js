(() => {
  const INTERVAL_MS = 60_000;
  const FALLBACK_USERS = [
    { name: "Leon", initial: "L", online: false, lastLoginAt: "", isCurrent: false },
    { name: "Charles", initial: "C", online: false, lastLoginAt: "", isCurrent: false },
  ];
  let timer = null;
  let stopped = false;
  let lastUsers = FALLBACK_USERS;

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  function lastLoginLabel(value) {
    if (!value) return "Ingen innlogging registrert";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Ingen innlogging registrert";
    const today = new Date();
    const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    const time = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" }).format(date);
    if (sameDay) return `Sist pålogget i dag kl. ${time}`;
    const day = new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(date);
    return `Sist pålogget ${day} kl. ${time}`;
  }

  function render(users = FALLBACK_USERS, error = "") {
    const list = document.getElementById("presence-list");
    const count = document.getElementById("presence-count");
    if (!list || !count) return;
    const onlineCount = users.filter((user) => user.online).length;
    count.textContent = error ? "—" : String(onlineCount);
    count.title = error || `${onlineCount} pålogget`;
    list.innerHTML = users.map((user) => {
      const status = error ? "Status utilgjengelig" : user.online ? `Pålogget nå${user.isCurrent ? " · denne brukeren" : ""}` : lastLoginLabel(user.lastLoginAt);
      return `<li class="presence-user ${user.online ? "online" : "offline"}${user.isCurrent ? " current" : ""}"><span class="presence-avatar">${esc(user.initial)}</span><span><strong>${esc(user.name)}</strong><small>${esc(status)}</small></span><i aria-label="${user.online ? "Pålogget" : "Ikke pålogget"}"></i></li>`;
    }).join("");
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
      lastUsers = data.users?.length ? data.users : FALLBACK_USERS;
      render(lastUsers);
    } catch (error) {
      render(lastUsers, error.message || "Status utilgjengelig");
    }
  }

  function leave() {
    stopped = true;
    clearInterval(timer);
    return fetch("/api/studio?action=presence", { method: "DELETE", credentials: "same-origin", keepalive: true }).catch(() => {});
  }

  function init() {
    render(FALLBACK_USERS);
    refresh();
    timer = window.setInterval(refresh, INTERVAL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    document.getElementById("logout")?.addEventListener("click", () => { void leave(); }, { capture: true });
  }

  init();
  window.LokiPresence = { leave, refresh };
})();
