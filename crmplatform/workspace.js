(() => {
  let tasks = [];
  let notes = [];
  let goals = [];
  let editingNoteId = null;
  let editingGoalId = null;
  const expandedTasks = new Set();
  const expandedNotes = new Set();
  let taskAssigneeFilter = "Alle";
  let taskStatusFilter = "open";
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
  const formatBytes = (value) => {
    const bytes = Number(value) || 0;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
    return `${(bytes / 1024 / 1024).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} MB`;
  };
  const moneyFromOre = (value) => new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format((Number(value) || 0) / 100);
  const money = (value) => new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(Number(value) || 0);

  function renderTasks() {
    const list = document.getElementById("task-list");
    const open = tasks.filter((task) => !task.completed).length;
    document.getElementById("task-count").textContent = String(open);
    const statusTasks = tasks.filter((task) => taskStatusFilter === "completed" ? task.completed : !task.completed);
    const visible = taskAssigneeFilter === "Alle" ? statusTasks : statusTasks.filter((task) => task.assignee === taskAssigneeFilter);
    const statusLabel = taskStatusFilter === "completed"
      ? (visible.length === 1 ? "fullført oppgave" : "fullførte oppgaver")
      : (visible.length === 1 ? "åpen oppgave" : "åpne oppgaver");
    document.getElementById("task-summary").textContent = taskAssigneeFilter === "Alle"
      ? `${visible.length} ${statusLabel}`
      : `${visible.length} ${statusLabel} for ${taskAssigneeFilter}`;
    const statusFilters = document.getElementById("task-status-filter");
    statusFilters.querySelectorAll("[data-task-status]").forEach((button) => {
      const active = button.dataset.taskStatus === taskStatusFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.querySelector("strong").textContent = String(button.dataset.taskStatus === "completed" ? tasks.length - open : open);
      button.onclick = () => { taskStatusFilter = button.dataset.taskStatus; renderTasks(); };
    });
    const completedCount = tasks.length - open;
    const completedActions = document.getElementById("task-completed-actions");
    completedActions.hidden = taskStatusFilter !== "completed";
    document.getElementById("task-completed-count").textContent = completedCount === 1
      ? "1 fullført oppgave"
      : `${completedCount} fullførte oppgaver`;
    document.getElementById("task-clear-completed").disabled = completedCount === 0;
    const filters = document.getElementById("task-assignee-filter");
    filters.innerHTML = taskAssigneeFilters.map((assignee) => {
      const count = assignee === "Alle" ? statusTasks.length : statusTasks.filter((task) => task.assignee === assignee).length;
      return `<button class="task-filter-button ${assignee === taskAssigneeFilter ? "active" : ""}" type="button" data-task-filter="${assignee}" aria-pressed="${assignee === taskAssigneeFilter}"><span>${assignee}</span><strong>${count}</strong></button>`;
    }).join("");
    filters.querySelectorAll("[data-task-filter]").forEach((button) => {
      button.onclick = () => { taskAssigneeFilter = button.dataset.taskFilter; renderTasks(); };
    });
    const sorted = [...visible].sort((left, right) => taskStatusFilter === "completed"
      ? String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""))
      : String(left.dueDate || "9999").localeCompare(String(right.dueDate || "9999")));
    list.innerHTML = sorted.length ? sorted.map((task) => {
      const hasDetails = Boolean(task.details);
      const expanded = hasDetails && expandedTasks.has(task.id);
      const summary = `<span class="task-title-line"><strong>${esc(task.title)}</strong>${hasDetails ? '<i aria-hidden="true">⌄</i>' : ""}</span><span class="task-meta"><em>${esc(task.assignee)}</em><em>${esc(formatDate(task.dueDate))}</em><em class="${task.priority === "Høy" ? "high" : ""}">${esc(task.priority)} prioritet</em></span>`;
      return `<article class="task-row ${task.completed ? "completed" : ""} ${expanded ? "expanded" : "collapsed"}">
        <input class="task-check" type="checkbox" data-task-toggle="${esc(task.id)}" ${task.completed ? "checked" : ""} aria-label="Marker oppgave som ${task.completed ? "åpen" : "fullført"}">
        <div class="task-copy">${hasDetails ? `<button class="task-toggle" type="button" data-task-expand="${esc(task.id)}" aria-expanded="${expanded}" aria-controls="task-details-${esc(task.id)}">${summary}</button><span class="task-details" id="task-details-${esc(task.id)}" ${expanded ? "" : "hidden"}>${esc(task.details)}</span>` : `<div class="task-toggle static">${summary}</div>`}</div>
        <button class="icon-button" data-task-delete="${esc(task.id)}" aria-label="Slett oppgave">×</button>
      </article>`;
    }).join("") : `<div class="empty">${taskAssigneeFilter === "Alle" ? `Ingen ${taskStatusFilter === "completed" ? "fullførte" : "åpne"} oppgaver.` : `Ingen ${taskStatusFilter === "completed" ? "fullførte" : "åpne"} oppgaver for «${esc(taskAssigneeFilter)}».`}</div>`;
    document.querySelectorAll("[data-task-expand]").forEach((button) => {
      button.onclick = () => {
        const id = button.dataset.taskExpand;
        if (expandedTasks.has(id)) expandedTasks.delete(id);
        else expandedTasks.add(id);
        renderTasks();
      };
    });
    document.querySelectorAll("[data-task-toggle]").forEach((input) => {
      input.onchange = () => updateTask(input.dataset.taskToggle, { completed: input.checked });
    });
    document.querySelectorAll("[data-task-delete]").forEach((button) => {
      button.onclick = () => deleteItem(button.dataset.taskDelete, "oppgaven");
    });
  }

  function renderNotes() {
    const list = document.getElementById("note-list");
    list.innerHTML = notes.length ? notes.map((note) => {
      const expanded = expandedNotes.has(note.id);
      const attachments = Array.isArray(note.attachments) ? note.attachments : [];
      const attachmentLabel = attachments.length === 1 ? "1 vedlegg" : `${attachments.length} vedlegg`;
      return `<article class="note-card ${expanded ? "expanded" : "collapsed"}">
        <div class="note-card-head"><button class="note-toggle" type="button" data-note-toggle="${esc(note.id)}" aria-expanded="${expanded}" aria-controls="note-detail-${esc(note.id)}"><span><span class="state ${note.type === "møte" ? "blue" : "violet"}">${note.type === "møte" ? "Møtereferat" : "Idé"}</span><h3>${esc(note.title)}</h3><small>${esc(formatDate(note.date))}${note.attendees ? ` · ${esc(note.attendees)}` : ""}${attachments.length ? ` · ${attachmentLabel}` : ""}</small></span><i aria-hidden="true">⌄</i></button><div class="note-actions"><button class="icon-button" data-note-edit="${esc(note.id)}" aria-label="Rediger notat">✎</button><button class="icon-button" data-note-delete="${esc(note.id)}" aria-label="Slett notat">×</button></div></div>
        <div class="note-detail" id="note-detail-${esc(note.id)}" ${expanded ? "" : "hidden"}>${note.content ? `<p class="note-content">${esc(note.content)}</p>` : ""}${attachments.length ? `<div class="note-attachments"><strong>Dokumentvedlegg</strong>${attachments.map((attachment) => { const url = `/api/crm/documents?action=download&amp;id=${encodeURIComponent(attachment.id)}`; return `<div class="note-attachment"><span><b>${esc(attachment.name)}</b><small>${esc(attachment.type)} · ${esc(formatBytes(attachment.size))}</small></span><span class="note-attachment-actions"><a class="tiny-button" href="${url}" target="_blank" rel="noreferrer">Åpne</a><a class="tiny-button" href="${url}&amp;download=1">Last ned</a><button class="tiny-button" type="button" data-note-attachment-remove="${esc(attachment.id)}" data-note-id="${esc(note.id)}">Fjern</button></span></div>`; }).join("")}</div>` : ""}</div>
      </article>`;
    }).join("") : '<div class="empty">Ingen notater eller møtereferater ennå.</div>';
    document.querySelectorAll("[data-note-toggle]").forEach((button) => {
      button.onclick = () => {
        const id = button.dataset.noteToggle;
        if (expandedNotes.has(id)) expandedNotes.delete(id);
        else expandedNotes.add(id);
        renderNotes();
      };
    });
    document.querySelectorAll("[data-note-edit]").forEach((button) => { button.onclick = () => editNote(button.dataset.noteEdit); });
    document.querySelectorAll("[data-note-delete]").forEach((button) => { button.onclick = () => deleteItem(button.dataset.noteDelete, "notatet"); });
    document.querySelectorAll("[data-note-attachment-remove]").forEach((button) => {
      button.onclick = () => removeNoteAttachment(button.dataset.noteId, button.dataset.noteAttachmentRemove);
    });
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

  async function clearCompletedTasks() {
    const completedCount = tasks.filter((task) => task.completed).length;
    if (!completedCount || !confirm(`Vil du slette ${completedCount === 1 ? "den fullførte oppgaven" : `alle ${completedCount} fullførte oppgaver`}? Dette kan ikke angres.`)) return;
    const button = document.getElementById("task-clear-completed");
    button.disabled = true;
    try {
      const data = await api("/api/studio?action=workspace", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "delete-completed-tasks" }),
      });
      const deletedIds = new Set(data.deletedIds || []);
      deletedIds.forEach((id) => expandedTasks.delete(id));
      tasks = tasks.filter((task) => !deletedIds.has(task.id));
      renderTasks();
      toast(`${data.deletedCount || 0} fullførte ${data.deletedCount === 1 ? "oppgave er" : "oppgaver er"} slettet.`);
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }

  async function removeNoteAttachment(noteId, attachmentId) {
    const note = notes.find((item) => item.id === noteId);
    const attachment = note?.attachments?.find((item) => item.id === attachmentId);
    if (!note || !attachment || !confirm(`Fjern «${attachment.name}» fra notatet? Filen beholdes under Dokumenter.`)) return;
    try {
      const attachments = note.attachments.filter((item) => item.id !== attachmentId);
      const data = await api("/api/studio?action=workspace", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: noteId, changes: { attachments } }),
      });
      notes = notes.map((item) => item.id === noteId ? data.item : item);
      renderNotes();
      toast("Vedlegget er fjernet fra notatet og beholdt under Dokumenter.");
    } catch (error) { toast(error.message); }
  }

  async function uploadNoteAttachments(files) {
    if (!files.length) return [];
    if (!window.LokiDocuments?.uploadFiles) throw new Error("Dokumentopplastingen kunne ikke lastes.");
    const progress = document.getElementById("note-upload-progress");
    const bar = progress.querySelector("i");
    const status = document.getElementById("note-upload-status");
    progress.hidden = false;
    bar.style.width = "2%";
    try {
      return await window.LokiDocuments.uploadFiles(files, {
        onProgress: ({ file, index, total, percentage }) => {
          bar.style.width = `${Math.max(2, percentage)}%`;
          status.textContent = `${index + 1} av ${total}: ${file.name} · ${percentage} %`;
        },
      });
    } finally {
      progress.hidden = true;
      bar.style.width = "0";
      status.textContent = "";
    }
  }

  async function deleteItem(id, label) {
    if (!confirm(`Vil du slette ${label}?`)) return;
    try {
      await api(`/api/studio?action=workspace&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (window.LokiNoteLive?.active(id)) resetNoteForm();
      expandedTasks.delete(id);
      expandedNotes.delete(id);
      tasks = tasks.filter((task) => task.id !== id);
      notes = notes.filter((note) => note.id !== id);
      goals = goals.filter((goal) => goal.id !== id);
      renderTasks();
      renderNotes();
      renderGoals();
      toast(`${label[0].toUpperCase()}${label.slice(1)} er slettet.`);
    } catch (error) { toast(error.message); }
  }

  async function editNote(id) {
    const note = notes.find((item) => item.id === id);
    if (!note) return;
    if (editingNoteId && editingNoteId !== id && window.LokiNoteLive?.active(editingNoteId)) {
      try { await window.LokiNoteLive.flush(); }
      catch (error) { toast(`Notatet er ikke lagret: ${error.message}`); return; }
    }
    editingNoteId = id;
    const form = document.getElementById("note-form");
    Object.entries(note).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value || ""; });
    document.getElementById("note-submit").textContent = "Lagre detaljer";
    document.getElementById("note-cancel").hidden = false;
    updateMeetingFields();
    window.LokiNoteLive?.open(id);
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function resetNoteForm() {
    window.LokiNoteLive?.close();
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
      const files = [...document.getElementById("note-attachments").files];
      const button = document.getElementById("note-submit");
      button.disabled = true;
      if (editingNoteId) form.elements.content.readOnly = true;
      try {
        const existingAttachments = editingNoteId
          ? notes.find((note) => note.id === editingNoteId)?.attachments || []
          : [];
        if (existingAttachments.length + files.length > 20) throw new Error("Et notat kan ha maksimalt 20 dokumentvedlegg.");
        if (!String(item.content || "").trim() && !files.length && !existingAttachments.length) {
          throw new Error("Skriv innhold eller legg ved minst ett dokument.");
        }
        if (files.length) {
          const uploaded = await uploadNoteAttachments(files);
          item.attachments = [...existingAttachments, ...uploaded.map((document) => ({
            id: document.id,
            name: document.name,
            type: document.type,
            size: document.size,
          }))];
        }
        if (editingNoteId) {
          if (!window.LokiNoteLive?.active(editingNoteId)) throw new Error("Felles redigering er ikke tilkoblet. Åpne notatet på nytt.");
          await window.LokiNoteLive.flush();
          delete item.content;
        }
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
      finally {
        button.disabled = false;
        if (window.LokiNoteLive?.active(editingNoteId)) form.elements.content.readOnly = false;
      }
    };
    document.getElementById("note-type").onchange = updateMeetingFields;
    document.getElementById("note-attachments").onchange = (event) => {
      const first = event.currentTarget.files[0];
      const title = document.querySelector('#note-form input[name="title"]');
      if (first && !title.value.trim()) title.value = first.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
    };
    document.getElementById("task-clear-completed").onclick = clearCompletedTasks;
    document.getElementById("note-cancel").onclick = async () => {
      try {
        if (editingNoteId && window.LokiNoteLive?.active(editingNoteId)) await window.LokiNoteLive.flush();
        resetNoteForm();
      } catch (error) { toast(`Notatet er ikke lagret: ${error.message}`); }
    };
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
    window.addEventListener("loki-note-content", (event) => {
      const { id, content } = event.detail || {};
      if (!id) return;
      notes = notes.map((note) => note.id === id ? { ...note, content } : note);
      renderNotes();
    });
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
