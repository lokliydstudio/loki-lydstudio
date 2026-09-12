(() => {
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  function setValue(form, name, value) {
    if (form.elements[name]) form.elements[name].value = value ?? "";
  }

  function init({ getLeads, setLeads, renderAll, toast }) {
    const modal = document.getElementById("lead-modal");
    const form = document.getElementById("lead-form");
    const title = document.getElementById("modal-title");
    const subtitle = document.getElementById("lead-profile-subtitle");
    const source = document.getElementById("lead-email-source");
    const preview = document.getElementById("lead-email-preview");
    const enrichmentState = document.getElementById("lead-enrichment-state");
    const submit = document.getElementById("lead-submit");

    function close() {
      modal.classList.remove("open");
    }

    function openNew() {
      form.reset();
      setValue(form, "id", "");
      setValue(form, "messageUid", "");
      setValue(form, "stage", "Nytt lead");
      setValue(form, "nextAction", "Ta første kontakt");
      source.hidden = true;
      preview.value = "";
      title.textContent = "Nytt lead";
      subtitle.textContent = "Legg inn kontakt- og prosjektinformasjon.";
      submit.textContent = "Legg til lead";
      modal.classList.add("open");
      form.elements.name.focus();
    }

    function populate(lead) {
      ["id", "messageUid", "name", "email", "phone", "role", "artistName", "company", "website", "social", "location", "stage", "project", "value", "nextAction", "notes", "emailSummary"].forEach((field) => setValue(form, field, lead[field]));
      setValue(form, "stage", lead.stage || "Nytt lead");
      setValue(form, "nextAction", lead.nextAction || "Ta første kontakt");
      source.hidden = !lead.emailSummary && !lead.messageUid;
      preview.value = lead.emailSummary || "";
    }

    function applyEnrichment(enrichment = {}) {
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
      form.reset();
      populate(lead);
      title.textContent = lead.profileCompleted ? lead.name : "Kompletter leadprofil";
      subtitle.innerHTML = `${esc(lead.source || "Manuelt")} · ${esc(lead.email)}`;
      submit.textContent = lead.profileCompleted ? "Lagre endringer" : "Legg til som lead";
      enrichmentState.textContent = lead.emailSummary ? "Lagret fra e-post" : "Henter kilde";
      enrichmentState.className = lead.emailSummary ? "state green" : "state amber";
      modal.classList.add("open");
      await loadSourceEmail(lead);
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
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

    return { bindRows, openLead, openNew };
  }

  window.LokiLeadProfile = { init };
})();
