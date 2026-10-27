(() => {
  let saved = "light";
  try { saved = localStorage.getItem("loki_booking_theme") || "light"; } catch {}
  document.documentElement.dataset.theme = saved === "dark" ? "dark" : "light";
})();
