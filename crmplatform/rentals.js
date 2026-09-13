(() => {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Des"];
  const today = new Date();
  let selectedYear = today.getFullYear();
  let selectedMonth = today.getMonth() + 1;
  let tenants = [];
  let payments = [];
  let rooms = [];
  let summary = { activeTenants: 0, monthlyRent: 0 };
  let editingTenantId = null;

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const money = (value) => new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(Number(value) || 0);
  const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Handlingen kunne ikke fullføres.");
    return data;
  };
  const toast = (message) => {
    const node = document.getElementById("toast");
    node.textContent = `✓ ${message}`;
    node.classList.add("show");
    clearTimeout(window.rentalToastTimer);
    window.rentalToastTimer = setTimeout(() => node.classList.remove("show"), 3200);
  };
  const setSaveState = (message) => { document.getElementById("rental-save-state").textContent = message; };
  const paymentKey = (tenantId, year, month) => `${tenantId}:${year}:${month}`;
  const paymentMap = () => new Map(payments.map((payment) => [paymentKey(payment.tenantId, payment.year, payment.month), payment]));
  const isDue = (year, month) => year < today.getFullYear() || (year === today.getFullYear() && month <= today.getMonth() + 1);

  function activeTenants() {
    return tenants.filter((tenant) => tenant.active !== false);
  }

  function filteredTenants() {
    const query = document.getElementById("rental-search").value.trim().toLowerCase();
    const room = document.getElementById("rental-room-filter").value;
    const showInactive = document.getElementById("rental-show-inactive").checked;
    return tenants
      .filter((tenant) => showInactive || tenant.active !== false)
      .filter((tenant) => !room || tenant.room === room)
      .filter((tenant) => !query || [tenant.name, tenant.contactPerson, tenant.email, tenant.phone, tenant.arrangement, tenant.notes].join(" ").toLowerCase().includes(query))
      .sort((left, right) => String(left.room).localeCompare(String(right.room), "nb") || String(left.name).localeCompare(String(right.name), "nb"));
  }

  function renderMetrics() {
    const lookup = paymentMap();
    const active = activeTenants();
    const paid = active.filter((tenant) => lookup.get(paymentKey(tenant.id, selectedYear, selectedMonth))?.paid);
    const paidTotal = paid.reduce((sum, tenant) => sum + Number(tenant.monthlyRent || 0), 0);
    const total = active.reduce((sum, tenant) => sum + Number(tenant.monthlyRent || 0), 0);
    document.getElementById("rental-year").textContent = String(selectedYear);
    document.getElementById("rental-active-count").textContent = String(summary.activeTenants ?? active.length);
    document.getElementById("rental-monthly-total").textContent = money(summary.monthlyRent ?? total);
    document.getElementById("rental-paid-label").textContent = `BETALT · ${MONTHS[selectedMonth - 1].toUpperCase()} ${selectedYear}`;
    document.getElementById("rental-paid-total").textContent = money(paidTotal);
    document.getElementById("rental-paid-count").textContent = `${paid.length} av ${active.length} registrert`;
    document.getElementById("rental-missing-label").textContent = `MANGLER · ${MONTHS[selectedMonth - 1].toUpperCase()} ${selectedYear}`;
    document.getElementById("rental-missing-total").textContent = money(Math.max(0, total - paidTotal));
    document.querySelectorAll("[data-rental-month]").forEach((button) => button.classList.toggle("active", Number(button.dataset.rentalMonth) === selectedMonth));
  }

  function contactCell(tenant) {
    const links = [];
    if (tenant.email) links.push(`<a href="mailto:${esc(tenant.email)}">${esc(tenant.email)}</a>`);
    if (tenant.phone) links.push(`<a href="tel:${esc(tenant.phone.replace(/\s+/g, ""))}">${esc(tenant.phone)}</a>`);
    return `<div class="rental-contact">${tenant.contactPerson ? `<strong>${esc(tenant.contactPerson)}</strong>` : ""}${links.join("")}${!tenant.contactPerson && !links.length ? '<span class="missing">Mangler kontaktinfo</span>' : ""}</div>`;
  }

  function contractCell(tenant) {
    const stateClass = tenant.contractStatus === "Signert" ? "green" : tenant.contractAvailable ? "amber" : "red";
    return `<div class="rental-contract">${tenant.contractAvailable ? `<a href="${esc(tenant.contractUrl)}" target="_blank" rel="noreferrer">Åpne i Jottacloud ↗</a>` : '<button class="rental-edit" type="button" data-tenant-edit="' + esc(tenant.id) + '" aria-label="Koble kontrakt">+</button>'}<span class="state ${stateClass}">${esc(tenant.contractStatus)}</span></div>`;
  }

  function paymentCell(tenant, month, lookup) {
    const payment = lookup.get(paymentKey(tenant.id, selectedYear, month));
    const paid = Boolean(payment?.paid);
    return `<div class="rental-payment ${paid ? "paid" : ""} ${isDue(selectedYear, month) ? "due" : ""}" data-payment-cell="${esc(tenant.id)}-${month}"><input type="checkbox" data-rental-paid="${esc(tenant.id)}" data-month="${month}" ${paid ? "checked" : ""} aria-label="${esc(tenant.name)}, ${MONTHS[month - 1]} ${selectedYear} betalt"><input type="date" data-rental-date="${esc(tenant.id)}" data-month="${month}" value="${esc(payment?.paidAt || "")}" ${paid ? "" : "disabled"} aria-label="Betalingsdato for ${esc(tenant.name)}, ${MONTHS[month - 1]} ${selectedYear}"></div>`;
  }

  function renderTable() {
    const wrap = document.querySelector(".rental-sheet-wrap");
    const scrollLeft = wrap.scrollLeft;
    const scrollTop = wrap.scrollTop;
    const lookup = paymentMap();
    const visible = filteredTenants();
    document.getElementById("rental-rows").innerHTML = visible.length ? visible.map((tenant) => `<tr class="${tenant.active === false ? "rental-inactive" : ""}"><td class="rental-sticky"><div class="rental-tenant"><div class="rental-tenant-copy"><strong>${esc(tenant.name)}</strong><small>${tenant.active === false ? "Avsluttet avtale" : "Aktiv avtale"}</small></div><button class="rental-edit" type="button" data-tenant-edit="${esc(tenant.id)}" aria-label="Rediger ${esc(tenant.name)}">✎</button></div></td><td><span class="rental-room">${esc(tenant.room)}</span></td><td><span class="rental-arrangement">${esc(tenant.arrangement || "Ikke beskrevet")}</span></td><td><span class="rental-rent">${esc(money(tenant.monthlyRent))}</span></td><td>${contactCell(tenant)}</td><td>${contractCell(tenant)}</td>${MONTHS.map((_, index) => `<td>${paymentCell(tenant, index + 1, lookup)}</td>`).join("")}</tr>`).join("") : '<tr><td class="rental-empty-cell" colspan="18">Ingen leietakere samsvarer med filteret.</td></tr>';
    wrap.scrollLeft = scrollLeft;
    wrap.scrollTop = scrollTop;
    bindTableActions();
  }

  function renderKeys() {
    document.getElementById("rental-key-grid").innerHTML = rooms
      .slice()
      .sort((left, right) => String(left.room).localeCompare(String(right.room), "nb"))
      .map((room) => `<article class="rental-key-card"><div class="rental-key-copy"><strong>${esc(room.room)}</strong><span>nøkler registrert som utdelt</span></div><div class="rental-key-control"><button type="button" data-key-step="-1" data-room-id="${esc(room.id)}" aria-label="Trekk fra én nøkkel">−</button><input type="number" min="0" max="100" value="${Number(room.issuedKeys) || 0}" data-room-keys="${esc(room.id)}" aria-label="Antall utdelte nøkler for ${esc(room.room)}"><button type="button" data-key-step="1" data-room-id="${esc(room.id)}" aria-label="Legg til én nøkkel">+</button></div></article>`).join("") || '<div class="empty">Ingen studiorom registrert.</div>';
    document.querySelectorAll("[data-room-keys]").forEach((input) => { input.onchange = () => saveRoomKeys(input.dataset.roomKeys, input.value); });
    document.querySelectorAll("[data-key-step]").forEach((button) => {
      button.onclick = () => {
        const input = document.querySelector(`[data-room-keys="${CSS.escape(button.dataset.roomId)}"]`);
        const next = Math.max(0, Math.min(100, Number(input.value || 0) + Number(button.dataset.keyStep)));
        input.value = String(next);
        saveRoomKeys(button.dataset.roomId, next);
      };
    });
  }

  function renderAll() {
    renderMetrics();
    renderTable();
    renderKeys();
  }

  function bindTableActions() {
    document.querySelectorAll("[data-tenant-edit]").forEach((button) => { button.onclick = () => openTenantModal(button.dataset.tenantEdit); });
    document.querySelectorAll("[data-rental-paid]").forEach((input) => {
      input.onchange = () => savePayment(input.dataset.rentalPaid, Number(input.dataset.month), input.checked, input.checked ? new Date().toISOString().slice(0, 10) : "", input.closest(".rental-payment"));
    });
    document.querySelectorAll("[data-rental-date]").forEach((input) => {
      input.onchange = () => savePayment(input.dataset.rentalDate, Number(input.dataset.month), true, input.value, input.closest(".rental-payment"));
    });
  }

  async function savePayment(tenantId, month, paid, paidAt, cell) {
    cell?.classList.add("rental-payment-saving");
    setSaveState("Lagrer betaling …");
    try {
      const data = await api("/api/studio?action=rentals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "payment", item: { tenantId, year: selectedYear, month, paid, paidAt } }) });
      payments = payments.filter((payment) => !(payment.tenantId === tenantId && Number(payment.year) === selectedYear && Number(payment.month) === month));
      payments.push(data.payment);
      renderMetrics();
      renderTable();
      setSaveState(`Lagret ${new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`);
    } catch (error) {
      renderTable();
      setSaveState("Kunne ikke lagre");
      toast(error.message);
    }
  }

  async function saveRoomKeys(id, issuedKeys) {
    setSaveState("Lagrer nøkkelregister …");
    try {
      const data = await api("/api/studio?action=rentals", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "room-keys", id, changes: { issuedKeys } }) });
      rooms = rooms.map((room) => room.id === id ? data.room : room);
      renderKeys();
      setSaveState("Nøkkelregister lagret");
    } catch (error) { renderKeys(); setSaveState("Kunne ikke lagre"); toast(error.message); }
  }

  function openTenantModal(id = "") {
    editingTenantId = id || null;
    const tenant = tenants.find((item) => item.id === id);
    const form = document.getElementById("tenant-form");
    form.reset();
    form.elements.active.checked = true;
    if (tenant) {
      ["id", "name", "contactPerson", "room", "monthlyRent", "arrangement", "email", "phone", "contractUrl", "contractStatus", "notes"].forEach((key) => {
        if (form.elements[key]) form.elements[key].value = tenant[key] ?? "";
      });
      form.elements.active.checked = tenant.active !== false;
    }
    document.getElementById("tenant-modal-title").textContent = tenant ? `Rediger ${tenant.name}` : "Ny leieavtale";
    document.getElementById("tenant-submit").textContent = tenant ? "Lagre endringer" : "Opprett leieavtale";
    document.getElementById("tenant-modal").classList.add("open");
    setTimeout(() => form.elements.name.focus(), 0);
  }

  function closeTenantModal() {
    editingTenantId = null;
    document.getElementById("tenant-modal").classList.remove("open");
  }

  async function saveTenant(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.getElementById("tenant-submit");
    const item = Object.fromEntries(new FormData(form));
    item.active = form.elements.active.checked;
    button.disabled = true;
    setSaveState("Lagrer leieavtale …");
    try {
      const options = editingTenantId
        ? { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "tenant", id: editingTenantId, changes: item }) }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "tenant", item }) };
      const data = await api("/api/studio?action=rentals", options);
      if (editingTenantId) tenants = tenants.map((tenant) => tenant.id === editingTenantId ? data.tenant : tenant);
      else tenants.unshift(data.tenant);
      summary.activeTenants = activeTenants().length;
      summary.monthlyRent = activeTenants().reduce((sum, tenant) => sum + Number(tenant.monthlyRent || 0), 0);
      closeTenantModal();
      renderAll();
      setSaveState("Leieavtalen er lagret");
      toast("Leieavtalen er lagret.");
    } catch (error) { setSaveState("Kunne ikke lagre"); toast(error.message); }
    finally { button.disabled = false; }
  }

  async function loadRentals() {
    setSaveState("Henter leieoversikt …");
    try {
      const data = await api("/api/studio?action=rentals");
      tenants = data.tenants || [];
      payments = data.payments || [];
      rooms = data.rooms || [];
      summary = data.summary || summary;
      renderAll();
      setSaveState("Alle endringer lagres automatisk");
    } catch (error) {
      document.getElementById("rental-rows").innerHTML = `<tr><td class="rental-empty-cell" colspan="18">${esc(error.message)}</td></tr>`;
      document.getElementById("rental-key-grid").innerHTML = `<div class="empty">${esc(error.message)}</div>`;
      setSaveState("Kunne ikke hente utleieoversikten");
    }
  }

  function bindControls() {
    document.getElementById("rental-search").oninput = renderTable;
    document.getElementById("rental-room-filter").onchange = renderTable;
    document.getElementById("rental-show-inactive").onchange = renderTable;
    document.getElementById("rental-year-previous").onclick = () => { selectedYear = Math.max(2020, selectedYear - 1); renderMetrics(); renderTable(); };
    document.getElementById("rental-year-next").onclick = () => { selectedYear = Math.min(2100, selectedYear + 1); renderMetrics(); renderTable(); };
    document.querySelectorAll("[data-rental-month]").forEach((button) => { button.onclick = () => { selectedMonth = Number(button.dataset.rentalMonth); renderMetrics(); }; });
    document.getElementById("new-tenant").onclick = () => openTenantModal();
    document.getElementById("tenant-form").onsubmit = saveTenant;
    document.getElementById("close-tenant-modal").onclick = closeTenantModal;
    document.getElementById("cancel-tenant-modal").onclick = closeTenantModal;
    document.getElementById("tenant-modal").onclick = (event) => { if (event.target.id === "tenant-modal") closeTenantModal(); };
  }

  async function init() {
    bindControls();
    renderMetrics();
    await loadRentals();
  }

  window.LokiRentals = { init, reload: loadRentals };
})();
