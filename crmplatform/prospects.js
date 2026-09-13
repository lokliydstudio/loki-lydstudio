(() => {
  let prospects = [];
  let selectedId = "";
  let filter = "Aktive";
  let ui = {};
  let lastSummary = {};
  const STANDARD_TEMPLATE = `Hei,\n\nVi heter Leon Frick og Charles Wise og driver Loki Lydstudio i Bergen.\nVi jobber med artister og musikere som ønsker å utvikle og ferdigstille musikken sin på et profesjonelt nivå.\n\nHos oss kan vi bistå gjennom hele prosessen – fra innspilling og produksjon til miks og mastering.\nVi ønsker nå å komme i kontakt med flere artister i Bergen som har ny musikk på gang, og ville derfor høre om du har et prosjekt du vurderer å spille inn eller videreutvikle.\n\nDersom det er aktuelt, tar vi gjerne en uforpliktende prat om prosjektet ditt og hva vi eventuelt kan bidra med.\n\nMed vennlig hilsen\nLeon Frick & Charles Wise\nLoki Lydstudio\nwww.lokilyd.no\npost@lokilyd.no`;

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const formatDate = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("nb-NO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };
  const activeStatus = (status) => !["Ikke relevant", "Ikke kontakt", "Konvertert"].includes(status);
  const stateClass = (status) => status === "Klar for kontakt" || status === "Svarte" ? "green" : status === "Ikke kontakt" || status === "Ikke relevant" ? "neutral" : status === "Kontaktet" || status === "Konvertert" ? "violet" : "amber";
  const notify = (message) => ui.toast ? ui.toast(message) : undefined;

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { location.replace("/crm-login.html"); throw new Error("Innlogging kreves."); }
    if (!response.ok) { const error = new Error(data.error || "Kunne ikke oppdatere Cold Call Pool."); error.code = data.code; throw error; }
    return data;
  }

  function visibleProspects() {
    const needle = document.getElementById("prospect-search")?.value.trim().toLowerCase() || "";
    return prospects.filter((item) => {
      const matchesFilter = filter === "Alle" || (filter === "Aktive" ? activeStatus(item.status) : item.status === filter);
      const haystack = `${item.name} ${item.artistName} ${item.location} ${item.genre} ${(item.services || []).join(" ")} ${item.publicEmail}`.toLowerCase();
      return matchesFilter && haystack.includes(needle);
    });
  }

  function renderMetrics(summary = {}) {
    document.getElementById("prospect-total").textContent = summary.total ?? prospects.filter((item) => activeStatus(item.status)).length;
    document.getElementById("prospect-new").textContent = summary.new ?? prospects.filter((item) => item.status === "Ny").length;
    document.getElementById("prospect-review").textContent = summary.review ?? prospects.filter((item) => item.status === "Vurderes").length;
    document.getElementById("prospect-ready").textContent = summary.ready ?? prospects.filter((item) => item.status === "Klar for kontakt").length;
    document.getElementById("prospect-contacted").textContent = summary.contacted ?? prospects.filter((item) => ["Kontaktet", "Svarte"].includes(item.status)).length;
    const navCount = document.getElementById("prospect-nav-count");
    if (navCount) navCount.textContent = summary.new ?? prospects.filter((item) => item.status === "Ny").length;
    const status = document.getElementById("prospect-sync-status");
    if (summary.lastRun?.checkedAt) status.textContent = `Sist oppdatert ${formatDate(summary.lastRun.checkedAt)} · ${summary.lastRun.added || 0} nye`;
    else status.textContent = summary.discoveryConfigured ? "Klar for første nettsøk" : "Manuell pool er klar · nettsøk må konfigureres";
  }

  function renderTabs() {
    const tabs = ["Aktive", "Ny", "Vurderes", "Klar for kontakt", "Kontaktet", "Svarte", "Konvertert", "Ikke relevant", "Ikke kontakt", "Alle"];
    document.getElementById("prospect-tabs").innerHTML = tabs.map((tab) => `<button class="prospect-tab ${filter === tab ? "active" : ""}" type="button" data-prospect-filter="${esc(tab)}">${esc(tab)} <span>${tab === "Alle" ? prospects.length : tab === "Aktive" ? prospects.filter((item) => activeStatus(item.status)).length : prospects.filter((item) => item.status === tab).length}</span></button>`).join("");
    document.querySelectorAll("[data-prospect-filter]").forEach((button) => button.onclick = () => { filter = button.dataset.prospectFilter; render(); });
  }

  function renderList() {
    const list = visibleProspects();
    if (!list.some((item) => item.id === selectedId)) selectedId = list[0]?.id || "";
    document.getElementById("prospect-list").innerHTML = list.length ? list.map((item) => `<button class="prospect-card ${item.id === selectedId ? "active" : ""}" type="button" data-prospect-id="${esc(item.id)}"><span class="prospect-card-main"><span class="avatar">${esc(initials(item.artistName || item.name))}</span><span><strong>${esc(item.artistName || item.name)}</strong><small>${esc([item.type, item.genre].filter(Boolean).join(" · ") || "Artistprosjekt")}</small></span></span><span>${esc(item.location || "Ukjent sted")}</span><span class="prospect-score"><strong>${Number(item.score) || 0}%</strong><i style="--prospect-score:${Number(item.score) || 0}%"></i></span><span aria-hidden="true">→</span></button>`).join("") : '<div class="prospect-empty">Ingen kandidater i denne visningen. Kjør et nytt søk eller legg inn en kandidat manuelt.</div>';
    document.querySelectorAll("[data-prospect-id]").forEach((button) => button.onclick = () => { selectedId = button.dataset.prospectId; renderList(); renderDetail(); });
  }

  function link(label, url) { return url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label)} ↗</a>` : ""; }

  function renderDetail() {
    const item = prospects.find((candidate) => candidate.id === selectedId);
    const node = document.getElementById("prospect-detail");
    if (!item) { node.innerHTML = '<div class="prospect-empty">Velg en kandidat for å se kilde, vurdering og oppfølging.</div>'; return; }
    const disabled = item.status === "Ikke kontakt" || item.doNotContact;
    node.innerHTML = `<div class="prospect-detail-header"><div><span class="kicker">KANDIDATPROFIL</span><h2>${esc(item.artistName || item.name)}</h2><p class="prospect-detail-sub">${esc([item.type, item.location, item.genre].filter(Boolean).join(" · "))}</p></div><span class="prospect-score-ring" title="Relevansscore">${Number(item.score) || 0}</span></div>
      <div class="prospect-tags">${(item.services || []).map((service) => `<span>${esc(service)}</span>`).join("")}<span class="state ${stateClass(item.status)}">${esc(item.status)}</span></div>
      <div class="prospect-links">${link("Kilde", item.sourceUrl)}${link("Nettside", item.websiteUrl)}${link("Instagram", item.instagramUrl)}${link("Facebook", item.facebookUrl)}${item.publicEmail ? `<a href="mailto:${esc(item.publicEmail)}">${esc(item.publicEmail)}</a>` : ""}</div>
      <section class="prospect-evidence"><strong>Offentlig behovssignal</strong><p>${esc(item.needEvidence || "Ingen konkret behovsindikasjon er dokumentert ennå.")}</p>${item.relevanceReason ? `<p><br>${esc(item.relevanceReason)}</p>` : ""}<p class="prospect-source-note">${esc(item.sourceName || item.sourceType || "Manuelt lagt inn")} · kontrollert ${esc(formatDate(item.lastVerifiedAt))}</p></section>
      <form class="prospect-review-form" id="prospect-review-form"><label>Status<select name="status" ${disabled ? "disabled" : ""}>${["Ny", "Vurderes", "Klar for kontakt", "Kontaktet", "Svarte", "Konvertert", "Ikke relevant"].map((status) => `<option ${status === item.status ? "selected" : ""}>${esc(status)}</option>`).join("")}</select></label><label>Kontaktgrunnlag<select name="contactBasis" ${disabled ? "disabled" : ""}>${["Ikke vurdert", "Uttrykkelig samtykke", "Eksisterende kundeforhold", "Manuelt godkjent", "Ikke kontakt"].map((basis) => `<option ${basis === item.contactBasis ? "selected" : ""}>${esc(basis)}</option>`).join("")}</select></label><label class="prospect-check"><input name="adultConfirmed" type="checkbox" ${item.adultConfirmed ? "checked" : ""} ${disabled ? "disabled" : ""}><span>Jeg har kontrollert at kontakten gjelder en voksen (18+) eller en virksomhet, og at kilden er profesjonell.</span></label><label class="wide">Interne notater<textarea name="notes" maxlength="5000" ${disabled ? "disabled" : ""}>${esc(item.notes || "")}</textarea></label><div class="button-row wide"><button class="secondary" type="submit" ${disabled ? "disabled" : ""}>Lagre vurdering</button></div></form>
      <section class="prospect-draft"><div class="prospect-draft-head"><span class="kicker">PERSONLIG UTKAST · SENDES IKKE AUTOMATISK</span><span><button class="link-button" id="prospect-use-template" type="button" ${disabled ? "disabled" : ""}>Bruk Loki-malen</button><button class="link-button" id="prospect-generate-draft" type="button" ${disabled ? "disabled" : ""}>Tilpass med AI</button></span></div><textarea id="prospect-draft-text" placeholder="Velg Loki-malen eller lag et personlig utkast …" ${disabled ? "disabled" : ""}>${esc(item.outreachDraft || "")}</textarea><div class="prospect-actions"><div><button class="secondary" id="prospect-copy-draft" type="button" ${!item.outreachDraft || disabled ? "disabled" : ""}>Kopier utkast</button><button class="primary" id="prospect-convert" type="button" ${disabled || item.status === "Konvertert" ? "disabled" : ""}>Gjør til CRM-kontakt</button></div><div><button class="link-button prospect-danger" id="prospect-irrelevant" type="button" ${disabled ? "disabled" : ""}>Ikke relevant</button><button class="link-button prospect-danger" id="prospect-suppress" type="button" ${disabled ? "disabled" : ""}>Ikke kontakt igjen</button></div></div></section>`;
    document.getElementById("prospect-review-form").onsubmit = saveReview;
    document.getElementById("prospect-use-template").onclick = useTemplate;
    document.getElementById("prospect-generate-draft").onclick = generateDraft;
    document.getElementById("prospect-copy-draft").onclick = copyDraft;
    document.getElementById("prospect-convert").onclick = convertToContact;
    document.getElementById("prospect-irrelevant").onclick = () => updateProspect(item.id, { status: "Ikke relevant" }, "Kandidaten er flyttet til «Ikke relevant».");
    document.getElementById("prospect-suppress").onclick = suppressProspect;
  }

  function render(summary) { if (summary) lastSummary = summary; renderMetrics(lastSummary); renderTabs(); renderList(); renderDetail(); }

  async function load() {
    document.getElementById("prospect-list").innerHTML = '<div class="loading-message">Henter kandidater …</div>';
    try {
      const data = await request("/api/studio?action=prospects");
      prospects = data.prospects || [];
      render(data.summary || {});
    } catch (error) {
      document.getElementById("prospect-list").innerHTML = `<div class="prospect-empty">${esc(error.message)}</div>`;
      notify(error.message);
    }
  }

  async function discover() {
    const button = document.getElementById("prospect-discover");
    button.disabled = true; button.textContent = "Søker offentlige kilder …";
    try {
      const data = await request("/api/studio?action=prospects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "discover" }) });
      prospects = data.prospects || prospects; render(data.summary || {});
      notify(`${data.result?.added || 0} nye kandidater funnet, ${data.result?.refreshed || 0} oppdatert.`);
    } catch (error) {
      notify(error.message);
    } finally { button.disabled = false; button.textContent = "✦ Finn nye kandidater"; }
  }

  async function updateProspect(id, changes, message) {
    try {
      const data = await request("/api/studio?action=prospects", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, changes }) });
      prospects = data.prospects || prospects.map((item) => item.id === id ? data.prospect : item); render(); if (message) notify(message); return data.prospect;
    } catch (error) { notify(error.message); return null; }
  }

  async function saveReview(event) {
    event.preventDefault();
    const item = prospects.find((candidate) => candidate.id === selectedId); if (!item) return;
    const data = new FormData(event.currentTarget);
    const requestedStatus = String(data.get("status"));
    const contactBasis = String(data.get("contactBasis"));
    const adultConfirmed = data.get("adultConfirmed") === "on";
    if (requestedStatus === "Klar for kontakt" && (!adultConfirmed || contactBasis === "Ikke vurdert")) { notify("Bekreft 18+/virksomhet og vurder kontaktgrunnlag før kandidaten settes klar."); return; }
    await updateProspect(item.id, { status: requestedStatus, contactBasis, adultConfirmed, notes: String(data.get("notes") || ""), outreachDraft: document.getElementById("prospect-draft-text").value }, "Vurderingen er lagret.");
  }

  async function generateDraft() {
    const item = prospects.find((candidate) => candidate.id === selectedId); if (!item) return;
    const button = document.getElementById("prospect-generate-draft"); button.disabled = true; button.textContent = "Skriver …";
    try { const data = await request("/api/studio?action=prospects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "draft", id: item.id }) }); prospects = prospects.map((candidate) => candidate.id === item.id ? data.prospect : candidate); renderDetail(); notify("Et personlig utkast er laget. Kontroller det før bruk."); }
    catch (error) { notify(error.message); button.disabled = false; button.textContent = "Lag utkast"; }
  }

  async function useTemplate() {
    const item = prospects.find((candidate) => candidate.id === selectedId); if (!item) return;
    document.getElementById("prospect-draft-text").value = STANDARD_TEMPLATE;
    await updateProspect(item.id, { outreachDraft: STANDARD_TEMPLATE }, "Loki-malen er lagt inn og lagret.");
  }

  async function copyDraft() {
    const text = document.getElementById("prospect-draft-text").value; if (!text) return;
    try { await navigator.clipboard.writeText(text); notify("Utkastet er kopiert."); } catch { notify("Kunne ikke kopiere automatisk. Marker teksten og kopier manuelt."); }
  }

  async function convertToContact() {
    const item = prospects.find((candidate) => candidate.id === selectedId); if (!item) return;
    if (!item.adultConfirmed || item.contactBasis === "Ikke vurdert") { notify("Fullfør 18+/virksomhetskontroll og kontaktvurdering først."); return; }
    try {
      const response = await request("/api/crm/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "upsertMany", leads: [{ name: item.name, artistName: item.artistName, email: item.publicEmail, project: `${(item.services || []).join(" / ") || "Studioforespørsel"} · ${item.artistName || item.name}`, stage: "Nytt lead", source: "Cold Call Pool", nextAction: "Manuell, respektfull første kontakt", location: item.location, website: item.websiteUrl, social: item.instagramUrl || item.facebookUrl, notes: [item.needEvidence, item.relevanceReason, item.notes].filter(Boolean).join("\n\n"), profileCompleted: true }] }) });
      if (!response.leads) throw new Error("Kontakten kunne ikke opprettes.");
      await updateProspect(item.id, { status: "Konvertert" }, "Kandidaten er opprettet under «Kontakter og leads».");
      if (ui.onConverted) ui.onConverted(response.leads);
    } catch (error) { notify(error.message); }
  }

  async function suppressProspect() {
    const item = prospects.find((candidate) => candidate.id === selectedId); if (!item || !confirm(`Sperr «${item.artistName || item.name}» mot videre kontakt? Kandidaten beholdes som en undertrykkelsespost slik at den ikke dukker opp igjen.`)) return;
    try { const data = await request(`/api/studio?action=prospects&id=${encodeURIComponent(item.id)}`, { method: "DELETE" }); prospects = data.prospects || prospects; filter = "Aktive"; render(); notify("Kandidaten er sperret mot videre kontakt."); } catch (error) { notify(error.message); }
  }

  function openModal() { document.getElementById("prospect-modal").classList.add("open"); }
  function closeModal() { document.getElementById("prospect-modal").classList.remove("open"); document.getElementById("prospect-form").reset(); }

  async function saveManual(event) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const services = String(data.get("services") || "").split(",").map((value) => value.trim()).filter(Boolean);
    const prospect = Object.fromEntries(data.entries()); prospect.services = services; prospect.adultConfirmed = data.get("adultConfirmed") === "on";
    try { const result = await request("/api/studio?action=prospects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prospect }) }); prospects = result.prospects || [result.prospect, ...prospects]; selectedId = result.prospect?.id || selectedId; closeModal(); render(); notify("Kandidaten er lagt i Cold Call Pool."); } catch (error) { notify(error.message); }
  }

  function init(options = {}) {
    ui = options;
    document.getElementById("prospect-discover").onclick = discover;
    document.getElementById("new-prospect").onclick = openModal;
    document.getElementById("close-prospect-modal").onclick = closeModal;
    document.getElementById("cancel-prospect-modal").onclick = closeModal;
    document.getElementById("prospect-form").onsubmit = saveManual;
    document.getElementById("prospect-search").oninput = () => { renderList(); renderDetail(); };
    return load();
  }

  window.LokiProspects = { init, reload: load };
})();
