(() => {
  let initialized = false;
  let bookings = [];
  let quotes = [];
  let googleEvents = [];
  let googleCalendar = { configured: false, calendarName: "Loki-kalender", refreshedAt: "" };
  let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  let selectedGoogleEvent = "";
  let tenantUsers = [];
  let tenantBookings = [];
  let selectedTenantStudio = "Studio C";
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

  function calendarMonthLabel() {
    return new Intl.DateTimeFormat("nb-NO", { month: "long", year: "numeric" }).format(calendarCursor);
  }

  function calendarEventLabel(event) {
    if (event.allDay) return `${dateLabel(event.date)} · Hele dagen`;
    const end = event.endDateExclusive && event.endDateExclusive !== event.date ? ` – ${dateLabel(event.endDateExclusive)} ${event.endTime}` : `–${event.endTime}`;
    return `${dateLabel(event.date)} · ${event.startTime}${end}`;
  }

  function calendarEventsForDay(key) {
    return googleEvents.filter((event) => event.allDay
      ? key >= event.date && key < event.endDateExclusive
      : event.date === key);
  }

  function visibleMonthEvents() {
    const month = `${calendarCursor.getFullYear()}-${String(calendarCursor.getMonth() + 1).padStart(2, "0")}`;
    return googleEvents.filter((event) => event.date.slice(0, 7) === month || (event.allDay && event.date < `${month}-01` && event.endDateExclusive > `${month}-01`));
  }

  function renderCalendarDetail() {
    const node = document.getElementById("google-calendar-detail");
    if (!node) return;
    const event = googleEvents.find((item) => item.id === selectedGoogleEvent);
    if (!event) {
      node.innerHTML = "<p>Velg en kalenderhendelse for å se detaljer.</p>";
      return;
    }
    const badges = [calendarEventLabel(event), event.location, event.recurring ? "Gjentakende" : ""].filter(Boolean);
    node.innerHTML = `<h4>${esc(event.title)}</h4><div class="google-calendar-detail-meta">${badges.map((item) => `<span>${esc(item)}</span>`).join("")}</div><p>${esc(event.description || "Ingen beskrivelse i Google Kalender.")}</p>`;
  }

  function bindCalendarEventButtons() {
    document.querySelectorAll("[data-google-event]").forEach((button) => {
      button.onclick = () => {
        selectedGoogleEvent = button.dataset.googleEvent;
        document.querySelectorAll("[data-google-event]").forEach((item) => item.classList.toggle("active", item.dataset.googleEvent === selectedGoogleEvent));
        renderCalendarDetail();
      };
    });
  }

  function renderGoogleCalendar() {
    const grid = document.getElementById("google-calendar-grid");
    const agenda = document.getElementById("google-calendar-agenda");
    if (!grid || !agenda) return;
    document.getElementById("google-calendar-name").textContent = googleCalendar.calendarName || "Loki-kalender";
    document.getElementById("calendar-month-title").textContent = calendarMonthLabel();
    const state = document.getElementById("google-calendar-state");
    state.textContent = googleCalendar.configured ? "Tilkoblet · skrivebeskyttet" : "Ikke konfigurert";
    state.className = `state ${googleCalendar.configured ? "green" : "amber"}`;
    document.getElementById("google-calendar-updated").textContent = googleCalendar.refreshedAt
      ? `Oppdatert ${new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" }).format(new Date(googleCalendar.refreshedAt))}`
      : googleCalendar.error || "Ingen kalenderdata";

    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const first = new Date(year, month, 1, 12);
    const offset = (first.getDay() + 6) % 7;
    const cursor = new Date(year, month, 1 - offset, 12);
    const today = localDate();
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + index, 12);
      const key = localDate(day);
      const events = calendarEventsForDay(key);
      cells.push(`<section class="google-calendar-day${day.getMonth() !== month ? " outside" : ""}${key === today ? " today" : ""}" aria-label="${esc(dateLabel(key))}"><div class="google-calendar-day-head"><strong>${day.getDate()}</strong>${events.length ? `<span>${events.length}</span>` : ""}</div>${events.slice(0, 3).map((event) => `<button class="google-calendar-event-chip${event.id === selectedGoogleEvent ? " active" : ""}" type="button" data-google-event="${esc(event.id)}" title="${esc(event.title)}"><time>${esc(event.allDay ? "Hele" : event.startTime)}</time><span>${esc(event.title)}</span></button>`).join("")}${events.length > 3 ? `<small class="google-calendar-more">+ ${events.length - 3} til</small>` : ""}</section>`);
    }
    grid.innerHTML = cells.join("");

    const monthEvents = visibleMonthEvents();
    if (!selectedGoogleEvent || !googleEvents.some((event) => event.id === selectedGoogleEvent)) {
      selectedGoogleEvent = monthEvents.find((event) => event.endAt >= new Date().toISOString())?.id || monthEvents[0]?.id || "";
    }
    agenda.innerHTML = monthEvents.length ? monthEvents.map((event) => {
      const date = bookingDate(event.date);
      return `<button class="google-calendar-agenda-item${event.id === selectedGoogleEvent ? " active" : ""}" type="button" data-google-event="${esc(event.id)}"><span class="google-calendar-agenda-date"><strong>${esc(date.day)}</strong><span>${esc(date.month)}</span></span><span class="google-calendar-agenda-copy"><strong>${esc(event.title)}</strong><span>${esc(event.allDay ? "Hele dagen" : `${event.startTime}–${event.endTime}`)}${event.location ? ` · ${esc(event.location)}` : ""}</span></span></button>`;
    }).join("") : `<div class="google-calendar-empty">${googleCalendar.configured ? "Ingen avtaler denne måneden." : "Kalenderintegrasjonen må aktiveres på serveren."}</div>`;
    bindCalendarEventButtons();
    renderCalendarDetail();
  }

  async function loadGoogleCalendar(refresh = false) {
    const button = document.getElementById("refresh-google-calendar");
    if (button) {
      button.disabled = true;
      button.textContent = "Oppdaterer …";
    }
    try {
      const data = await api(`/api/studio?action=google-calendar${refresh ? "&refresh=1" : ""}`);
      googleCalendar = data;
      googleEvents = data.events || [];
    } catch (error) {
      googleCalendar = { configured: false, calendarName: "Loki-kalender", refreshedAt: "", error: error.message };
      googleEvents = [];
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Oppdater";
      }
      renderGoogleCalendar();
      renderMetrics();
    }
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

  function tenantStatus(status) {
    return ({ pending: "Venter", approved: "Godkjent", rejected: "Avslått", suspended: "Deaktivert" })[status] || status;
  }

  function tenantStatusClass(status) {
    if (status === "approved") return "green";
    if (status === "pending") return "amber";
    return "neutral";
  }

  function renderTenantAdmin() {
    const userList = document.getElementById("tenant-user-list");
    const bookingList = document.getElementById("tenant-admin-bookings");
    if (!userList || !bookingList) return;
    const today = localDate();
    const visibleUsers = tenantUsers
      .filter((item) => item.studio === selectedTenantStudio)
      .sort((left, right) => `${left.status === "pending" ? "0" : "1"}${left.name}`.localeCompare(`${right.status === "pending" ? "0" : "1"}${right.name}`, "nb"));
    const visibleBookings = tenantBookings
      .filter((item) => item.studio === selectedTenantStudio && item.date >= today)
      .sort((left, right) => `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`));
    const pending = tenantUsers.filter((item) => item.status === "pending").length;
    document.getElementById("tenant-pending-state").textContent = `${pending} venter`;
    document.getElementById("tenant-pending-state").className = `state ${pending ? "amber" : "green"}`;
    document.getElementById("tenant-count-c").textContent = String(tenantBookings.filter((item) => item.studio === "Studio C" && item.date >= today).length);
    document.getElementById("tenant-count-d").textContent = String(tenantBookings.filter((item) => item.studio === "Studio D" && item.date >= today).length);
    document.getElementById("tenant-user-summary").textContent = `${visibleUsers.filter((item) => item.status === "approved").length} aktive`;
    document.getElementById("tenant-booking-summary").textContent = `${visibleBookings.length} kommende`;
    document.querySelectorAll("[data-tenant-studio]").forEach((button) => {
      const active = button.dataset.tenantStudio === selectedTenantStudio;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    userList.innerHTML = visibleUsers.length ? visibleUsers.map((account) => {
      const actions = account.status === "pending"
        ? `<button class="tiny-button" data-tenant-user-status="approved" data-tenant-user-id="${esc(account.id)}">Godkjenn</button><button class="tiny-button danger" data-tenant-user-status="rejected" data-tenant-user-id="${esc(account.id)}">Avslå</button>`
        : account.status === "approved"
          ? `<button class="tiny-button danger" data-tenant-user-status="suspended" data-tenant-user-id="${esc(account.id)}">Deaktiver</button>`
          : `<button class="tiny-button" data-tenant-user-status="approved" data-tenant-user-id="${esc(account.id)}">Aktiver</button>`;
      return `<article class="tenant-user-row"><div class="tenant-avatar">${esc(account.name.slice(0, 1).toUpperCase())}</div><div><strong>${esc(account.name)}</strong><span>${esc(account.email)}</span><small>${account.lastLoginAt ? `Sist innlogget ${esc(new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(account.lastLoginAt)))}` : "Har ikke logget inn"}</small></div><em class="state ${tenantStatusClass(account.status)}">${esc(tenantStatus(account.status))}</em><div class="tenant-row-actions">${actions}</div></article>`;
    }).join("") : `<div class="empty">Ingen brukere for ${esc(selectedTenantStudio)}.</div>`;
    bookingList.innerHTML = visibleBookings.length ? visibleBookings.map((booking) => {
      const date = bookingDate(booking.date);
      return `<article class="tenant-booking-row"><div class="booking-date"><strong>${esc(date.day)}</strong><span>${esc(date.month)}</span></div><div><strong>${esc(booking.title)}</strong><span>${esc(booking.startTime)}–${esc(booking.endTime)} · ${esc(booking.createdByName)}</span>${booking.notes ? `<small>${esc(booking.notes)}</small>` : ""}</div><button class="tiny-button danger" data-tenant-booking-delete="${esc(booking.id)}">Slett</button></article>`;
    }).join("") : `<div class="empty">Ingen kommende bookinger i ${esc(selectedTenantStudio)}.</div>`;
    document.querySelectorAll("[data-tenant-user-status]").forEach((button) => {
      button.onclick = () => updateTenantUser(button.dataset.tenantUserId, button.dataset.tenantUserStatus, button);
    });
    document.querySelectorAll("[data-tenant-booking-delete]").forEach((button) => {
      button.onclick = () => deleteTenantBooking(button.dataset.tenantBookingDelete);
    });
    renderMetrics();
  }

  async function loadTenantAdmin() {
    const button = document.getElementById("refresh-tenant-booking");
    if (button) { button.disabled = true; button.textContent = "Oppdaterer …"; }
    try {
      const data = await api("/api/booking?action=admin");
      tenantUsers = data.users || [];
      tenantBookings = data.bookings || [];
      renderTenantAdmin();
    } catch (error) { toast(error.message); }
    finally { if (button) { button.disabled = false; button.textContent = "Oppdater"; } }
  }

  async function updateTenantUser(id, status, button) {
    const account = tenantUsers.find((item) => item.id === id);
    const verb = status === "approved" ? "godkjenne" : status === "rejected" ? "avslå" : "deaktivere";
    if (!account || !confirm(`Vil du ${verb} bookingkontoen til ${account.name}?`)) return;
    button.disabled = true;
    try {
      const data = await api("/api/booking?action=admin-user", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
      tenantUsers = tenantUsers.map((item) => item.id === id ? data.user : item);
      renderTenantAdmin();
      toast(status === "approved" ? "Brukeren er godkjent og har fått e-post." : "Tilgangen er oppdatert.");
    } catch (error) { toast(error.message); button.disabled = false; }
  }

  async function deleteTenantBooking(id) {
    const booking = tenantBookings.find((item) => item.id === id);
    if (!booking || !confirm(`Slett «${booking.title}» ${booking.date} kl. ${booking.startTime}? Brukeren får beskjed på e-post.`)) return;
    try {
      await api(`/api/booking?action=admin-booking&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      tenantBookings = tenantBookings.filter((item) => item.id !== id);
      renderTenantAdmin();
      toast("Bookingen er slettet, og brukeren er varslet.");
    } catch (error) { toast(error.message); }
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
    const tenantUpcoming = tenantBookings.filter((booking) => booking.date >= today);
    const now = new Date().toISOString();
    const googleUpcoming = googleEvents.filter((event) => event.endAt >= now);
    const sessions = [...upcoming.map((booking) => ({
      key: `${booking.date}|${booking.startTime}|${String(booking.title || "").toLowerCase()}`,
      date: booking.date,
      startTime: booking.startTime,
      startAt: `${booking.date}T${booking.startTime}:00`,
    })), ...tenantUpcoming.map((booking) => ({
      key: `tenant|${booking.studio}|${booking.date}|${booking.startTime}|${String(booking.title || "").toLowerCase()}`,
      date: booking.date,
      startTime: booking.startTime,
      startAt: `${booking.date}T${booking.startTime}:00`,
    })), ...googleUpcoming.map((event) => ({
      key: `${event.date}|${event.startTime}|${String(event.title || "").toLowerCase()}`,
      date: event.date,
      startTime: event.startTime || "Hele dagen",
      startAt: event.startAt,
    }))];
    const uniqueSessions = [...new Map(sessions.map((session) => [session.key, session])).values()];
    const openQuotes = quotes.filter((quote) => ["Utkast", "Sendt"].includes(quote.status));
    const next = [...uniqueSessions].sort((left, right) => left.startAt.localeCompare(right.startAt))[0];
    document.getElementById("booking-count").textContent = String(uniqueSessions.length);
    document.getElementById("ops-upcoming").textContent = String(uniqueSessions.length);
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
    document.getElementById("refresh-google-calendar").onclick = () => loadGoogleCalendar(true);
    document.getElementById("refresh-tenant-booking").onclick = loadTenantAdmin;
    document.querySelectorAll("[data-tenant-studio]").forEach((button) => {
      button.onclick = () => { selectedTenantStudio = button.dataset.tenantStudio; renderTenantAdmin(); };
    });
    document.getElementById("calendar-previous").onclick = () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1, 12);
      selectedGoogleEvent = "";
      renderGoogleCalendar();
    };
    document.getElementById("calendar-today").onclick = () => {
      const today = new Date();
      calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1, 12);
      selectedGoogleEvent = "";
      renderGoogleCalendar();
    };
    document.getElementById("calendar-next").onclick = () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1, 12);
      selectedGoogleEvent = "";
      renderGoogleCalendar();
    };
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
    const [bookingData, quoteData, tenantData] = await Promise.all([
      api("/api/studio?action=bookings"),
      api("/api/studio?action=quotes"),
      api("/api/booking?action=admin"),
    ]);
    bookings = bookingData.bookings || [];
    quotes = quoteData.quotes || [];
    tenantUsers = tenantData.users || [];
    tenantBookings = tenantData.bookings || [];
    renderBookings();
    renderQuotes();
    renderTenantAdmin();
    await loadGoogleCalendar();
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
