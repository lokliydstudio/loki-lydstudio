(() => {
  let tasks = [];
  let notes = [];
  let goals = [];
  let editingNoteId = null;
  let editingGoalId = null;
  let taskAssigneeFilter = "Alle";
  const taskAssigneeFilters = ["Alle", "Leon", "Charles", "Begge"];

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
  const money = (value) => new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(Number(value) || 0);

  function renderTasks() {
    const list = document.getElementById("task-list");
    const open = tasks.filter((task) => !task.completed).length;
    document.getElementById("task-count").textContent = String(open);
    const visible = taskAssigneeFilter === "Alle" ? tasks : tasks.filter((task) => task.assignee === taskAssigneeFilter);
    const visibleOpen = visible.filter((task) => !task.completed).length;
    document.getElementById("task-summary").textContent = taskAssigneeFilter === "Alle"
      ? `${open} åpne · ${tasks.length - open} fullført`
      : `${visibleOpen} åpne for ${taskAssigneeFilter} · ${visible.length - visibleOpen} fullført`;
    const filters = document.getElementById("task-assignee-filter");
    filters.innerHTML = taskAssigneeFilters.map((assignee) => {
      const count = assignee === "Alle" ? tasks.length : tasks.filter((task) => task.assignee === assignee).length;
      return `<button class="task-filter-button ${assignee === taskAssigneeFilter ? "active" : ""}" type="button" data-task-filter="${assignee}" aria-pressed="${assignee === taskAssigneeFilter}"><span>${assignee}</span><strong>${count}</strong></button>`;
    }).join("");
    filters.querySelectorAll("[data-task-filter]").forEach((button) => {
      button.onclick = () => { taskAssigneeFilter = button.dataset.taskFilter; renderTasks(); };
    });
    const sorted = [...visible].sort((left, right) => Number(left.completed) - Number(right.completed) || String(left.dueDate || "9999").localeCompare(String(right.dueDate || "9999")));
    list.innerHTML = sorted.length ? sorted.map((task) => `
      <article class="task-row ${task.completed ? "completed" : ""}">
        <input class="task-check" type="checkbox" data-task-toggle="${esc(task.id)}" ${task.completed ? "checked" : ""} aria-label="Marker oppgave som ${task.completed ? "åpen" : "fullført"}">
        <div class="task-copy"><strong>${esc(task.title)}</strong>${task.details ? `<span>${esc(task.details)}</span>` : ""}<div class="task-meta"><em>${esc(task.assignee)}</em><em>${esc(formatDate(task.dueDate))}</em><em class="${task.priority === "Høy" ? "high" : ""}">${esc(task.priority)} prioritet</em></div></div>
        <button class="icon-button" data-task-delete="${esc(task.id)}" aria-label="Slett oppgave">×</button>
      </article>`).join("") : `<div class="empty">${taskAssigneeFilter === "Alle" ? "Ingen oppgaver ennå." : `Ingen oppgaver med ansvarlig «${esc(taskAssigneeFilter)}».`}</div>`;
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

  function renderGoals() {
    const active = goals.filter((goal) => !goal.completed).length;
    document.getElementById("goal-summary").textContent = `${active} aktive · ${goals.length - active} fullført`;
    const sorted = [...goals].sort((left, right) => Number(left.completed) - Number(right.completed) || String(left.targetDate || "9999").localeCompare(String(right.targetDate || "9999")));
    document.getElementById("goal-list").innerHTML = sorted.length ? sorted.map((goal) => {
      const progress = Math.max(0, Math.min(100, Number(goal.progress) || 0));
      return `<article class="goal-card ${goal.completed ? "completed" : ""}">
        <div class="goal-card-head"><div><span class="state ${goal.completed ? "green" : goal.type === "Milepæl" ? "violet" : "amber"}">${goal.completed ? "Fullført" : esc(goal.type)}</span><h3>${esc(goal.title)}</h3></div><div class="goal-card-actions"><button class="icon-button" data-goal-edit="${esc(goal.id)}" aria-label="Rediger mål">✎</button><button class="icon-button" data-goal-delete="${esc(goal.id)}" aria-label="Slett mål">×</button></div></div>
        <div class="goal-amount"><strong>${esc(money(goal.currentAmount))}</strong><span>av ${esc(money(goal.targetAmount))}</span><b>${progress}%</b></div>
        <div class="goal-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" aria-label="${esc(goal.title)}"><i style="width:${progress}%"></i></div>
        <div class="goal-foot"><span>${goal.targetDate ? `Måldato ${esc(formatDate(goal.targetDate))}` : "Ingen måldato"}</span>${goal.note ? `<span>${esc(goal.note)}</span>` : ""}</div>
      </article>`;
    }).join("") : '<div class="empty">Ingen interne mål ennå. Legg til et sparemål eller en milepæl over.</div>';
    document.querySelectorAll("[data-goal-edit]").forEach((button) => { button.onclick = () => editGoal(button.dataset.goalEdit); });
    document.querySelectorAll("[data-goal-delete]").forEach((button) => { button.onclick = () => deleteItem(button.dataset.goalDelete, "målet"); });
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
      goals = goals.filter((goal) => goal.id !== id);
      renderTasks();
      renderNotes();
      renderGoals();
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

  function editGoal(id) {
    const goal = goals.find((item) => item.id === id);
    if (!goal) return;
    editingGoalId = id;
    const form = document.getElementById("goal-form");
    Object.entries(goal).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ""; });
    document.getElementById("goal-submit").textContent = "Lagre endringer";
    document.getElementById("goal-cancel").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function resetGoalForm() {
    editingGoalId = null;
    const form = document.getElementById("goal-form");
    form.reset();
    form.elements.currentAmount.value = "0";
    document.getElementById("goal-submit").textContent = "+ Legg til mål";
    document.getElementById("goal-cancel").hidden = true;
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
      goals = data.goals || [];
      renderTasks();
      renderNotes();
      renderGoals();
    } catch (error) { toast(error.message); }
  }

  function renderFiken(data) {
    const root = document.getElementById("fiken-content");
    const status = document.getElementById("fiken-status");
    if (!data.connected) {
      status.textContent = data.authorizationRequired ? "Klar for godkjenning" : "Klar for tilkobling";
      status.className = "state amber";
      if (data.authorizationRequired) {
        root.innerHTML = `<section class="panel"><span class="kicker">SIKKER TILKOBLING</span><h2 style="margin:7px 0">Godkjenn Loki CRM i Fiken</h2><p class="notice">Fiken-appen er konfigurert. Fullfør én godkjenning for å gi CRM-et skrivebeskyttet tilgang til foretak, kontakter og fakturaer.</p><div class="button-row" style="margin-top:16px"><button class="primary" id="connect-fiken">Koble til Fiken</button></div><p class="privacy-note">Tilgangs- og fornyelsesnøkkelen lagres kryptert i den private CRM-lagringen og sendes aldri til nettleseren.</p></section>`;
        document.getElementById("connect-fiken").onclick = () => { location.assign("/api/studio?action=fiken-connect"); };
      } else {
        root.innerHTML = `<section class="panel"><span class="kicker">ÉNGANGSOPPSETT</span><h2 style="margin:7px 0">Koble Loki CRM til Fiken</h2><p class="notice">Integrasjonen er ferdig bygget for OAuth 2.0, men Fiken-appens Client ID og Client Secret må først legges inn som hemmelige miljøvariabler i Vercel.</p><div class="setup-steps"><div><strong>1</strong><span>Opprett appen «Loki CRM» i Fiken.</span></div><div><strong>2</strong><span>Lagre klientopplysningene som <b>FIKEN_CLIENT_ID</b> og <b>FIKEN_CLIENT_SECRET</b> i Vercel.</span></div><div><strong>3</strong><span>Godkjenn skrivebeskyttet visning fra denne siden.</span></div></div><p class="privacy-note">CRM-et bruker bare GET-kall mot Fiken og kan ikke opprette eller endre regnskap.</p></section>`;
      }
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
    document.getElementById("goal-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const item = Object.fromEntries(new FormData(form));
      const button = document.getElementById("goal-submit");
      button.disabled = true;
      try {
        const options = editingGoalId
          ? { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editingGoalId, changes: item }) }
          : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "goal", item }) };
        const data = await api("/api/studio?action=workspace", options);
        if (editingGoalId) goals = goals.map((goal) => goal.id === editingGoalId ? data.item : goal);
        else goals.unshift(data.item);
        resetGoalForm();
        renderGoals();
        toast("Det interne målet er lagret.");
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    };
    document.getElementById("goal-cancel").onclick = resetGoalForm;
    document.getElementById("refresh-fiken").onclick = loadFiken;
  }

  async function init() {
    bindForms();
    resetNoteForm();
    resetGoalForm();
    renderTasks();
    renderNotes();
    renderGoals();
    await Promise.all([loadWorkspace(), loadFiken()]);
  }

  window.LokiWorkspace = { init, reload: loadWorkspace };
})();
