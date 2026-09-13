(() => {
  const STORAGE_KEY = "loki-crm-theme";
  const root = document.documentElement;
  const button = document.getElementById("theme-toggle");
  const icon = document.getElementById("theme-icon");
  const label = document.getElementById("theme-label");

  function updateButton(theme) {
    const dark = theme === "dark";
    icon.textContent = dark ? "☀" : "☾";
    label.textContent = dark ? "Light mode" : "Dark mode";
    button.setAttribute("aria-label", dark ? "Bytt til light mode" : "Bytt til dark mode");
    button.setAttribute("aria-pressed", String(dark));
    button.title = dark ? "Bytt til light mode" : "Bytt til dark mode";
  }

  function applyTheme(theme, persist = false) {
    const next = theme === "dark" ? "dark" : "light";
    root.dataset.theme = next;
    root.style.colorScheme = next;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    }
    updateButton(next);
  }

  button.addEventListener("click", () => applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true));
  applyTheme(root.dataset.theme || "light");
})();
