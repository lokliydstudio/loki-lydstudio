(() => {
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  function setValue(form, name, value) {
    if (form.elements[name]) form.elements[name].value = value ?? "";
  }

  function init({ getLeads, setLeads, renderAll, toast, onStageChange = () => {} }) {
    const modal = document.getElementById("lead-modal");
    const form = document.getElementById("lead-form");
    const title = document.getElementById("modal-title");
    const subtitle = document.getElementById("lead-profile-subtitle");
    const source = document.getElementById("lead-email-source");
    const preview = document.getElementById("lead-email-preview");
    const enrichmentState = document.getElementById("lead-enrichment-state");
    const submit = document.getElementById("lead-submit");
    const quickActions = document.getElementById("lead-quick-actions");
    const timeline = document.getElementById("lead-timeline");
    const activityList = document.getElementById("lead-activity-list");
    const activityForm = document.getElementById("lead-activity-form");
    let activeLead = null;

    function close() {
      modal.classList.remove("open");
    }

    function openNew() {
      activeLead = null;
      form.reset();
      setValue(form, "id", "");
      setValue(form, "messageUid", "");
      setValue(form, "stage", "Nytt lead");
      setValue(form, "nextAction", "Ta første kontakt");
      source.hidden = true;
      quickActions.hidden = true;
      timeline.hidden = true;
      preview.value = "";
      title.textContent = "Nytt lead";
      subtitle.textContent = "Legg inn kontakt- og prosjektinformasjon.";
      submit.textContent = "Legg til lead";
      modal.classList.add("open");
      form.elements.name.focus();
    }

    function populate(lead) {
      ["id", "messageUid", "name", "email", "phone", "role", "artistName", "company", "website", "social", "location", "stage", "project", "value", "nextAction", "assignee", "followUpDate", "preferredContact", "lostReason", "notes", "emailSummary"].forEach((field) => setValue(form, field, lead[field]));
      setValue(form, "stage", lead.stage || "Nytt lead");
      setValue(form, "nextAction", lead.nextAction || "Ta første kontakt");
      setValue(form, "assignee", lead.assignee || "Begge");
      setValue(form, "preferredContact", lead.preferredContact || "E-post");
      source.hidden = !lead.emailSummary && !lead.messageUid;
      preview.value = lead.emailSummary || "";
    }

    function applyEnrichment(enrichment = {}) {
      const currentName = String(form.elements.name.value || "").trim();
      const currentEmail = String(form.elements.email.value || "").trim();
      const currentProject = String(form.elements.project.value || "").trim();
      if (enrichment.email && (!currentEmail || /@formspree\.io$/i.test(currentEmail))) setValue(form, "email", enrichment.email);
      if (enrichment.name && (!currentName || currentName.includes("@") || currentName.toLowerCase() === currentEmail.toLowerCase())) setValue(form, "name", enrichment.name);
      if (enrichment.project && (!currentProject || /^(?:ny melding fra kontaktskjema|new submission|ny henvendelse)$/i.test(currentProject))) setValue(form, "project", enrichment.project);
      ["phone", "role", "artistName", "company", "website", "social", "location"].forEach((field) => {
        if (!form.elements[field].value && enrichment[field]) setValue(form, field, enrichment[field]);
      });
    }

    async function loadSourceEmail(lead) {
      if (!lead.messageUid || lead.emailSummary) return;
      source.hidden = false;
      preview.value = "Henter original henvendelse …";
      enrichmentState.textContent = "Analyserer";
      enrichmentState.className = "state amber";
      try {
        const response = await fetch(`/api/crm/mailbox?uid=${encodeURIComponent(lead.messageUid)}`, { credentials: "same-origin" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Kunne ikke hente e-posten.");
        preview.value = data.message?.summary || "E-posten inneholdt ingen lesbar tekst.";
        applyEnrichment(data.message?.enrichment);
        enrichmentState.textContent = "Automatisk utfylt";
        enrichmentState.className = "state green";
      } catch (error) {
        preview.value = lead.emailSummary || "Originalmeldingen er ikke lenger tilgjengelig i innboksen.";
        enrichmentState.textContent = "Kilde utilgjengelig";
        enrichmentState.className = "state amber";
      }
    }

    async function openLead(id) {
      const lead = getLeads().find((item) => item.id === id);
      if (!lead) return;
      activeLead = lead;
      form.reset();
      populate(lead);
      title.textContent = lead.profileCompleted ? lead.name : "Kompletter leadprofil";
      subtitle.innerHTML = `${esc(lead.source || "Manuelt")} · ${esc(lead.email)}`;
      submit.textContent = lead.profileCompleted ? "Lagre endringer" : "Legg til som lead";
      enrichmentState.textContent = lead.emailSummary ? "Lagret fra e-post" : "Henter kilde";
      enrichmentState.className = lead.emailSummary ? "state green" : "state amber";
      quickActions.hidden = false;
      timeline.hidden = false;
      modal.classList.add("open");
      await Promise.all([loadSourceEmail(lead), loadActivities(lead.id)]);
    }

    function renderActivities(activities) {
      activityList.className = "lead-activity-list";
      activityList.innerHTML = activities.length ? activities.map((activity) => {
        const author = String(activity.createdBy || "").startsWith("charles") ? "Charles" : "Leon";
        const when = new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(activity.occurredAt));
        return `<article class="activity-row"><i></i><span><strong>${esc(activity.type)} · ${esc(author)}</strong>${esc(activity.details)}</span><time>${esc(when)}</time></article>`;
      }).join("") : '<div class="empty">Ingen aktiviteter logget ennå.</div>';
    }

    async function loadActivities(leadId) {
      activityList.innerHTML = '<div class="loading-message">Henter kundehistorikk …</div>';
      try {
        const response = await fetch(`/api/studio?action=activities&leadId=${encodeURIComponent(leadId)}`, { credentials: "same-origin" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Kunne ikke hente kundehistorikken.");
        renderActivities(data.activities || []);
      } catch (error) { activityList.innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
    }

    function bindRows() {
      document.querySelectorAll("[data-open-lead]").forEach((row) => {
        row.onclick = (event) => {
          if (event.target.closest("[data-advance]")) return;
          openLead(row.dataset.openLead);
        };
        row.onkeydown = (event) => {
          if (event.target !== row || !["Enter", " "].includes(event.key)) return;
          event.preventDefault();
          openLead(row.dataset.openLead);
        };
      });
    }

    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const id = String(values.id || "");
      const duplicate = !id && getLeads().find((item) => String(item.email || "").toLowerCase() === String(values.email || "").toLowerCase());
      if (duplicate) {
        toast("Denne e-postadressen finnes allerede. Eksisterende kundeprofil åpnes.");
        return openLead(duplicate.id);
      }
      const lead = {
        name: values.name,
        email: values.email,
        phone: values.phone,
        role: values.role,
        artistName: values.artistName,
        company: values.company,
        website: values.website,
        social: values.social,
        location: values.location,
        stage: values.stage,
        project: values.project,
        value: Number(values.value) || 0,
        nextAction: values.nextAction,
        assignee: values.assignee,
        followUpDate: values.followUpDate,
        preferredContact: values.preferredContact,
        lostReason: values.lostReason,
        notes: values.notes,
        emailSummary: values.emailSummary,
        messageUid: Number(values.messageUid) || 0,
        profileCompleted: true,
      };
      submit.disabled = true;
      submit.textContent = "Lagrer …";
      try {
        const response = await fetch("/api/crm/leads", {
          method: id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(id ? { id, changes: lead } : { action: "upsertMany", leads: [{ ...lead, source: "Manuelt" }] }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Leadet kunne ikke lagres.");
        if (id) setLeads(getLeads().map((item) => item.id === id ? data.lead : item));
        else setLeads(data.leads || getLeads());
        onStageChange(lead.stage);
        close();
        renderAll();
        toast(id ? "Leadprofilen er oppdatert." : "Leadet er lagt til.");
      } catch (error) {
        toast(error.message || "Leadet kunne ikke lagres.");
      } finally {
        submit.disabled = false;
        submit.textContent = id ? "Lagre endringer" : "Legg til lead";
      }
    };

    document.getElementById("new-lead").onclick = openNew;
    document.getElementById("close-modal").onclick = close;
    document.getElementById("cancel-modal").onclick = close;
    document.getElementById("lead-create-task").onclick = () => activeLead && window.LokiOperations?.createFollowupTask(activeLead);
    document.getElementById("lead-create-quote").onclick = () => activeLead && window.LokiOperations?.openQuote(activeLead);
    document.getElementById("lead-create-booking").onclick = () => activeLead && window.LokiOperations?.openBooking(activeLead);
    document.getElementById("lead-create-project").onclick = () => activeLead && window.LokiOperations?.createProjectForLead(activeLead);
    document.getElementById("lead-delete").onclick = async () => {
      if (!activeLead || !confirm(`Slett «${activeLead.name}» permanent fra CRM?\n\nKundehistorikk, tilknyttede bookinger og tilbud slettes også. E-poster beholdes, men kontakten filtreres fra kunderelasjonene. Dokumenter og studioprosjekter påvirkes ikke.`)) return;
      const button = document.getElementById("lead-delete");
      button.disabled = true;
      try {
        const response = await fetch(`/api/crm/leads?id=${encodeURIComponent(activeLead.id)}`, { method: "DELETE", credentials: "same-origin" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Kunden kunne ikke slettes.");
        setLeads(getLeads().filter((item) => item.id !== activeLead.id));
        close();
        renderAll();
        await window.LokiOperations?.reload?.();
        toast("Kunderelasjonen og tilknyttet historikk er slettet.");
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    };
    activityForm.onsubmit = async (event) => {
      event.preventDefault();
      if (!activeLead) return;
      const button = activityForm.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const activity = { ...Object.fromEntries(new FormData(activityForm)), leadId: activeLead.id };
        const response = await fetch("/api/studio?action=activities", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ activity }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Aktiviteten kunne ikke lagres.");
        activityForm.reset();
        await loadActivities(activeLead.id);
        toast("Aktiviteten er lagt i kundehistorikken.");
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    };
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

    return { bindRows, openLead, openNew };
  }

  window.LokiLeadProfile = { init };
})();
