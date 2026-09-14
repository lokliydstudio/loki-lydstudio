(() => {
  const input = document.getElementById("fiken-contact-file");
  const button = document.getElementById("import-fiken-contacts");
  const status = document.getElementById("fiken-import-status");
  const MAX_BYTES = 5 * 1024 * 1024;
  const STATUS_KEY = "loki-fiken-import-status";
  if (!input || !button || !status) return;

  function setStatus(message, type = "") {
    status.textContent = message;
    status.className = `fiken-import-status${type ? ` ${type}` : ""}`;
  }

  function base64FromBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunks = [];
    const chunkSize = 0x8000;
    for (let start = 0; start < bytes.length; start += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(start, start + chunkSize)));
    }
    return btoa(chunks.join(""));
  }

  try {
    const previousStatus = sessionStorage.getItem(STATUS_KEY);
    if (previousStatus) {
      sessionStorage.removeItem(STATUS_KEY);
      setStatus(previousStatus, "success");
    }
  } catch {}

  button.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setStatus("Velg en XLSX-eksport fra Fiken.", "error");
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus("Filen er større enn grensen på 5 MB.", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "Importerer …";
    setStatus("Leser kontaktarket og oppdaterer kontaktregisteret …");
    try {
      const fileBase64 = base64FromBuffer(await file.arrayBuffer());
      const response = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "importFikenXlsx", fileBase64 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Fiken-kontaktene kunne ikke importeres.");
      const result = data.import || {};
      const summary = `${result.rows || 0} rader behandlet · ${result.created || 0} nye · ${result.updated || 0} oppdatert`;
      try { sessionStorage.setItem(STATUS_KEY, summary); } catch {}
      setStatus(summary, "success");
      window.setTimeout(() => location.replace(`${location.pathname}${location.search}#leads`), 650);
    } catch (error) {
      setStatus(error?.message || "Fiken-kontaktene kunne ikke importeres.", "error");
      button.disabled = false;
      button.textContent = "⇧ Importer Fiken XLSX";
    }
  });
})();
