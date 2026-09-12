(() => {
  let tasks = [];
  let notes = [];
  let editingNoteId = null;

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
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
    clearTimeout(window.workspaceToastTimer);
    window.workspaceToastTimer = setTimeout(() => node.classList.remove("show"), 3200);
  };
  const formatDate = (value) => value ? new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "Ingen frist";
  const moneyFromOre = (value) => new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format((Number(value) || 0) / 100);

  function renderTasks() {
    const list = document.getElementById("task-list");
    const open = tasks.filter((task) => !task.completed).length;
    document.getElementById("task-count").textContent = String(open);
    document.getElementById("task-summary").textContent = `${open} åpne · ${tasks.length - open} fullført`;
    const sorted = [...tasks].sort((left, right) => Number(left.completed) - Number(right.completed) || String(left.dueDate || "9999").localeCompare(String(right.dueDate || "9999")));
    list.innerHTML = sorted.length ? sorted.map((task) => `
      <article class="task-row ${task.completed ? "completed" : ""}">
        <input class="task-check" type="checkbox" data-task-toggle="${esc(task.id)}" ${task.completed ? "checked" : ""} aria-label="Marker oppgave som ${task.completed ? "åpen" : "fullført"}">
        <div class="task-copy"><strong>${esc(task.title)}</strong>${task.details ? `<span>${esc(task.details)}</span>` : ""}<div class="task-meta"><em>${esc(task.assignee)}</em><em>${esc(formatDate(task.dueDate))}</em><em class="${task.priority === "Høy" ? "high" : ""}">${esc(task.priority)} prioritet</em></div></div>
        <button class="icon-button" data-task-delete="${esc(task.id)}" aria-label="Slett oppgave">×</button>
      </article>`).join("") : '<div class="empty">Ingen oppgaver ennå.</div>';
    document.querySelectorAll("[data-task-toggle]").forEach((input) => {
      input.onchange = () => updateTask(input.dataset.taskToggle, { completed: input.checked });
    });
    document.querySelectorAll("[data-task-delete]").forEach((button) => {
      button.onclick = () => deleteItem(button.dataset.taskDelete, "oppgaven");
    });
  }

  function renderNotes() {
    const list = document.getElementById("note-list");
    list.innerHTML = notes.length ? notes.map((note) => `
      <article class="note-card">
        <div class="note-card-head"><div><span class="state ${note.type === "møte" ? "blue" : "violet"}">${note.type === "møte" ? "Møtereferat" : "Idé"}</span><h3>${esc(note.title)}</h3><small>${esc(formatDate(note.date))}${note.attendees ? ` · ${esc(note.attendees)}` : ""}</small></div><div class="note-actions"><button class="icon-button" data-note-edit="${esc(note.id)}" aria-label="Rediger notat">✎</button><button class="icon-button" data-note-delete="${esc(note.id)}" aria-label="Slett notat">×</button></div></div>
        <p class="note-content">${esc(note.content)}</p>
      </article>`).join("") : '<div class="empty">Ingen notater eller møtereferater ennå.</div>';
    document.querySelectorAll("[data-note-edit]").forEach((button) => { button.onclick = () => editNote(button.dataset.noteEdit); });
    document.querySelectorAll("[data-note-delete]").forEach((button) => { button.onclick = () => deleteItem(button.dataset.noteDelete, "notatet"); });
  }

  async function updateTask(id, changes) {
    try {
      const data = await api("/api/studio?action=workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, changes }) });
      tasks = tasks.map((task) => task.id === id ? data.item : task);
      renderTasks();
    } catch (error) { toast(error.message); renderTasks(); }
  }

  async function deleteItem(id, label) {
    if (!confirm(`Vil du slette ${label}?`)) return;
    try {
      await api(`/api/studio?action=workspace&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      tasks = tasks.filter((task) => task.id !== id);
      notes = notes.filter((note) => note.id !== id);
      renderTasks();
      renderNotes();
      toast(`${label[0].toUpperCase()}${label.slice(1)} er slettet.`);
    } catch (error) { toast(error.message); }
  }

  function editNote(id) {
    const note = notes.find((item) => item.id === id);
    if (!note) return;
    editingNoteId = id;
    const form = document.getElementById("note-form");
    Object.entries(note).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value || ""; });
    document.getElementById("note-submit").textContent = "Lagre endringer";
    document.getElementById("note-cancel").hidden = false;
    updateMeetingFields();
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function resetNoteForm() {
    editingNoteId = null;
    const form = document.getElementById("note-form");
    form.reset();
    form.elements.date.value = new Date().toISOString().slice(0, 10);
    document.getElementById("note-submit").textContent = "Lagre notat";
    document.getElementById("note-cancel").hidden = true;
    updateMeetingFields();
  }

  function updateMeetingFields() {
    const meeting = document.getElementById("note-type").value === "møte";
    document.getElementById("attendees-field").hidden = !meeting;
  }

  async function loadWorkspace() {
    try {
      const data = await api("/api/studio?action=workspace");
      tasks = data.tasks || [];
      notes = data.notes || [];
      renderTasks();
      renderNotes();
    } catch (error) { toast(error.message); }
  }

  function renderFiken(data) {
    const root = document.getElementById("fiken-content");
    const status = document.getElementById("fiken-status");
    if (!data.connected) {
      status.textContent = "Klar for tilkobling";
      status.className = "state amber";
      root.innerHTML = `<section class="panel"><span class="kicker">ÉNGANGSOPPSETT</span><h2 style="margin:7px 0">Koble Loki CRM til Fiken</h2><p class="notice">Integrasjonen er ferdig bygget, men trenger en personlig API-nøkkel fra Loki Lydstudios Fiken-konto. Nøkkelen skal kun lagres som en hemmelig miljøvariabel i Vercel.</p><div class="setup-steps"><div><strong>1</strong><span>Aktiver API-modulen i Fiken.</span></div><div><strong>2</strong><span>Opprett en personlig API-nøkkel under kontoens API-innstillinger.</span></div><div><strong>3</strong><span>Legg nøkkelen inn som <b>FIKEN_API_TOKEN</b> i Vercel og redeploy.</span></div></div><p class="privacy-note">Tilkoblingen er skrivebeskyttet i CRM-et. Den kan lese foretak, kontakter og fakturaer, men ikke opprette eller endre regnskap.</p></section>`;
      return;
    }
    status.textContent = "Tilkoblet · skrivebeskyttet";
    status.className = "state green";
    const metrics = data.metrics || {};
    root.innerHTML = `<div class="fiken-metrics"><article class="fiken-metric"><span>UBETALTE FAKTURAER</span><strong>${metrics.unpaidCount || 0}</strong></article><article class="fiken-metric"><span>FORFALTE</span><strong>${metrics.overdueCount || 0}</strong></article><article class="fiken-metric"><span>UTESTÅENDE</span><strong>${esc(moneyFromOre(metrics.outstandingOre))}</strong></article><article class="fiken-metric"><span>KONTAKTER HENTET</span><strong>${metrics.contactCount || 0}</strong></article></div><section class="panel table-panel"><div class="invoice-row invoice-head"><span>Nr.</span><span>Kunde</span><span>Fakturadato</span><span>Forfall</span><span>Beløp</span></div>${(data.invoices || []).map((invoice) => `<article class="invoice-row"><strong>${esc(invoice.number)}</strong><span>${esc(invoice.customer)}</span><span>${esc(formatDate(invoice.issueDate))}</span><span><em class="state ${invoice.settled ? "green" : "amber"}">${invoice.settled ? "Betalt" : esc(formatDate(invoice.dueDate))}</em></span><strong>${esc(moneyFromOre(invoice.grossOre))}</strong></article>`).join("") || '<div class="empty">Ingen fakturaer funnet.</div>'}</section><p class="privacy-note">Sist hentet ${esc(new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.fetchedAt)))}. Data vises direkte fra Fiken og lagres ikke i nettleseren.</p>`;
    document.getElementById("fiken-company").textContent = `${data.company.name}${data.company.organizationNumber ? ` · ${data.company.organizationNumber}` : ""}`;
  }

  async function loadFiken() {
    const button = document.getElementById("refresh-fiken");
    button.disabled = true;
    button.textContent = "Henter …";
    try { renderFiken(await api("/api/studio?action=fiken")); }
    catch (error) {
      document.getElementById("fiken-status").textContent = "Tilkoblingsfeil";
      document.getElementById("fiken-status").className = "state red";
      document.getElementById("fiken-content").innerHTML = `<div class="panel empty">${esc(error.message)}</div>`;
    } finally { button.disabled = false; button.textContent = "Oppdater fra Fiken"; }
  }

  function bindForms() {
    document.getElementById("task-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const item = Object.fromEntries(new FormData(form));
        const data = await api("/api/studio?action=workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "task", item }) });
        tasks.unshift(data.item);
        form.reset();
        renderTasks();
        toast("Oppgaven er lagt til.");
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    };
    document.getElementById("note-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const item = Object.fromEntries(new FormData(form));
      const button = document.getElementById("note-submit");
      button.disabled = true;
      try {
        const options = editingNoteId
          ? { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editingNoteId, changes: item }) }
          : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "note", item }) };
        const data = await api("/api/studio?action=workspace", options);
        if (editingNoteId) notes = notes.map((note) => note.id === editingNoteId ? data.item : note);
        else notes.unshift(data.item);
        resetNoteForm();
        renderNotes();
        toast("Notatet er lagret.");
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    };
    document.getElementById("note-type").onchange = updateMeetingFields;
    document.getElementById("note-cancel").onclick = resetNoteForm;
    document.getElementById("refresh-fiken").onclick = loadFiken;
  }

  async function init() {
    bindForms();
    resetNoteForm();
    renderTasks();
    renderNotes();
    await Promise.all([loadWorkspace(), loadFiken()]);
  }

  window.LokiWorkspace = { init };
})();
