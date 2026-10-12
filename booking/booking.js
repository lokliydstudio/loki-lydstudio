(() => {
  let user = null;
  let bookings = [];
  let cursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  let loginEmail = "";
  let editingBookingId = "";

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const localDate = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

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
      const items = bookings.filter((booking) => booking.date === key);
      const outside = date.getMonth() !== cursor.getMonth();
      cells.push(`<button class="day available${outside ? " outside" : ""}${key === today ? " today" : ""}" type="button" data-day="${key}" aria-label="Book ${esc(dateLabel(key))}"><span class="day-number"><span>${date.getDate()}</span></span>${items.slice(0, 3).map((item) => `<span class="day-booking" title="${esc(item.title)}">${esc(item.startTime)} · ${esc(item.title)}</span>`).join("")}${items.length > 3 ? `<span class="day-more">+ ${items.length - 3} til</span>` : ""}</button>`);
    }
    $("calendar-grid").innerHTML = cells.join("");
    document.querySelectorAll("[data-day]").forEach((button) => { button.onclick = () => openBooking(button.dataset.day); });
  }

  function renderAgenda() {
    const today = localDate();
    const visible = bookings.filter((booking) => booking.date >= today).sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
    $("booking-total").textContent = `${visible.length} ${visible.length === 1 ? "booking" : "bookinger"}`;
    $("agenda").innerHTML = visible.length ? visible.map((booking) => {
      const date = shortDate(booking.date);
      return `<article class="agenda-item${booking.editable ? " own-booking" : ""}"><div class="agenda-date"><strong>${esc(date.day)}</strong><span>${esc(date.month)}</span></div><div class="agenda-copy"><strong>${esc(booking.title)}</strong><span>${esc(booking.startTime)}–${esc(booking.endTime)} · ${esc(booking.createdByName)}</span>${booking.notes ? `<span>${esc(booking.notes)}</span>` : ""}</div><div class="agenda-side"><span>${esc(booking.studio)}</span>${booking.editable ? `<div class="agenda-actions"><button class="secondary compact" type="button" data-edit-booking="${esc(booking.id)}">Rediger</button><button class="danger compact" type="button" data-delete-booking="${esc(booking.id)}">Slett</button></div>` : ""}</div></article>`;
    }).join("") : '<div class="empty">Ingen kommende bookinger i dette studioet.</div>';
    document.querySelectorAll("[data-edit-booking]").forEach((button) => {
      button.onclick = () => {
        const booking = bookings.find((item) => item.id === button.dataset.editBooking && item.editable);
        if (booking) openBooking(booking.date, booking);
      };
    });
    document.querySelectorAll("[data-delete-booking]").forEach((button) => {
      button.onclick = () => deleteBooking(button.dataset.deleteBooking);
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

  function openBooking(date = localDate(), booking = null) {
    const form = $("booking-form");
    form.reset();
    editingBookingId = booking?.editable ? booking.id : "";
    form.elements.title.value = booking?.title || "";
    form.elements.date.value = (booking?.date || date) < localDate() ? localDate() : (booking?.date || date);
    form.elements.startTime.value = booking?.startTime || "10:00";
    form.elements.endTime.value = booking?.endTime || "12:00";
    form.elements.notes.value = booking?.notes || "";
    form.elements.date.min = localDate();
    $("booking-title").textContent = editingBookingId ? "Rediger booking" : "Book tid";
    $("booking-submit").textContent = editingBookingId ? "Lagre endringer" : "Bekreft booking";
    $("delete-booking").hidden = !editingBookingId;
    setStatus("", false, "booking-status");
    $("booking-modal").hidden = false;
    form.elements.title.focus();
  }

  function closeBooking() {
    $("booking-modal").hidden = true;
    editingBookingId = "";
  }

  async function deleteBooking(id = editingBookingId) {
    const booking = bookings.find((item) => item.id === id && item.editable);
    if (!booking || !confirm(`Slett «${booking.title}» ${dateLabel(booking.date)} kl. ${booking.startTime}–${booking.endTime}?`)) return;
    const button = $("delete-booking");
    button.disabled = true;
    try {
      await api("calendar", { method: "DELETE", body: JSON.stringify({ id: booking.id }) });
      closeBooking();
      await loadCalendar();
      toast("Bookingen er slettet.");
    } catch (error) {
      if (!$("booking-modal").hidden) setStatus(error.message, true, "booking-status");
      else toast(error.message);
    } finally {
      button.disabled = false;
    }
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
      toast(isEditing ? "Endringene er lagret." : "Bookingen er lagret. Du kan redigere eller slette den fra listen.");
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
  $("delete-booking").onclick = () => deleteBooking();
  $("booking-modal").onclick = (event) => { if (event.target === $("booking-modal")) closeBooking(); };
  $("month-prev").onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1, 12); renderCalendar(); };
  $("month-next").onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12); renderCalendar(); };
  $("month-today").onclick = () => { const now = new Date(); cursor = new Date(now.getFullYear(), now.getMonth(), 1, 12); renderCalendar(); };

  initialize();
})();
