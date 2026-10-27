(() => {
  let user = null;
  let bookings = [];
  let cursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  let loginEmail = "";
  let editingBookingId = "";
  let deletingBookingId = "";

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const localDate = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  function applyTheme(theme, persist = false) {
    const dark = theme === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "Bytt til lyst tema" : "Bytt til mørkt tema");
      button.querySelector("[data-theme-icon]").textContent = dark ? "☀" : "☾";
      button.querySelector("[data-theme-label]").textContent = dark ? "Lyst tema" : "Mørkt tema";
    });
    document.querySelector('meta[name="theme-color"]').content = dark ? "#171715" : "#20201d";
    if (persist) try { localStorage.setItem("loki_booking_theme", dark ? "dark" : "light"); } catch {}
  }

  async function api(action, options = {}) {
    const response = await fetch(`/api/studio?action=tenant-${encodeURIComponent(action)}`, {
      credentials: "same-origin",
      ...options,
      headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Handlingen kunne ikke fullføres.");
    return data;
  }

  function setStatus(message, error = false, target = "auth-status") {
    const node = $(target);
    node.textContent = message || "";
    node.classList.toggle("error", error);
  }

  function toast(message) {
    const node = $("toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(window.lokiBookingToast);
    window.lokiBookingToast = setTimeout(() => node.classList.remove("show"), 4000);
  }

  function showAuth(view = "login") {
    $("portal").hidden = true;
    $("auth-shell").hidden = false;
    $("login-view").hidden = view !== "login";
    $("register-view").hidden = view !== "register";
    setStatus("");
  }

  function showPortal() {
    $("auth-shell").hidden = true;
    $("portal").hidden = false;
    $("user-name").textContent = user.name;
    $("user-studio").textContent = user.studio;
    $("calendar-heading").textContent = `${user.studio}-kalender`;
    $("booking-studio-label").textContent = user.studio.toUpperCase();
    $("booking-email-alerts").checked = user.emailOnNewBooking === true;
    $("booking-email-description").textContent = `Send meg e-post når noen oppretter en ny booking i ${user.studio}.`;
    $("booking-preference-status").textContent = "";
  }

  function dateLabel(value) {
    return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
  }

  function shortDate(value) {
    const date = new Date(`${value}T12:00:00`);
    return {
      day: new Intl.DateTimeFormat("nb-NO", { day: "2-digit" }).format(date),
      month: new Intl.DateTimeFormat("nb-NO", { month: "short" }).format(date).replace(".", "").toUpperCase(),
    };
  }

  function monthBookings() {
    const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    return bookings.filter((booking) => booking.date.startsWith(month));
  }

  function renderCalendar() {
    $("month-title").textContent = new Intl.DateTimeFormat("nb-NO", { month: "long", year: "numeric" }).format(cursor);
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - offset, 12);
    const today = localDate();
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12);
      const key = localDate(date);
      const items = bookings.filter((booking) => booking.date === key).sort((a, b) => a.startTime.localeCompare(b.startTime));
      const outside = date.getMonth() !== cursor.getMonth();
      cells.push(`<section class="day${outside ? " outside" : ""}${key === today ? " today" : ""}" aria-label="${esc(dateLabel(key))}"><button class="day-create" type="button" data-day="${key}" aria-label="Book ny tid ${esc(dateLabel(key))}" ${key < today ? "disabled" : ""}><span class="day-number"><span>${date.getDate()}</span></span><span class="day-add" aria-hidden="true">+</span></button><div class="day-events">${items.map((item) => `<button class="day-booking${item.editable ? " own" : ""}" type="button" data-calendar-booking="${esc(item.id)}" title="${esc(item.title)} · ${esc(item.startTime)}–${esc(item.endTime)} · ${esc(item.createdByName)}" aria-label="${esc(item.title)}, ${esc(item.startTime)} til ${esc(item.endTime)}${item.editable ? ", din booking, åpne for å redigere eller slette" : item.deletable ? ", åpne for å slette" : ", åpne detaljer"}"><span class="day-booking-time">${esc(item.startTime)}–${esc(item.endTime)}</span><span class="day-booking-title">${esc(item.title)}</span><span class="day-booking-owner">${esc(item.createdByName)}</span></button>`).join("")}</div></section>`);
    }
    $("calendar-grid").innerHTML = cells.join("");
    document.querySelectorAll("[data-day]").forEach((button) => { button.onclick = () => openBooking(button.dataset.day); });
    document.querySelectorAll("[data-calendar-booking]").forEach((button) => {
      button.classList.toggle("staff", Boolean(bookings.find((item) => item.id === button.dataset.calendarBooking)?.staffBooking));
      button.onclick = () => openExistingBooking(button.dataset.calendarBooking);
    });
  }

  function renderAgenda() {
    const today = localDate();
    const visible = bookings.filter((booking) => booking.date >= today).sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
    $("booking-total").textContent = `${visible.length} ${visible.length === 1 ? "booking" : "bookinger"}`;
    $("agenda").innerHTML = visible.length ? visible.map((booking) => {
      const date = shortDate(booking.date);
      return `<button class="agenda-item${booking.editable ? " own-booking" : ""}" type="button" data-view-booking="${esc(booking.id)}" aria-label="${esc(booking.title)}, ${esc(dateLabel(booking.date))} klokken ${esc(booking.startTime)} til ${esc(booking.endTime)}"><span class="agenda-date"><strong>${esc(date.day)}</strong><span>${esc(date.month)}</span></span><span class="agenda-copy"><strong>${esc(booking.title)}</strong><span>${esc(booking.startTime)}–${esc(booking.endTime)} · ${esc(booking.createdByName)}</span></span><span class="agenda-side">${booking.editable ? "Din booking · Rediger eller slett" : booking.deletable ? "Åpne · Kan slettes" : "Vis detaljer"}</span></button>`;
    }).join("") : '<div class="empty">Ingen kommende bookinger i dette studioet.</div>';
    document.querySelectorAll("[data-view-booking]").forEach((button) => {
      button.classList.toggle("staff", Boolean(bookings.find((item) => item.id === button.dataset.viewBooking)?.staffBooking));
      button.onclick = () => openExistingBooking(button.dataset.viewBooking);
    });
  }

  function render() {
    renderCalendar();
    renderAgenda();
  }

  async function loadCalendar() {
    const data = await api("calendar");
    bookings = data.bookings || [];
    render();
  }

  function openExistingBooking(id) {
    const booking = bookings.find((item) => item.id === id);
    if (booking) openBooking(booking.date, booking);
  }

  function openBooking(date = localDate(), booking = null) {
    const form = $("booking-form");
    form.reset();
    const canEdit = Boolean(booking?.editable && booking.date >= localDate());
    const canDelete = Boolean(booking?.deletable);
    editingBookingId = canEdit ? booking.id : "";
    deletingBookingId = canDelete ? booking.id : "";
    form.querySelectorAll("input, textarea").forEach((field) => { field.disabled = Boolean(booking && !canEdit); });
    form.elements.title.value = booking?.title || "";
    form.elements.date.value = booking?.date || (date < localDate() ? localDate() : date);
    form.elements.startTime.value = booking?.startTime || "10:00";
    form.elements.endTime.value = booking?.endTime || "12:00";
    form.elements.notes.value = booking?.notes || "";
    form.elements.date.min = booking && !canEdit ? "" : localDate();
    $("booking-title").textContent = booking ? (canEdit ? "Rediger booking" : "Bookingdetaljer") : "Book tid";
    $("booking-submit").textContent = editingBookingId ? "Lagre endringer" : "Bekreft booking";
    $("booking-submit").hidden = Boolean(booking && !canEdit);
    $("booking-delete").hidden = !canDelete;
    $("booking-info").textContent = booking ? (canEdit ? `Opprettet av ${booking.createdByName}. Du kan endre eller slette bookingen.` : canDelete ? `Opprettet av ${booking.createdByName}. ${booking.date < localDate() ? "Tidligere bookinger kan ikke endres." : "Bare den som opprettet bookingen, eller admin i CRM, kan endre den."} Du kan slette denne bookingen.` : booking.date < localDate() ? "Tidligere bookinger kan ikke endres." : `Opprettet av ${booking.createdByName}. Bare personen som opprettet bookingen, og Loki Lydstudio, kan endre eller slette den.`) : "Velg en ledig tid. Trykk på en eksisterende booking i kalenderen for å se den.";
    setStatus("", false, "booking-status");
    $("booking-modal").hidden = false;
    (booking && !canEdit ? $("close-modal") : form.elements.title).focus();
  }

  function closeBooking() {
    $("booking-modal").hidden = true;
    editingBookingId = "";
    deletingBookingId = "";
  }

  async function initialize() {
    try {
      const data = await api("session");
      user = data.user;
      showPortal();
      await loadCalendar();
    } catch {
      showAuth();
    }
  }

  $("login-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    loginEmail = String(form.elements.email.value || "").trim().toLowerCase();
    button.disabled = true;
    setStatus("Sender kode …");
    try {
      await api("request-code", { method: "POST", body: JSON.stringify({ email: loginEmail }) });
      form.hidden = true;
      $("code-form").hidden = false;
      setStatus(`Hvis adressen har godkjent tilgang, er koden sendt til ${loginEmail}.`);
      $("code-form").elements.code.focus();
    } catch (error) { setStatus(error.message, true); }
    finally { button.disabled = false; }
  };

  $("code-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const data = await api("verify-code", { method: "POST", body: JSON.stringify({ email: loginEmail, code: form.elements.code.value }) });
      user = data.user;
      showPortal();
      await loadCalendar();
    } catch (error) { setStatus(error.message, true); }
    finally { button.disabled = false; }
  };

  $("register-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus("Sender søknad …");
    try {
      const values = Object.fromEntries(new FormData(form));
      const data = await api("register", { method: "POST", body: JSON.stringify(values) });
      form.reset();
      setStatus(data.message || "Søknaden er sendt.");
    } catch (error) { setStatus(error.message, true); }
    finally { button.disabled = false; }
  };

  $("booking-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus("Lagrer og kontrollerer tidspunktet …", false, "booking-status");
    try {
      const changes = Object.fromEntries(new FormData(form));
      const isEditing = Boolean(editingBookingId);
      await api("calendar", {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify(isEditing ? { id: editingBookingId, changes } : { booking: changes }),
      });
      closeBooking();
      await loadCalendar();
      toast(isEditing ? "Endringene er lagret." : "Bookingen er lagret. Trykk på den i kalenderen for å redigere.");
    } catch (error) { setStatus(error.message, true, "booking-status"); }
    finally { button.disabled = false; }
  };

  $("show-register").onclick = () => showAuth("register");
  $("show-login").onclick = () => showAuth("login");
  $("change-email").onclick = () => {
    $("code-form").hidden = true;
    $("login-form").hidden = false;
    setStatus("");
  };
  $("logout").onclick = async () => { await api("logout", { method: "POST" }).catch(() => {}); user = null; showAuth(); };
  $("new-booking").onclick = () => openBooking();
  $("close-modal").onclick = closeBooking;
  $("cancel-modal").onclick = closeBooking;
  $("booking-delete").onclick = async () => {
    const id = deletingBookingId;
    const booking = bookings.find((item) => item.id === id);
    if (!booking || !window.confirm(`Vil du slette bookingen «${booking.title}» ${dateLabel(booking.date)} kl. ${booking.startTime}–${booking.endTime}? Dette kan ikke angres.`)) return;
    const button = $("booking-delete");
    button.disabled = true;
    setStatus("Sletter booking …", false, "booking-status");
    try {
      await api("calendar", { method: "DELETE", body: JSON.stringify({ id }) });
      closeBooking();
      try {
        await loadCalendar();
        toast("Bookingen er slettet.");
      } catch {
        toast("Bookingen er slettet. Oppdater siden for å se den nye kalenderen.");
      }
    } catch (error) {
      setStatus(error.message, true, "booking-status");
    } finally {
      button.disabled = false;
    }
  };
  $("booking-modal").onclick = (event) => { if (event.target === $("booking-modal")) closeBooking(); };
  $("month-prev").onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1, 12); renderCalendar(); };
  $("month-next").onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12); renderCalendar(); };
  $("month-today").onclick = () => { const now = new Date(); cursor = new Date(now.getFullYear(), now.getMonth(), 1, 12); renderCalendar(); };

  $("booking-email-alerts").onchange = async (event) => {
    const checkbox = event.currentTarget;
    const enabled = checkbox.checked;
    const status = $("booking-preference-status");
    checkbox.disabled = true;
    status.classList.remove("error");
    status.textContent = "Lagrer …";
    try {
      const data = await api("preferences", { method: "PATCH", body: JSON.stringify({ emailOnNewBooking: enabled }) });
      user = data.user;
      checkbox.checked = user.emailOnNewBooking === true;
      status.textContent = enabled ? "E-postvarsler er på." : "E-postvarsler er av.";
    } catch (error) {
      checkbox.checked = !enabled;
      status.classList.add("error");
      status.textContent = error.message;
    } finally {
      checkbox.disabled = false;
    }
  };

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
  });
  applyTheme(document.documentElement.dataset.theme);

  initialize();
})();
