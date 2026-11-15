(() => {
  const STORAGE_KEY = "loki-crm-theme";
  const root = document.documentElement;
  const button = document.getElementById("theme-toggle");
  const icon = document.getElementById("theme-icon");
  const label = document.getElementById("theme-label");
  const themeColor = document.querySelector('meta[name="theme-color"]');

  function updateButton(theme) {
    const dark = theme === "dark";
    icon.innerHTML = dark
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/></svg>';
    label.textContent = dark ? "Light mode" : "Dark mode";
    button.setAttribute("aria-label", dark ? "Bytt til light mode" : "Bytt til dark mode");
    button.setAttribute("aria-pressed", String(dark));
    button.title = dark ? "Bytt til light mode" : "Bytt til dark mode";
  }

  function applyTheme(theme, persist = false) {
    const next = theme === "dark" ? "dark" : "light";
    root.dataset.theme = next;
    root.style.colorScheme = next;
    themeColor?.setAttribute("content", next === "dark" ? "#081322" : "#f4f7fb");
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    }
    updateButton(next);
  }

  button.addEventListener("click", () => applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true));
  applyTheme(root.dataset.theme || "light");
})();
