(() => {
  let initialized = false;
  let bookings = [];
  let quotes = [];
  let getLeads = () => [];

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const money = (value) => new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(Number(value) || 0);
  const localDate = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  function toast(message) {
    const node = document.getElementById("toast");
    node.textContent = `✓ ${message}`;
    node.classList.add("show");
    clearTimeout(window.operationsToastTimer);
    window.operationsToastTimer = setTimeout(() => node.classList.remove("show"), 3500);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) location.replace("/crm-login.html");
    if (!response.ok) throw new Error(data.error || "Handlingen kunne ikke fullføres.");
    return data;
  }

  function dateLabel(value) {
    if (!value) return "—";
    const date = new Date(`${value}T12:00:00`);
    return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }

  function bookingDate(value) {
    const date = new Date(`${value}T12:00:00`);
    return {
      day: new Intl.DateTimeFormat("nb-NO", { day: "2-digit" }).format(date),
      month: new Intl.DateTimeFormat("nb-NO", { month: "short" }).format(date).replace(".", "").toUpperCase(),
    };
  }

  function sortedBookings() {
    const today = localDate();
    return [...bookings].sort((left, right) => {
      const leftPast = left.date < today;
      const rightPast = right.date < today;
      if (leftPast !== rightPast) return leftPast ? 1 : -1;
      const comparison = `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`);
      return leftPast ? -comparison : comparison;
    });
  }

  function stateClass(status) {
    if (["Bekreftet", "Godkjent", "Fullført"].includes(status)) return "green";
    if (["Avlyst", "Avslått", "Utløpt"].includes(status)) return "neutral";
    return status === "Sendt" ? "blue" : "amber";
  }

  function renderBookings() {
    const list = document.getElementById("booking-list");
    if (!list) return;
    const visible = sortedBookings();
    list.innerHTML = visible.length ? visible.map((booking) => {
      const date = bookingDate(booking.date);
      return `<article class="booking-card"><div class="booking-date"><strong>${esc(date.day)}</strong><span>${esc(date.month)}</span></div><div class="booking-copy"><strong>${esc(booking.title)}</strong><span>${esc(booking.startTime)}–${esc(booking.endTime)} · ${esc(booking.service)} · ${esc(booking.assignee)}</span><span>${esc(booking.clientName || booking.clientEmail || "Intern økt")}</span><em class="state ${stateClass(booking.status)}">${esc(booking.status)}</em></div><div class="booking-actions"><button class="tiny-button" data-booking-ics="${esc(booking.id)}">Kalenderfil</button><button class="tiny-button" data-booking-edit="${esc(booking.id)}">Rediger</button><button class="tiny-button danger" data-booking-delete="${esc(booking.id)}">Slett</button></div></article>`;
    }).join("") : '<div class="empty">Ingen bookinger ennå.</div>';
    document.querySelectorAll("[data-booking-edit]").forEach((button) => { button.onclick = () => openBooking(null, button.dataset.bookingEdit); });
    document.querySelectorAll("[data-booking-delete]").forEach((button) => { button.onclick = () => deleteBooking(button.dataset.bookingDelete); });
    document.querySelectorAll("[data-booking-ics]").forEach((button) => { button.onclick = () => downloadBooking(button.dataset.bookingIcs); });
    renderMetrics();
  }

  function lineMarkup(item = {}) {
    return `<div class="quote-line"><input data-quote-field="description" required maxlength="180" value="${esc(item.description || "")}" placeholder="Innspilling, miks …"><input data-quote-field="quantity" type="number" required min="0.25" step="0.25" value="${esc(item.quantity || 1)}"><select data-quote-field="unit">${["time", "låt", "dag", "stk"].map((unit) => `<option ${unit === (item.unit || "time") ? "selected" : ""}>${unit}</option>`).join("")}</select><input data-quote-field="unitPrice" type="number" required min="0" step="50" value="${esc(item.unitPrice ?? 550)}"><button class="icon-button" data-remove-quote-line type="button" aria-label="Fjern linje">×</button></div>`;
  }

  function renderQuoteLines(items = []) {
    const list = document.getElementById("quote-line-list");
    list.innerHTML = (items.length ? items : [{ description: "Innspilling", quantity: 1, unit: "time", unitPrice: 550 }]).map(lineMarkup).join("");
    list.querySelectorAll("input, select").forEach((input) => { input.oninput = updateQuoteTotal; });
    list.querySelectorAll("[data-remove-quote-line]").forEach((button) => {
      button.onclick = () => {
        if (list.children.length === 1) return toast("Et tilbud må ha minst én linje.");
        button.closest(".quote-line").remove();
        updateQuoteTotal();
      };
    });
    updateQuoteTotal();
  }

  function collectQuoteLines() {
    return [...document.querySelectorAll("#quote-line-list .quote-line")].map((row) => {
      const value = (field) => row.querySelector(`[data-quote-field="${field}"]`).value;
      return { description: value("description"), quantity: Number(value("quantity")), unit: value("unit"), unitPrice: Number(value("unitPrice")) };
    });
  }

  function updateQuoteTotal() {
    const total = collectQuoteLines().reduce((sum, item) => sum + ((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)), 0);
    document.getElementById("quote-form-total").textContent = money(total);
  }

  function renderQuotes() {
    const list = document.getElementById("quote-list");
    if (!list) return;
    list.innerHTML = quotes.length ? quotes.map((quote) => `<article class="quote-card"><div class="quote-card-head"><div class="quote-copy"><strong>${esc(quote.customerName)}</strong><span>${esc(quote.projectName)} · ${esc(quote.number)}</span><span>${quote.validUntil ? `Gyldig til ${esc(dateLabel(quote.validUntil))}` : "Ingen utløpsdato"}</span></div><strong>${esc(money(quote.total))}</strong></div><div class="quote-card-foot"><select class="quote-status" data-quote-status="${esc(quote.id)}" aria-label="Tilbudsstatus">${["Utkast", "Sendt", "Godkjent", "Avslått", "Utløpt"].map((status) => `<option ${status === quote.status ? "selected" : ""}>${status}</option>`).join("")}</select><div class="quote-actions"><button class="tiny-button" data-quote-copy="${esc(quote.id)}">Kopier tekst</button><button class="tiny-button" data-quote-print="${esc(quote.id)}">Skriv ut / PDF</button><button class="tiny-button" data-quote-edit="${esc(quote.id)}">Rediger</button><button class="tiny-button danger" data-quote-delete="${esc(quote.id)}">Slett</button></div></div></article>`).join("") : '<div class="empty">Ingen tilbud ennå.</div>';
    document.querySelectorAll("[data-quote-status]").forEach((select) => { select.onchange = () => updateQuoteStatus(select.dataset.quoteStatus, select.value); });
    document.querySelectorAll("[data-quote-copy]").forEach((button) => { button.onclick = () => copyQuote(button.dataset.quoteCopy); });
    document.querySelectorAll("[data-quote-print]").forEach((button) => { button.onclick = () => printQuote(button.dataset.quotePrint); });
    document.querySelectorAll("[data-quote-edit]").forEach((button) => { button.onclick = () => openQuote(null, button.dataset.quoteEdit); });
    document.querySelectorAll("[data-quote-delete]").forEach((button) => { button.onclick = () => deleteQuote(button.dataset.quoteDelete); });
    renderMetrics();
  }

  function renderMetrics() {
    const today = localDate();
    const upcoming = bookings.filter((booking) => booking.date >= today && !["Avlyst", "Fullført"].includes(booking.status));
    const openQuotes = quotes.filter((quote) => ["Utkast", "Sendt"].includes(quote.status));
    const next = [...upcoming].sort((left, right) => `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`))[0];
    document.getElementById("booking-count").textContent = String(upcoming.length);
    document.getElementById("ops-upcoming").textContent = String(upcoming.length);
    document.getElementById("ops-open-quotes").textContent = String(openQuotes.length);
    document.getElementById("ops-quote-value").textContent = money(openQuotes.reduce((sum, quote) => sum + (Number(quote.total) || 0), 0));
    document.getElementById("ops-next-session").textContent = next ? `${dateLabel(next.date).replace(/\s+\d{4}$/, "")} · ${next.startTime}` : "—";
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove("open");
  }

  function suggestedQuoteItem(lead = {}) {
    const project = String(lead?.project || "").toLowerCase();
    if (project.includes("master")) return { description: "Mastering", quantity: 1, unit: "låt", unitPrice: 750 };
    if (project.includes("produksjon")) return { description: "Produksjon", quantity: 1, unit: "time", unitPrice: 650 };
    if (project.includes("miks")) return { description: "Miks", quantity: 1, unit: "time", unitPrice: 550 };
    return { description: "Innspilling", quantity: 1, unit: "time", unitPrice: 550 };
  }

  function populateLeadPicker(id, selectedId = "") {
    const picker = document.getElementById(id);
    const options = getLeads().filter((lead) => !["Ferdig", "Tapt"].includes(lead.stage));
    picker.innerHTML = '<option value="">Ingen valgt</option>' + options.map((lead) => `<option value="${esc(lead.id)}" ${lead.id === selectedId ? "selected" : ""}>${esc(lead.artistName || lead.name)} · ${esc(lead.project)}</option>`).join("");
  }

  function openBooking(lead = null, bookingId = "") {
    const form = document.getElementById("booking-form");
    const booking = bookings.find((item) => item.id === bookingId);
    form.reset();
    populateLeadPicker("booking-lead-picker", booking?.leadId || lead?.id || "");
    const values = booking || {
      leadId: lead?.id || "",
      title: lead ? `${lead.artistName || lead.name} – ${suggestedQuoteItem(lead).description}` : "",
      clientName: lead?.artistName || lead?.name || "",
      clientEmail: lead?.email || "",
      service: suggestedQuoteItem(lead).description,
      assignee: lead?.assignee || "Begge",
      date: lead?.followUpDate || localDate(),
      startTime: "10:00",
      endTime: "14:00",
      status: "Planlagt",
      notes: lead?.project || "",
    };
    Object.entries(values).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ""; });
    document.getElementById("booking-lead-picker").value = values.leadId || "";
    document.getElementById("booking-modal-title").textContent = booking ? "Rediger booking" : "Ny booking";
    document.getElementById("lead-modal").classList.remove("open");
    document.getElementById("booking-modal").classList.add("open");
  }

  function openQuote(lead = null, quoteId = "") {
    const form = document.getElementById("quote-form");
    const quote = quotes.find((item) => item.id === quoteId);
    form.reset();
    populateLeadPicker("quote-lead-picker", quote?.leadId || lead?.id || "");
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 14);
    const values = quote || {
      leadId: lead?.id || "",
      customerName: lead?.artistName || lead?.name || "",
      customerEmail: lead?.email || "",
      projectName: lead?.project || "",
      validUntil: localDate(expiry),
      status: "Utkast",
      terms: "Prisen er et estimat basert på oppgitt omfang. Eventuell ekstra tid avtales før arbeidet fortsetter. Betalingsvilkår følger avtale og faktura fra Loki Lydstudio.",
    };
    Object.entries(values).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ""; });
    document.getElementById("quote-lead-picker").value = values.leadId || "";
    renderQuoteLines(quote?.items || [suggestedQuoteItem(lead || {})]);
    document.getElementById("quote-modal-title").textContent = quote ? `Tilbud ${quote.number}` : "Nytt tilbud";
    document.getElementById("lead-modal").classList.remove("open");
    document.getElementById("quote-modal").classList.add("open");
  }

  async function saveBooking(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const id = String(values.id || "");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const data = await api("/api/studio?action=bookings", {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(id ? { id, changes: values } : { booking: values }),
      });
      bookings = id ? bookings.map((item) => item.id === id ? data.booking : item) : [...bookings, data.booking];
      closeModal("booking-modal");
      renderBookings();
      toast(id ? "Bookingen er oppdatert." : "Bookingen er lagret uten tidskollisjon.");
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }

  async function saveQuote(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const id = String(values.id || "");
    const quote = { ...values, items: collectQuoteLines() };
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const data = await api("/api/studio?action=quotes", {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(id ? { id, changes: quote } : { quote }),
      });
      quotes = id ? quotes.map((item) => item.id === id ? data.quote : item) : [data.quote, ...quotes];
      closeModal("quote-modal");
      renderQuotes();
      toast(id ? "Tilbudet er oppdatert." : "Tilbudet er lagret som utkast.");
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }

  async function updateQuoteStatus(id, status) {
    try {
      const data = await api("/api/studio?action=quotes", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, changes: { status } }) });
      quotes = quotes.map((quote) => quote.id === id ? data.quote : quote);
      renderQuotes();
      toast(`Tilbudet er markert som «${status}».`);
    } catch (error) { toast(error.message); renderQuotes(); }
  }

  async function deleteBooking(id) {
    const booking = bookings.find((item) => item.id === id);
    if (!booking || !confirm(`Slett bookingen «${booking.title}»?`)) return;
    try {
      await api(`/api/studio?action=bookings&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      bookings = bookings.filter((item) => item.id !== id);
      renderBookings();
      toast("Bookingen er slettet.");
    } catch (error) { toast(error.message); }
  }

  async function deleteQuote(id) {
    const quote = quotes.find((item) => item.id === id);
    if (!quote || !confirm(`Slett tilbud ${quote.number}?`)) return;
    try {
      await api(`/api/studio?action=quotes&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      quotes = quotes.filter((item) => item.id !== id);
      renderQuotes();
      toast("Tilbudet er slettet.");
    } catch (error) { toast(error.message); }
  }

  function downloadBooking(id) {
    const booking = bookings.find((item) => item.id === id);
    if (!booking) return;
    const compact = (value) => value.replace(/[-:]/g, "");
    const escapeIcs = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
    const content = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Loki Lydstudio//CRM//NO", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT", `UID:${escapeIcs(booking.id)}@lokilyd.no`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
      `DTSTART:${compact(booking.date)}T${compact(booking.startTime)}00`, `DTEND:${compact(booking.date)}T${compact(booking.endTime)}00`,
      `SUMMARY:${escapeIcs(booking.title)}`, `DESCRIPTION:${escapeIcs(`${booking.service}. ${booking.notes || ""}`)}`, "LOCATION:Loki Lydstudio\, Frydenbølien 17", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `Loki-booking-${booking.date}.ics`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 20_000);
  }

  function quoteText(quote) {
    const lines = quote.items.map((item) => `• ${item.description}: ${item.quantity} ${item.unit} × ${money(item.unitPrice)} = ${money(item.lineTotal)}`).join("\n");
    return `Tilbud ${quote.number} – ${quote.projectName}\n\nHei ${quote.customerName}!\n\n${lines}\n\nTotalt: ${money(quote.total)}${quote.validUntil ? `\nGyldig til: ${dateLabel(quote.validUntil)}` : ""}\n\n${quote.terms || ""}\n\nHilsen Leon og Charles\nLoki Lydstudio`;
  }

  async function copyQuote(id) {
    const quote = quotes.find((item) => item.id === id);
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(quoteText(quote));
      toast("Tilbudsteksten er kopiert og klar til å limes inn i e-post.");
    } catch { window.prompt("Kopier tilbudsteksten:", quoteText(quote)); }
  }

  function printQuote(id) {
    const quote = quotes.find((item) => item.id === id);
    if (!quote) return;
    document.querySelector(".quote-print-sheet")?.remove();
    const sheet = document.createElement("section");
    sheet.className = "quote-print-sheet";
    sheet.innerHTML = `<header class="quote-print-head"><div class="quote-print-brand"><img src="/assets/brand/loki-symbol.png" alt=""><div><strong>LOKI</strong><span>LYDSTUDIO</span></div></div><div class="quote-print-title"><span>PRISTILBUD</span><h1>${esc(quote.number)}</h1><span>Opprettet ${esc(dateLabel(quote.createdAt.slice(0, 10)))}</span></div></header><section class="quote-print-parties"><div><span>TIL</span><strong>${esc(quote.customerName)}</strong><small>${esc(quote.customerEmail || "")}</small></div><div><span>PROSJEKT</span><strong>${esc(quote.projectName)}</strong><small>${quote.validUntil ? `Gyldig til ${esc(dateLabel(quote.validUntil))}` : ""}</small></div></section><table class="quote-print-table"><thead><tr><th>Beskrivelse</th><th>Antall</th><th>Enhet</th><th>Pris</th><th>Sum</th></tr></thead><tbody>${quote.items.map((item) => `<tr><td>${esc(item.description)}</td><td>${esc(item.quantity)}</td><td>${esc(item.unit)}</td><td>${esc(money(item.unitPrice))}</td><td>${esc(money(item.lineTotal))}</td></tr>`).join("")}</tbody></table><div class="quote-print-total"><span>TOTALT</span><strong>${esc(money(quote.total))}</strong></div><p class="quote-print-terms">${esc(quote.terms || "")}</p><footer class="quote-print-footer">Loki Lydstudio · Frydenbølien 17 · post@lokilyd.no · lokilyd.no</footer>`;
    document.body.appendChild(sheet);
    document.body.classList.add("printing-quote");
    const cleanup = () => { document.body.classList.remove("printing-quote"); sheet.remove(); window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    window.print();
    setTimeout(() => { if (document.body.contains(sheet) && !window.matchMedia("print").matches) cleanup(); }, 1000);
  }

  async function createBackup() {
    const button = document.getElementById("crm-backup");
    if (!window.LokiZip?.downloadZip) return toast("ZIP-modulen kunne ikke lastes.");
    button.disabled = true;
    button.textContent = "Forbereder …";
    try {
      const data = await api("/api/studio?action=backup");
      const json = JSON.stringify(data, null, 2);
      const readme = "LOKI LYDSTUDIO – CRM-BACKUP\n\nDenne ZIP-filen inneholder personopplysninger og skal oppbevares kryptert.\nLydfiler følger ikke med; bruk prosjektbackup under Prosjekter for disse.\n";
      const zip = window.LokiZip.downloadZip([
        { name: "Loki-CRM-data.json", input: json, size: new TextEncoder().encode(json).byteLength },
        { name: "LES-MEG.txt", input: readme, size: new TextEncoder().encode(readme).byteLength },
      ]);
      const blob = await zip.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Loki-CRM-backup-${localDate()}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast("Full CRM-backup er lastet ned som ZIP.");
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; button.textContent = "⇩ Full CRM-backup"; }
  }

  async function createFollowupTask(lead) {
    try {
      await api("/api/studio?action=workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "task", item: { title: `Følg opp ${lead.name}`, details: lead.nextAction || lead.project, assignee: lead.assignee || "Begge", dueDate: lead.followUpDate || localDate(), priority: "Høy" } }) });
      await window.LokiWorkspace?.reload?.();
      toast("Oppfølgingen er lagt i gjørelisten.");
    } catch (error) { toast(error.message); }
  }

  function createProjectForLead(lead) {
    const form = document.getElementById("project-form");
    form.elements.name.value = `${lead.artistName || lead.name} – ${lead.project}`.slice(0, 150);
    form.elements.clientName.value = lead.artistName || lead.name;
    form.elements.clientEmail.value = lead.email;
    document.getElementById("lead-modal").classList.remove("open");
    document.getElementById("project-modal").classList.add("open");
  }

  function bind() {
    document.getElementById("new-booking").onclick = () => openBooking();
    document.getElementById("new-quote").onclick = () => openQuote();
    document.getElementById("crm-backup").onclick = createBackup;
    document.getElementById("booking-form").onsubmit = saveBooking;
    document.getElementById("quote-form").onsubmit = saveQuote;
    document.getElementById("close-booking-modal").onclick = () => closeModal("booking-modal");
    document.getElementById("cancel-booking-modal").onclick = () => closeModal("booking-modal");
    document.getElementById("close-quote-modal").onclick = () => closeModal("quote-modal");
    document.getElementById("cancel-quote-modal").onclick = () => closeModal("quote-modal");
    document.getElementById("add-quote-line").onclick = () => {
      document.getElementById("quote-line-list").insertAdjacentHTML("beforeend", lineMarkup({ description: "", quantity: 1, unit: "time", unitPrice: 550 }));
      renderQuoteLines(collectQuoteLines());
    };
    document.getElementById("booking-lead-picker").onchange = (event) => {
      const lead = getLeads().find((item) => item.id === event.target.value);
      const form = document.getElementById("booking-form");
      if (lead && form.elements.id.value) {
        form.elements.leadId.value = lead.id;
        form.elements.clientName.value = lead.artistName || lead.name;
        form.elements.clientEmail.value = lead.email;
      } else if (lead) openBooking(lead);
      else form.elements.leadId.value = "";
    };
    document.getElementById("quote-lead-picker").onchange = (event) => {
      const lead = getLeads().find((item) => item.id === event.target.value);
      const form = document.getElementById("quote-form");
      if (lead && form.elements.id.value) {
        form.elements.leadId.value = lead.id;
        form.elements.customerName.value = lead.artistName || lead.name;
        form.elements.customerEmail.value = lead.email;
      } else if (lead) openQuote(lead);
      else form.elements.leadId.value = "";
    };
  }

  async function reload() {
    const [bookingData, quoteData] = await Promise.all([
      api("/api/studio?action=bookings"),
      api("/api/studio?action=quotes"),
    ]);
    bookings = bookingData.bookings || [];
    quotes = quoteData.quotes || [];
    renderBookings();
    renderQuotes();
  }

  async function init(options = {}) {
    if (options.getLeads) getLeads = options.getLeads;
    if (!initialized) {
      initialized = true;
      bind();
      renderQuoteLines();
    }
    await reload();
  }

  window.LokiOperations = { createFollowupTask, createProjectForLead, getLeads: () => getLeads(), init, openBooking, openQuote, reload };
})();
