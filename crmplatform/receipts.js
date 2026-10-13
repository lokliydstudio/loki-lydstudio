(() => {
  const maxSize = 15 * 1024 * 1024;
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  let initialized = false;
  let receipts = [];
  let selectedId = "";
  let scanAvailable = false;

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);

  function toast(text) {
    const node = document.getElementById("toast");
    node.textContent = `✓ ${text}`;
    node.classList.add("show");
    clearTimeout(window.receiptToastTimer);
    window.receiptToastTimer = setTimeout(() => node.classList.remove("show"), 4500);
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    if (response.status === 401) {
      location.replace("/crm-login.html");
      throw new Error("Innlogging kreves.");
    }
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function safeFilename(value) {
    return String(value || "bilag.jpg").normalize("NFKD")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/^\.+/, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 180);
  }

  function extension(filename) {
    return String(filename || "").toLowerCase().split(".").pop();
  }

  function contentType(file) {
    if (allowedTypes.has(file.type)) return file.type;
    return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" })[extension(file.name)] || "";
  }

  function moneyFromOre(value, currency = "NOK") {
    return new Intl.NumberFormat("nb-NO", { style: "currency", currency: currency || "NOK", maximumFractionDigits: 2 }).format((Number(value) || 0) / 100);
  }

  function amountInput(value) {
    return ((Number(value) || 0) / 100).toFixed(2).replace(".", ",");
  }

  function oreFromInput(value) {
    const normalized = String(value || "").replace(/\s/g, "").replace(",", ".");
    const amount = Number(normalized);
    return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
  }

  function formatDate(value) {
    if (!value) return "Ingen dato";
    const parsed = new Date(`${value}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? "Ingen dato" : parsed.toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
  }

  function selectedReceipt() {
    return receipts.find((item) => item.id === selectedId) || null;
  }

  function metricValues() {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return {
      all: receipts.length,
      review: receipts.filter((item) => item.status !== "Godkjent").length,
      approved: receipts.filter((item) => item.status === "Godkjent").length,
      month: receipts.filter((item) => String(item.receiptDate || "").startsWith(monthPrefix)).reduce((sum, item) => sum + (Number(item.totalOre) || 0), 0),
    };
  }

  function renderMetrics() {
    const values = metricValues();
    document.getElementById("receipt-count-all").textContent = values.all;
    document.getElementById("receipt-count-review").textContent = values.review;
    document.getElementById("receipt-count-approved").textContent = values.approved;
    document.getElementById("receipt-month-total").textContent = moneyFromOre(values.month);
    const state = document.getElementById("receipt-ai-state");
    state.textContent = scanAvailable ? "AI-skanning klar" : "Manuell registrering";
    state.className = `state ${scanAvailable ? "green" : "amber"}`;
  }

  function visibleReceipts() {
    const needle = String(document.getElementById("receipt-search")?.value || "").trim().toLowerCase();
    const status = document.getElementById("receipt-status-filter")?.value || "alle";
    return receipts.filter((item) => {
      const matchesText = `${item.supplier} ${item.name} ${item.receiptNumber} ${item.category}`.toLowerCase().includes(needle);
      const matchesStatus = status === "alle" || (status === "kontroll" ? item.status !== "Godkjent" : item.status === "Godkjent");
      return matchesText && matchesStatus;
    });
  }

  function renderList() {
    const list = document.getElementById("receipt-list");
    const visible = visibleReceipts();
    if (!visible.length) {
      list.innerHTML = `<div class="receipt-empty"><strong>${receipts.length ? "Ingen bilag matcher filteret." : "Ingen bilag ennå."}</strong><span>Ta bilde av en kvittering eller velg en fil for å komme i gang.</span></div>`;
      return;
    }
    list.innerHTML = visible.map((item) => `<button class="receipt-row ${item.id === selectedId ? "selected" : ""}" data-receipt-id="${esc(item.id)}" type="button">
      <span class="receipt-file-icon">${item.previewable ? "▧" : "PDF"}</span>
      <span class="receipt-row-copy"><strong>${esc(item.supplier || "Ukjent leverandør")}</strong><small>${esc(formatDate(item.receiptDate))} · ${esc(item.category || "Annet")}</small><small title="${esc(item.name)}">${esc(item.name)}</small></span>
      <span class="receipt-row-value"><strong>${esc(moneyFromOre(item.totalOre, item.currency))}</strong><em class="state ${item.status === "Godkjent" ? "green" : item.status === "Skanning feilet" ? "red" : "amber"}">${esc(item.status)}</em></span>
    </button>`).join("");
    list.querySelectorAll("[data-receipt-id]").forEach((button) => {
      button.onclick = () => { selectedId = button.dataset.receiptId; render(); if (innerWidth < 760) document.getElementById("receipt-detail").scrollIntoView({ behavior: "smooth", block: "start" }); };
    });
  }

  function field(label, name, value, attributes = "") {
    return `<label><span>${label}</span><input name="${name}" value="${esc(value)}" ${attributes}></label>`;
  }

  function renderDetail() {
    const root = document.getElementById("receipt-detail");
    const item = selectedReceipt();
    if (!item) {
      root.innerHTML = '<div class="receipt-detail-empty"><span>▧</span><strong>Velg et bilag</strong><p>Her kan dere kontrollere det som ble lest fra kvitteringen.</p></div>';
      return;
    }
    const fileUrl = `/api/crm/receipts?action=download&id=${encodeURIComponent(item.id)}`;
    const categories = ["Utstyr", "Programvare", "Reise", "Mat og møte", "Lokaler", "Markedsføring", "Annet"];
    const preview = item.previewable
      ? `<a class="receipt-preview" href="${fileUrl}" target="_blank" rel="noreferrer"><img src="${fileUrl}" alt="Forhåndsvisning av ${esc(item.name)}"></a>`
      : `<a class="receipt-pdf-preview" href="${fileUrl}" target="_blank" rel="noreferrer"><strong>PDF</strong><span>Trykk for å åpne bilaget</span></a>`;
    root.innerHTML = `<div class="receipt-detail-head"><div><span class="kicker">BILAG TIL KONTROLL</span><h2>${esc(item.supplier || item.name)}</h2></div><button class="receipt-close" id="receipt-close" type="button" aria-label="Lukk bilag">×</button></div>
      ${preview}
      <form id="receipt-form" class="receipt-form">
        <div class="receipt-form-grid">
          ${field("Leverandør", "supplier", item.supplier, 'autocomplete="organization"')}
          ${field("Dato", "receiptDate", item.receiptDate, 'type="date"')}
          ${field("Totalbeløp (kr)", "total", amountInput(item.totalOre), 'inputmode="decimal"')}
          ${field("MVA (kr)", "vat", amountInput(item.vatOre), 'inputmode="decimal"')}
          <label><span>Kategori</span><select name="category">${categories.map((category) => `<option ${item.category === category ? "selected" : ""}>${category}</option>`).join("")}</select></label>
          ${field("Bilags-/kvitteringsnummer", "receiptNumber", item.receiptNumber)}
          ${field("Organisasjonsnummer", "organizationNumber", item.organizationNumber, 'inputmode="numeric"')}
          ${field("Betalingsmåte", "paymentMethod", item.paymentMethod)}
        </div>
        <label><span>Notat</span><textarea name="notes" rows="3" placeholder="Prosjekt, formål eller annen intern informasjon">${esc(item.notes)}</textarea></label>
        <label><span>Status</span><select name="status"><option ${item.status !== "Godkjent" ? "selected" : ""}>Til kontroll</option><option ${item.status === "Godkjent" ? "selected" : ""}>Godkjent</option></select></label>
        ${item.scanWarnings?.length ? `<div class="receipt-warning"><strong>Kontroller spesielt</strong>${item.scanWarnings.map((warning) => `<span>• ${esc(warning)}</span>`).join("")}</div>` : ""}
        ${item.scanError ? `<div class="receipt-warning error"><strong>Skanning feilet</strong><span>${esc(item.scanError)}</span></div>` : ""}
        <p class="receipt-scan-meta">${item.scannedAt ? `AI-avlest ${esc(new Date(item.scannedAt).toLocaleString("nb-NO"))} · sikkerhet ${esc(item.scanConfidence)} %.` : "Ikke AI-avlest ennå."} Kontroller alltid originalen før godkjenning.</p>
        <div class="receipt-detail-actions"><button class="primary" type="submit">Lagre bilag</button><button class="secondary" id="receipt-scan" type="button">Skann på nytt</button><a class="secondary receipt-link-button" href="${fileUrl}&download=1">Last ned</a><button class="receipt-delete" id="receipt-delete" type="button">Slett</button></div>
      </form>`;
    document.getElementById("receipt-close").onclick = () => { selectedId = ""; render(); };
    document.getElementById("receipt-form").onsubmit = saveSelected;
    document.getElementById("receipt-scan").onclick = () => scanSelected(item.id);
    document.getElementById("receipt-delete").onclick = () => deleteSelected(item);
  }

  function render() {
    renderMetrics();
    renderList();
    renderDetail();
  }

  function setProgress(text, percentage, active = true) {
    const panel = document.getElementById("receipt-upload-progress");
    panel.classList.toggle("active", active);
    document.getElementById("receipt-upload-status").textContent = text;
    panel.querySelector("i").style.width = `${Math.max(2, Math.min(100, percentage || 0))}%`;
  }

  async function scanSelected(id, quiet = false) {
    const button = document.getElementById("receipt-scan");
    if (button) { button.disabled = true; button.textContent = "Skanner …"; }
    setProgress("Leser leverandør, dato, beløp og MVA …", 88);
    try {
      const data = await request("/api/crm/receipts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "scan", id }),
      });
      const index = receipts.findIndex((item) => item.id === id);
      if (index >= 0) receipts[index] = data.receipt;
      setProgress("Bilaget er lest og klart for kontroll.", 100);
      render();
      if (!quiet) toast("Bilaget er skannet. Kontroller feltene før godkjenning.");
    } catch (error) {
      await load().catch(() => {});
      toast(error.message || "Bilaget kunne ikke skannes. Fyll inn feltene manuelt.");
    } finally {
      setTimeout(() => setProgress("", 0, false), 900);
      if (button) { button.disabled = false; button.textContent = "Skann på nytt"; }
    }
  }

  async function uploadOne(file) {
    const type = contentType(file);
    if (!type) throw new Error("Bare JPG, PNG, WebP og PDF kan lastes opp.");
    if (!file.size || file.size > maxSize) throw new Error("Bilaget kan være maksimalt 15 MB.");
    if (!window.LokiBlob?.uploadPresigned) throw new Error("Opplastingsmodulen kunne ikke lastes.");
    const id = `receipt-${crypto.randomUUID()}`;
    const filename = safeFilename(file.name || `kvittering-${Date.now()}.jpg`);
    const pathname = `loki-crm/receipts/${id}/${filename}`;
    const payload = { id, name: filename, size: file.size, contentType: type };
    const blob = await window.LokiBlob.uploadPresigned(pathname, file, {
      access: "private",
      contentType: type,
      handleUploadUrl: "/api/crm/receipts?action=upload",
      clientPayload: JSON.stringify(payload),
      multipart: false,
      onUploadProgress: ({ percentage }) => setProgress(`Laster opp ${file.name} · ${Math.round(percentage)} %`, Math.round(percentage) * 0.75),
    });
    const data = await request("/api/crm/receipts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "register", receipt: { ...payload, pathname: blob.pathname } }),
    });
    receipts.unshift(data.receipt);
    selectedId = data.receipt.id;
    render();
    return data.receipt;
  }

  async function uploadSelected(event) {
    const files = [...(event.currentTarget.files || [])];
    event.currentTarget.value = "";
    if (!files.length) return;
    document.querySelectorAll(".receipt-upload-button").forEach((button) => { button.disabled = true; });
    try {
      for (let index = 0; index < files.length; index += 1) {
        setProgress(`Klargjør ${files[index].name} (${index + 1} av ${files.length}) …`, 3);
        const receipt = await uploadOne(files[index]);
        await scanSelected(receipt.id, true);
      }
      toast(`${files.length === 1 ? "Bilaget er" : `${files.length} bilag er`} lastet opp og klart for kontroll.`);
    } catch (error) {
      toast(error.message || "Bilaget kunne ikke lastes opp.");
    } finally {
      document.querySelectorAll(".receipt-upload-button").forEach((button) => { button.disabled = false; });
      setTimeout(() => setProgress("", 0, false), 900);
    }
  }

  async function saveSelected(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = await request("/api/crm/receipts", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: selectedId, changes: {
          supplier: fields.supplier, receiptDate: fields.receiptDate,
          totalOre: oreFromInput(fields.total), vatOre: oreFromInput(fields.vat),
          category: fields.category, receiptNumber: fields.receiptNumber,
          organizationNumber: fields.organizationNumber, paymentMethod: fields.paymentMethod,
          notes: fields.notes, status: fields.status,
        } }),
      });
      const index = receipts.findIndex((item) => item.id === selectedId);
      if (index >= 0) receipts[index] = data.receipt;
      render();
      toast(fields.status === "Godkjent" ? "Bilaget er kontrollert og godkjent." : "Bilaget er lagret.");
    } catch (error) { toast(error.message || "Bilaget kunne ikke lagres."); }
    finally { if (button.isConnected) button.disabled = false; }
  }

  async function deleteSelected(item) {
    if (!confirm(`Slett bilaget «${item.supplier || item.name}» permanent?`)) return;
    try {
      await request(`/api/crm/receipts?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      receipts = receipts.filter((receipt) => receipt.id !== item.id);
      selectedId = receipts[0]?.id || "";
      render();
      toast("Bilaget og den private filen er slettet.");
    } catch (error) { toast(error.message || "Bilaget kunne ikke slettes."); }
  }

  async function load() {
    const data = await request("/api/crm/receipts");
    receipts = data.receipts || [];
    scanAvailable = Boolean(data.scanConfigured);
    if (selectedId && !receipts.some((item) => item.id === selectedId)) selectedId = "";
    render();
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    document.getElementById("receipt-camera-button").onclick = () => document.getElementById("receipt-camera-input").click();
    document.getElementById("receipt-file-button").onclick = () => document.getElementById("receipt-file-input").click();
    document.getElementById("receipt-camera-input").onchange = uploadSelected;
    document.getElementById("receipt-file-input").onchange = uploadSelected;
    document.getElementById("receipt-search").oninput = renderList;
    document.getElementById("receipt-status-filter").onchange = renderList;
    try { await load(); }
    catch (error) {
      initialized = false;
      document.getElementById("receipt-list").innerHTML = `<div class="receipt-empty"><strong>Bilagene kunne ikke lastes.</strong><span>${esc(error.message)}</span></div>`;
    }
  }

  window.LokiReceipts = { init, reload: load };
})();
