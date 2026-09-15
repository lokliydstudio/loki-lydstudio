(() => {
  const statuses = ["Planlegges", "Booket", "Innspilling", "Miks", "Mastering", "Levert", "På vent"];
  const audioTypes = {
    aac: "audio/aac",
    aif: "audio/aiff",
    aiff: "audio/aiff",
    flac: "audio/flac",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    weba: "audio/webm",
    webm: "audio/webm",
  };
  let initialized = false;
  let projects = [];
  let tracks = [];
  let audioComments = [];
  let selectedProjectId = null;
  let activeOwner = "Leon";

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);

  function toast(text) {
    const node = document.getElementById("toast");
    node.textContent = `✓ ${text}`;
    node.classList.add("show");
    clearTimeout(window.studioToastTimer);
    window.studioToastTimer = setTimeout(() => node.classList.remove("show"), 3600);
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    if (response.status === 401) {
      location.replace("/crm-login.html");
      throw new Error("Innlogging kreves.");
    }
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
    return `${(bytes / 1024 / 1024).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} MB`;
  }

  function projectTracks() {
    return tracks.filter((track) => track.projectId === selectedProjectId);
  }

  function formatTimestamp(value) {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function commentsForTrack(trackId) {
    return audioComments
      .filter((comment) => comment.trackId === trackId)
      .sort((left, right) => Number(left.timestampSeconds) - Number(right.timestampSeconds) || String(left.createdAt).localeCompare(String(right.createdAt)));
  }

  function commentRows(trackId) {
    const comments = commentsForTrack(trackId);
    if (!comments.length) return '<p class="mix-feedback-empty">Ingen tidsstemplede kommentarer ennå.</p>';
    return comments.map((comment) => `
      <article class="mix-comment">
        <button class="mix-comment-time" type="button" data-jump-comment="${esc(trackId)}" data-seconds="${Number(comment.timestampSeconds) || 0}" title="Hopp til tidspunktet">${formatTimestamp(comment.timestampSeconds)}</button>
        <div class="mix-comment-copy"><strong>${esc(comment.authorName)}${comment.authorType === "studio" ? ' <span>LOKI</span>' : ""}</strong><p>${esc(comment.body)}</p><small>${new Date(comment.createdAt).toLocaleString("nb-NO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div>
        <button class="mix-comment-delete" type="button" data-delete-comment="${esc(comment.id)}" data-track-id="${esc(trackId)}" aria-label="Slett kommentar">×</button>
      </article>`).join("");
  }

  function bindCommentActions(root = document) {
    root.querySelectorAll("[data-jump-comment]").forEach((button) => {
      button.onclick = () => jumpToComment(button.dataset.jumpComment, button.dataset.seconds);
    });
    root.querySelectorAll("[data-delete-comment]").forEach((button) => {
      button.onclick = () => deleteAudioComment(button.dataset.trackId, button.dataset.deleteComment);
    });
  }

  function refreshTrackComments(trackId) {
    const card = document.querySelector(`[data-track-card="${CSS.escape(trackId)}"]`);
    if (!card) return;
    const count = commentsForTrack(trackId).length;
    card.querySelector(".mix-feedback-head > span").textContent = `${count} ${count === 1 ? "kommentar" : "kommentarer"}`;
    card.querySelector(".mix-comment-list").innerHTML = commentRows(trackId);
    bindCommentActions(card);
  }

  function patchRow(row) {
    return `
      <tr data-channel="${row.channel}">
        <td><span class="channel-number">${row.channel}</span></td>
        <td><input type="text" data-field="source" value="${esc(row.source)}" aria-label="Kanal ${row.channel} lydkilde" placeholder="Vokal, kick, gitar …"></td>
        <td><input type="text" data-field="connection" value="${esc(row.connection)}" aria-label="Kanal ${row.channel} fysisk input" placeholder="Vegg A1 / XLR"></td>
        <td><input type="text" data-field="microphone" value="${esc(row.microphone)}" aria-label="Kanal ${row.channel} mikrofon" placeholder="U87 / DI"></td>
        <td><input type="text" data-field="preamp" value="${esc(row.preamp)}" aria-label="Kanal ${row.channel} preamp" placeholder="Neve / Interface"></td>
        <td><input type="text" data-field="destination" value="${esc(row.destination)}" aria-label="Kanal ${row.channel} routing" placeholder="Input ${row.channel}"></td>
        <td><input type="checkbox" data-field="phantom" ${row.phantom ? "checked" : ""} aria-label="Kanal ${row.channel} phantom power"></td>
        <td><input type="text" data-field="notes" value="${esc(row.notes)}" aria-label="Kanal ${row.channel} notat" placeholder="Pad, fase, HPF …"></td>
        <td><button class="patch-remove-button" type="button" data-remove-channel="${row.channel}" aria-label="Fjern kanal ${row.channel}" title="Fjern kanal ${row.channel}">×</button></td>
      </tr>`;
  }

  function patchRows(project) {
    const rows = Array.isArray(project.patch) ? project.patch : [];
    return rows.length
      ? rows.map(patchRow).join("")
      : '<tr class="patch-empty-row"><td colspan="9">Ingen kanaler i patchelisten. Legg til kanaler når du trenger dem.</td></tr>';
  }

  function localDateValue(date = new Date()) {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function formatHours(value) {
    return `${(Number(value) || 0).toLocaleString("nb-NO", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} t`;
  }

  function timeTotals(project) {
    const totals = { Innspilling: 0, Editering: 0, Miks: 0, total: 0 };
    (project.timeEntries || []).forEach((entry) => {
      if (Object.hasOwn(totals, entry.category)) totals[entry.category] += Number(entry.hours) || 0;
      totals.total += Number(entry.hours) || 0;
    });
    return totals;
  }

  function timeSummary(project) {
    const totals = timeTotals(project);
    return [
      ["Innspilling", totals.Innspilling, "recording"],
      ["Editering", totals.Editering, "editing"],
      ["Miks", totals.Miks, "mixing"],
      ["Totalt", totals.total, "total"],
    ].map(([label, hours, tone]) => `<article class="time-metric ${tone}"><span>${label}</span><strong>${formatHours(hours)}</strong><small>registrert arbeid</small></article>`).join("");
  }

  function timeEntryRows(project) {
    const entries = [...(project.timeEntries || [])].sort((left, right) => String(right.date).localeCompare(String(left.date)) || String(right.createdAt).localeCompare(String(left.createdAt)));
    if (!entries.length) return '<div class="time-empty">Ingen timer registrert på prosjektet ennå.</div>';
    return entries.map((entry) => {
      const date = new Date(`${entry.date}T12:00:00`).toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
      return `<article class="time-entry-row">
        <time datetime="${esc(entry.date)}">${esc(date)}</time>
        <span class="time-category ${String(entry.category).toLowerCase()}">${esc(entry.category)}</span>
        <span>${esc(entry.worker)}</span>
        <p>${esc(entry.notes || "Ingen merknad")}</p>
        <strong>${formatHours(entry.hours)}</strong>
        <button class="tiny-button danger" type="button" data-delete-time="${esc(entry.id)}" aria-label="Slett ${esc(entry.category.toLowerCase())} ${esc(date)}">Slett</button>
      </article>`;
    }).join("");
  }

  function spotifyReferenceInput(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:" || url.hostname !== "open.spotify.com") return null;
      const segments = url.pathname.split("/").filter(Boolean);
      if (/^intl-[a-z]{2}$/i.test(segments[0] || "")) segments.shift();
      if (segments[0] === "embed") segments.shift();
      const type = String(segments[0] || "").toLowerCase();
      const spotifyId = String(segments[1] || "");
      if (!["playlist", "album", "track"].includes(type) || !/^[A-Za-z0-9]{10,64}$/.test(spotifyId)) return null;
      return { type, spotifyId, url: `https://open.spotify.com/${type}/${spotifyId}` };
    } catch {
      return null;
    }
  }

  function spotifyEmbedUrl(reference) {
    const type = ["playlist", "album", "track"].includes(reference?.type) ? reference.type : "";
    const spotifyId = /^[A-Za-z0-9]{10,64}$/.test(String(reference?.spotifyId || "")) ? reference.spotifyId : "";
    return type && spotifyId ? `https://open.spotify.com/embed/${type}/${spotifyId}` : "";
  }

  function spotifyReferenceCards(project) {
    const references = Array.isArray(project?.spotifyReferences) ? project.spotifyReferences : [];
    if (!references.length) return '<div class="project-empty spotify-reference-empty">Ingen referanselåter lagt til ennå.</div>';
    return references.map((reference) => {
      const embedUrl = spotifyEmbedUrl(reference);
      if (!embedUrl) return "";
      const typeLabel = reference.type === "playlist" ? "Spilleliste" : reference.type === "album" ? "Album" : "Låt";
      return `
        <article class="spotify-reference-card ${reference.type === "track" ? "compact" : ""}">
          <iframe src="${esc(embedUrl)}" title="Spotify-referanse: ${esc(reference.title)}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
          <div class="spotify-reference-meta">
            <div class="spotify-reference-copy"><strong>${esc(reference.title)}</strong><span>${esc(typeLabel)}${reference.note ? ` · ${esc(reference.note)}` : ""}</span></div>
            <div class="spotify-reference-actions"><a class="tiny-button" href="${esc(reference.url)}" target="_blank" rel="noreferrer">Åpne ↗</a><button class="tiny-button danger" type="button" data-remove-spotify="${esc(reference.id)}">Fjern</button></div>
          </div>
        </article>`;
    }).join("");
  }

  function bindSpotifyReferenceActions() {
    document.querySelectorAll("[data-remove-spotify]").forEach((button) => {
      button.onclick = () => removeSpotifyReference(button.dataset.removeSpotify);
    });
  }

  function refreshSpotifyReferences(project) {
    const list = document.getElementById("spotify-reference-list");
    if (!list || project.id !== selectedProjectId) return;
    list.innerHTML = spotifyReferenceCards(project);
    bindSpotifyReferenceActions();
  }

  function trackCards() {
    const visible = projectTracks();
    if (!visible.length) return '<div class="project-empty">Ingen lydfiler i prosjektet ennå.</div>';
    return visible.map((track) => `
      <article class="track-card" data-track-card="${esc(track.id)}">
        <div class="track-main">
          <div class="track-copy">
            <strong>${esc(track.title)} · ${esc(track.version)}</strong>
            <span>${esc(track.filename)} · ${formatBytes(track.size)}</span>
            <span>${esc(track.jottaStatus || "Venter på lokal synk")}</span>
          </div>
          <audio controls preload="metadata" data-track-player="${esc(track.id)}" src="/api/studio?action=internal-stream&amp;id=${encodeURIComponent(track.id)}">Nettleseren støtter ikke lydavspilling.</audio>
          <div class="track-actions">
            <button class="tiny-button" data-share-track="${esc(track.id)}">Kopier kundelenke</button>
            <button class="tiny-button danger" data-delete-track="${esc(track.id)}">Slett</button>
          </div>
        </div>
        <section class="mix-feedback" aria-label="Tidsstemplet feedback for ${esc(track.title)}">
          <div class="mix-feedback-head"><div><strong>Kommentarer på tidslinjen</strong><span>Spill av eller pause der du vil kommentere.</span></div><span>${commentsForTrack(track.id).length} kommentarer</span></div>
          <form class="mix-comment-form" data-comment-form="${esc(track.id)}">
            <span class="mix-comment-capture" data-comment-capture="${esc(track.id)}">00:00</span>
            <textarea data-comment-body="${esc(track.id)}" maxlength="1000" rows="2" placeholder="F.eks. basstrommen er litt høy her …" aria-label="Kommentar til ${esc(track.title)}" required></textarea>
            <button class="primary" type="submit">Legg til</button>
          </form>
          <div class="mix-comment-list">${commentRows(track.id)}</div>
        </section>
      </article>`).join("");
  }

  function editorMarkup(project) {
    return `
      <div class="project-toolbar">
        <div><span class="kicker">STUDIOPROSJEKT</span><h2>${esc(project.name)}</h2></div>
        <div class="button-row"><span class="save-state" id="project-save-state">Lagret ${new Date(project.updatedAt).toLocaleString("nb-NO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span><button class="secondary" id="export-project" title="Eksporter sist lagrede versjon">⇩ Eksporter ZIP</button><button class="secondary danger-button" id="delete-project">Slett prosjekt</button><button class="primary" id="save-project">Lagre prosjekt</button><span class="export-progress" id="project-export-state" hidden></span></div>
      </div>
      <div class="project-fields">
        <label class="field">Prosjektnavn<input id="project-name" value="${esc(project.name)}"></label>
        <label class="field">Kunde / artist<input id="project-client" value="${esc(project.clientName)}"></label>
        <label class="field">Kundens e-post<input id="project-email" type="email" value="${esc(project.clientEmail)}"></label>
        <label class="field">Status<select id="project-status">${statuses.map((status) => `<option ${status === project.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <label class="field">Dato<input id="project-date" type="date" value="${esc(project.sessionDate)}"></label>
        <label class="field field-wide">Prosjektnotater<textarea id="project-notes" placeholder="Leveranse, referanser, tidsplan og andre avtaler …">${esc(project.notes)}</textarea></label>
      </div>
      <section class="studio-section project-time-section">
        <div class="studio-section-head"><div><span class="kicker">TIMEFØRING</span><h3>Timer på prosjektet</h3><p>Registrer fakturerbart arbeid og se fordelingen mellom innspilling, editering og miks.</p></div><span class="state violet">Fakturagrunnlag</span></div>
        <div class="time-summary" id="time-summary">${timeSummary(project)}</div>
        <form class="time-entry-form" id="time-entry-form">
          <label>Dato<input name="date" type="date" value="${localDateValue()}" required></label>
          <label>Arbeidstype<select name="category" required><option>Innspilling</option><option>Editering</option><option>Miks</option></select></label>
          <label>Timer<input name="hours" type="number" min="0.25" max="24" step="0.25" inputmode="decimal" placeholder="2,5" required></label>
          <label>Utført av<select name="worker"><option ${activeOwner === "Leon" ? "selected" : ""}>Leon</option><option ${activeOwner === "Charles" ? "selected" : ""}>Charles</option></select></label>
          <label class="time-note">Notat<input name="notes" maxlength="500" placeholder="F.eks. vokalopptak, comping eller miksrevisjon"></label>
          <button class="primary" type="submit">+ Registrer timer</button>
        </form>
        <div class="time-entry-list" id="time-entry-list">${timeEntryRows(project)}</div>
        <p class="time-help">Timer føres per arbeidsøkt og lagres direkte på prosjektet. Timeloggen følger med i ZIP-backupen.</p>
      </section>
      <section class="studio-section">
        <div class="studio-section-head"><div><span class="kicker">LYTTEREFERANSER</span><h3>Referanselåter</h3><p>Koble Spotify-spillelister, album eller låter direkte til prosjektet.</p></div><span class="state green">Spotify</span></div>
        <form class="spotify-reference-form" id="spotify-reference-form">
          <label>Spotify-lenke<input id="spotify-reference-url" type="url" inputmode="url" placeholder="https://open.spotify.com/playlist/…" required></label>
          <label>Navn<input id="spotify-reference-title" maxlength="120" placeholder="F.eks. sound og retning"></label>
          <label>Hva skal vi lytte etter?<input id="spotify-reference-note" maxlength="300" placeholder="Trommer, vokal, rom, balanse …"></label>
          <button class="primary" type="submit">+ Legg til</button>
        </form>
        <div class="spotify-reference-list" id="spotify-reference-list">${spotifyReferenceCards(project)}</div>
        <p class="spotify-reference-note">Referansene lagres på prosjektet og følger med i prosjektets ZIP-backup.</p>
      </section>
      <section class="studio-section">
        <div class="studio-section-head"><div><span class="kicker">SIGNALFLYT</span><h3>Patcheliste</h3><p>Bruk bare kanalene økten trenger. Fysisk input → mikrofon / DI → preamp → lydkortets input.</p></div><div class="button-row patch-actions"><button class="secondary" id="remove-empty-patch" type="button">Fjern tomme</button><button class="secondary" id="add-patch-channel" type="button">+ Legg til kanal</button><button class="secondary" id="print-patch" type="button">⎙ Skriv ut</button><span class="state green" id="patch-channel-count">${project.patch.length} / 32</span></div></div>
        <div class="patch-wrap"><table class="patch-table"><thead><tr><th>CH</th><th>KILDE</th><th>FYSISK INPUT</th><th>MIK / DI</th><th>PREAMP</th><th>ROUTING</th><th>+48V</th><th>NOTAT</th><th>FJERN</th></tr></thead><tbody id="patch-body">${patchRows(project)}</tbody></table></div>
        <p class="patch-help">Maks 32 kanaler. Fjernede kanaler blir borte når prosjektet lagres.</p>
      </section>
      <section class="studio-section">
        <div class="studio-section-head"><div><span class="kicker">LYDLEVERANSER</span><h3>Mikser og demoer</h3><p>Last opp privat, lytt her og kopier en tidsbegrenset kundelenke.</p></div><span class="state violet">Privat lagring</span></div>
        <form class="audio-form" id="audio-upload-form">
          <label>Lydfil<input id="audio-file" type="file" accept=".wav,.mp3,.flac,.aif,.aiff,.m4a,.aac,.ogg,.weba,.webm,audio/*" required></label>
          <label>Tittel<input id="audio-title" placeholder="Låttittel"></label>
          <label>Versjon<input id="audio-version" value="V1" maxlength="40"></label>
          <button class="primary" id="upload-audio" type="submit">Last opp</button>
          <div class="upload-progress" id="upload-progress"><i></i></div>
        </form>
        <div class="audio-list" id="audio-list">${trackCards()}</div>
        <p class="storage-note"><span>●</span><span><b>Sikker levering:</b> Avspillingen går gjennom Loki-plattformen fra privat Blob-lagring. Kundelenker er signert og varer i 14 dager. Jottacloud-broen speiler filene til studioets eget arkiv når den kjører på Mac-en.</span></p>
      </section>`;
  }

  function render() {
    const count = document.getElementById("project-count");
    const list = document.getElementById("project-list");
    const workspace = document.getElementById("project-workspace");
    count.textContent = String(projects.length);
    list.innerHTML = projects.length ? projects.map((project) => `
      <button class="${project.id === selectedProjectId ? "active" : ""}" data-project-id="${esc(project.id)}">
        <strong>${esc(project.name)}</strong><span>${esc(project.clientName || "Ingen kunde")} · ${esc(project.status)} · ${formatHours(timeTotals(project).total)}</span>
      </button>`).join("") : '<div class="project-empty">Ingen prosjekter ennå.</div>';

    const project = projects.find((item) => item.id === selectedProjectId);
    workspace.innerHTML = project ? editorMarkup(project) : '<div class="project-empty">Opprett et prosjekt for å sette opp patchelisten og laste opp lyd.</div>';
    const exportAll = document.getElementById("export-all-projects");
    if (exportAll) exportAll.disabled = projects.length === 0;
    bindRenderedControls();
  }

  function bindRenderedControls() {
    document.querySelectorAll("[data-project-id]").forEach((button) => {
      button.onclick = () => { selectedProjectId = button.dataset.projectId; render(); };
    });
    const save = document.getElementById("save-project");
    if (save) save.onclick = saveProject;
    const exportProject = document.getElementById("export-project");
    if (exportProject) exportProject.onclick = () => exportProjects(selectedProjectId, exportProject);
    const printPatch = document.getElementById("print-patch");
    if (printPatch) printPatch.onclick = printPatchList;
    const addPatch = document.getElementById("add-patch-channel");
    if (addPatch) addPatch.onclick = addPatchChannel;
    const removeEmptyPatch = document.getElementById("remove-empty-patch");
    if (removeEmptyPatch) removeEmptyPatch.onclick = removeEmptyPatchChannels;
    const deleteButton = document.getElementById("delete-project");
    if (deleteButton) deleteButton.onclick = deleteProject;
    const upload = document.getElementById("audio-upload-form");
    if (upload) upload.onsubmit = uploadAudio;
    const spotifyForm = document.getElementById("spotify-reference-form");
    if (spotifyForm) spotifyForm.onsubmit = addSpotifyReference;
    const timeForm = document.getElementById("time-entry-form");
    if (timeForm) timeForm.onsubmit = saveTimeEntry;
    bindSpotifyReferenceActions();
    document.querySelectorAll("[data-share-track]").forEach((button) => {
      button.onclick = () => shareTrack(button.dataset.shareTrack);
    });
    document.querySelectorAll("[data-delete-track]").forEach((button) => {
      button.onclick = () => deleteTrack(button.dataset.deleteTrack);
    });
    document.querySelectorAll("[data-track-player]").forEach((player) => {
      const updateTimestamp = () => {
        const capture = document.querySelector(`[data-comment-capture="${CSS.escape(player.dataset.trackPlayer)}"]`);
        if (capture) capture.textContent = formatTimestamp(player.currentTime);
      };
      player.addEventListener("timeupdate", updateTimestamp);
      player.addEventListener("seeked", updateTimestamp);
      updateTimestamp();
    });
    document.querySelectorAll("[data-comment-form]").forEach((form) => {
      form.onsubmit = (event) => saveAudioComment(event, form.dataset.commentForm);
    });
    bindCommentActions();
    bindPatchRowActions();
    bindTimeEntryActions();
    document.querySelectorAll("#project-workspace .project-fields input, #project-workspace .project-fields textarea, #project-workspace .project-fields select, #patch-body input").forEach((input) => {
      input.addEventListener("input", () => {
        const state = document.getElementById("project-save-state");
        if (state) state.textContent = "Ulagrede endringer";
      });
    });
  }

  function jumpToComment(trackId, seconds) {
    const player = document.querySelector(`[data-track-player="${CSS.escape(trackId)}"]`);
    if (!player) return;
    player.currentTime = Math.max(0, Number(seconds) || 0);
    player.play().catch(() => {});
  }

  async function saveAudioComment(event, trackId) {
    event.preventDefault();
    const form = event.currentTarget;
    const player = document.querySelector(`[data-track-player="${CSS.escape(trackId)}"]`);
    const body = form.querySelector(`[data-comment-body="${CSS.escape(trackId)}"]`).value.trim();
    if (!body) return;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Lagrer …";
    try {
      const data = await request(`/api/studio?action=audio-comments&trackId=${encodeURIComponent(trackId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackId, timestampSeconds: player?.currentTime || 0, body }),
      });
      audioComments.push(data.comment);
      form.querySelector(`[data-comment-body="${CSS.escape(trackId)}"]`).value = "";
      button.disabled = false;
      button.textContent = "Legg til";
      refreshTrackComments(trackId);
      toast(`Kommentar lagret ved ${formatTimestamp(data.comment.timestampSeconds)}.`);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Legg til";
      toast(error.message || "Kommentaren kunne ikke lagres.");
    }
  }

  async function deleteAudioComment(trackId, id) {
    if (!confirm("Slett denne kommentaren?")) return;
    try {
      await request(`/api/studio?action=audio-comments&trackId=${encodeURIComponent(trackId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      audioComments = audioComments.filter((comment) => comment.id !== id);
      refreshTrackComments(trackId);
      toast("Kommentaren er slettet.");
    } catch (error) {
      toast(error.message || "Kommentaren kunne ikke slettes.");
    }
  }

  function collectPatch() {
    return [...document.querySelectorAll("#patch-body tr[data-channel]")].map((row) => {
      const value = (field) => row.querySelector(`[data-field="${field}"]`);
      return {
        channel: Number(row.dataset.channel),
        source: value("source").value,
        connection: value("connection").value,
        microphone: value("microphone").value,
        preamp: value("preamp").value,
        destination: value("destination").value,
        phantom: value("phantom").checked,
        notes: value("notes").value,
      };
    });
  }

  function markProjectUnsaved() {
    const state = document.getElementById("project-save-state");
    if (state) state.textContent = "Ulagrede endringer";
  }

  function updatePatchControls() {
    const body = document.getElementById("patch-body");
    if (!body) return;
    const rows = [...body.querySelectorAll("tr[data-channel]")];
    if (!rows.length) body.innerHTML = '<tr class="patch-empty-row"><td colspan="9">Ingen kanaler i patchelisten. Legg til kanaler når du trenger dem.</td></tr>';
    const count = document.getElementById("patch-channel-count");
    if (count) count.textContent = `${rows.length} / 32`;
    const add = document.getElementById("add-patch-channel");
    if (add) {
      add.disabled = rows.length >= 32;
      add.title = rows.length >= 32 ? "Patchelisten har nådd maksgrensen på 32 kanaler" : "Legg til en ledig kanal";
    }
    const removeEmpty = document.getElementById("remove-empty-patch");
    if (removeEmpty) removeEmpty.disabled = rows.length === 0;
  }

  function bindPatchRowActions() {
    document.querySelectorAll("[data-remove-channel]").forEach((button) => {
      button.onclick = () => removePatchChannel(button);
    });
    updatePatchControls();
  }

  function addPatchChannel() {
    const body = document.getElementById("patch-body");
    if (!body) return;
    const used = new Set(collectPatch().map((row) => row.channel));
    const channel = Array.from({ length: 32 }, (_, index) => index + 1).find((number) => !used.has(number));
    if (!channel) return toast("Patchelisten kan ha maksimalt 32 kanaler.");
    body.querySelector(".patch-empty-row")?.remove();
    const holder = document.createElement("tbody");
    holder.innerHTML = patchRow({ channel, source: "", connection: "", microphone: "", preamp: "", destination: `Input ${channel}`, phantom: false, notes: "" });
    const newRow = holder.firstElementChild;
    const following = [...body.querySelectorAll("tr[data-channel]")].find((row) => Number(row.dataset.channel) > channel);
    body.insertBefore(newRow, following || null);
    bindPatchRowActions();
    markProjectUnsaved();
    newRow.querySelector('[data-field="source"]')?.focus();
  }

  function rowHasPatchData(row) {
    const channel = Number(row.dataset.channel);
    return [...row.querySelectorAll('input[type="text"]')].some((input) => input.value.trim() && input.value.trim() !== `Input ${channel}`)
      || row.querySelector('input[type="checkbox"]')?.checked;
  }

  function removePatchChannel(button) {
    const row = button.closest("tr[data-channel]");
    if (!row) return;
    const channel = Number(row.dataset.channel);
    if (rowHasPatchData(row) && !confirm(`Fjern kanal ${channel} og innholdet i denne raden?`)) return;
    row.remove();
    updatePatchControls();
    markProjectUnsaved();
  }

  function removeEmptyPatchChannels() {
    const rows = [...document.querySelectorAll("#patch-body tr[data-channel]")];
    const emptyRows = rows.filter((row) => !rowHasPatchData(row));
    if (!emptyRows.length) return toast("Patchelisten har ingen tomme kanaler.");
    emptyRows.forEach((row) => row.remove());
    updatePatchControls();
    markProjectUnsaved();
    toast(`${emptyRows.length} tomme ${emptyRows.length === 1 ? "kanal er" : "kanaler er"} fjernet.`);
  }

  function bindTimeEntryActions() {
    document.querySelectorAll("[data-delete-time]").forEach((button) => {
      button.onclick = () => deleteTimeEntry(button.dataset.deleteTime);
    });
  }

  function refreshTimeLog(project) {
    const summary = document.getElementById("time-summary");
    const list = document.getElementById("time-entry-list");
    if (!summary || !list || project.id !== selectedProjectId) return;
    summary.innerHTML = timeSummary(project);
    list.innerHTML = timeEntryRows(project);
    const projectButtonCopy = document.querySelector(`[data-project-id="${CSS.escape(project.id)}"] span`);
    if (projectButtonCopy) projectButtonCopy.textContent = `${project.clientName || "Ingen kunde"} · ${project.status} · ${formatHours(timeTotals(project).total)}`;
    bindTimeEntryActions();
  }

  async function saveTimeEntry(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const project = projects.find((item) => item.id === selectedProjectId);
    if (!project) return;
    const values = new FormData(form);
    const hours = Number(String(values.get("hours") || "").replace(",", "."));
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return toast("Registrer mellom 0,25 og 24 timer.");
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Lagrer …";
    try {
      const data = await request("/api/studio?action=projects", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          changes: {
            timeEntries: [...(project.timeEntries || []), {
              id: `time-${crypto.randomUUID()}`,
              date: values.get("date"),
              category: values.get("category"),
              hours,
              worker: values.get("worker"),
              notes: values.get("notes"),
              createdAt: new Date().toISOString(),
            }],
          },
        }),
      });
      projects = projects.map((item) => item.id === data.project.id ? data.project : item);
      form.reset();
      form.elements.date.value = localDateValue();
      form.elements.worker.value = activeOwner;
      button.textContent = "+ Registrer timer";
      refreshTimeLog(data.project);
      toast(`${formatHours(hours)} ${String(values.get("category")).toLowerCase()} er registrert.`);
    } catch (error) {
      toast(error.message || "Timene kunne ikke registreres.");
    } finally {
      button.disabled = false;
      button.textContent = "+ Registrer timer";
    }
  }

  async function deleteTimeEntry(id) {
    const project = projects.find((item) => item.id === selectedProjectId);
    const entry = project?.timeEntries?.find((item) => item.id === id);
    if (!project || !entry || !confirm(`Slett ${formatHours(entry.hours)} ${entry.category.toLowerCase()} fra timeloggen?`)) return;
    try {
      const data = await request("/api/studio?action=projects", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: project.id, changes: { timeEntries: project.timeEntries.filter((item) => item.id !== id) } }),
      });
      projects = projects.map((item) => item.id === data.project.id ? data.project : item);
      refreshTimeLog(data.project);
      toast("Timeføringen er slettet.");
    } catch (error) {
      toast(error.message || "Timeføringen kunne ikke slettes.");
    }
  }

  async function addSpotifyReference(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const project = projects.find((item) => item.id === selectedProjectId);
    const parsed = spotifyReferenceInput(document.getElementById("spotify-reference-url").value);
    if (!project || !parsed) return toast("Lim inn en gyldig Spotify-lenke til en spilleliste, et album eller en låt.");
    const references = Array.isArray(project.spotifyReferences) ? project.spotifyReferences : [];
    if (references.length >= 12) return toast("Et prosjekt kan ha maksimalt 12 Spotify-referanser.");
    if (references.some((reference) => reference.type === parsed.type && reference.spotifyId === parsed.spotifyId)) return toast("Denne Spotify-referansen ligger allerede i prosjektet.");

    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Lagrer …";
    try {
      const data = await request("/api/studio?action=projects", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          changes: {
            spotifyReferences: [...references, {
              id: `spotify-${crypto.randomUUID()}`,
              url: parsed.url,
              title: document.getElementById("spotify-reference-title").value,
              note: document.getElementById("spotify-reference-note").value,
            }],
          },
        }),
      });
      projects = projects.map((item) => item.id === data.project.id ? data.project : item);
      form.reset();
      refreshSpotifyReferences(data.project);
      toast("Spotify-referansen er lagret på prosjektet.");
    } catch (error) {
      toast(error.message || "Spotify-referansen kunne ikke lagres.");
    } finally {
      button.disabled = false;
      button.textContent = "+ Legg til";
    }
  }

  async function removeSpotifyReference(id) {
    const project = projects.find((item) => item.id === selectedProjectId);
    const reference = project?.spotifyReferences?.find((item) => item.id === id);
    if (!project || !reference || !confirm(`Fjern «${reference.title}» fra prosjektets referanselåter?`)) return;
    try {
      const data = await request("/api/studio?action=projects", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: project.id, changes: { spotifyReferences: project.spotifyReferences.filter((item) => item.id !== id) } }),
      });
      projects = projects.map((item) => item.id === data.project.id ? data.project : item);
      refreshSpotifyReferences(data.project);
      toast("Spotify-referansen er fjernet fra prosjektet.");
    } catch (error) {
      toast(error.message || "Spotify-referansen kunne ikke fjernes.");
    }
  }

  function printPatchList() {
    const project = projects.find((item) => item.id === selectedProjectId);
    if (!project) return;

    document.querySelector(".patch-print-sheet")?.remove();
    const currentName = document.getElementById("project-name").value.trim() || project.name;
    const currentClient = document.getElementById("project-client").value.trim() || "—";
    const currentStatus = document.getElementById("project-status").value || project.status;
    const currentDate = document.getElementById("project-date").value;
    const sessionDate = currentDate
      ? new Date(`${currentDate}T12:00:00`).toLocaleDateString("nb-NO", { day: "2-digit", month: "2-digit", year: "numeric" })
      : "—";
    const printedAt = new Date().toLocaleString("nb-NO", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const rows = collectPatch().map((row) => `
      <tr>
        <td>${row.channel}</td>
        <td>${esc(row.source)}</td>
        <td>${esc(row.connection)}</td>
        <td>${esc(row.microphone)}</td>
        <td>${esc(row.preamp)}</td>
        <td>${esc(row.destination)}</td>
        <td class="print-phantom">${row.phantom ? "JA" : ""}</td>
        <td>${esc(row.notes)}</td>
      </tr>`).join("");

    const sheet = document.createElement("section");
    sheet.className = "patch-print-sheet";
    sheet.setAttribute("aria-hidden", "true");
    sheet.innerHTML = `
      <header class="patch-print-header">
        <div class="patch-print-brand"><img src="/assets/brand/loki-symbol.png" alt=""><div><strong>LOKI</strong><span>LYDSTUDIO · PATCHELISTE</span></div></div>
        <div class="patch-print-title"><span>PROSJEKT</span><h1>${esc(currentName)}</h1></div>
      </header>
      <dl class="patch-print-meta">
        <div><dt>Kunde / artist</dt><dd>${esc(currentClient)}</dd></div>
        <div><dt>Dato</dt><dd>${esc(sessionDate)}</dd></div>
        <div><dt>Status</dt><dd>${esc(currentStatus)}</dd></div>
        <div><dt>Skrevet ut</dt><dd>${esc(printedAt)}</dd></div>
      </dl>
      <table class="patch-print-table">
        <thead><tr><th>CH</th><th>KILDE</th><th>FYSISK INPUT</th><th>MIK / DI</th><th>PREAMP</th><th>ROUTING</th><th>+48V</th><th>NOTAT</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <footer>Loki Lydstudio · Frydenbølien 17 · lokilyd.no</footer>`;
    document.body.appendChild(sheet);
    document.body.classList.add("printing-patch");

    const cleanup = () => {
      document.body.classList.remove("printing-patch");
      sheet.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    setTimeout(() => {
      if (document.body.contains(sheet) && !window.matchMedia("print").matches) cleanup();
    }, 1_000);
  }

  async function saveProject() {
    const button = document.getElementById("save-project");
    button.disabled = true;
    button.textContent = "Lagrer …";
    try {
      const data = await request("/api/studio?action=projects", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: selectedProjectId,
          changes: {
            name: document.getElementById("project-name").value,
            clientName: document.getElementById("project-client").value,
            clientEmail: document.getElementById("project-email").value,
            status: document.getElementById("project-status").value,
            sessionDate: document.getElementById("project-date").value,
            notes: document.getElementById("project-notes").value,
            spotifyReferences: projects.find((project) => project.id === selectedProjectId)?.spotifyReferences || [],
            patch: collectPatch(),
          },
        }),
      });
      projects = projects.map((project) => project.id === data.project.id ? data.project : project);
      render();
      const channelCount = data.project.patch.length;
      toast(`Prosjekt og patcheliste med ${channelCount} ${channelCount === 1 ? "kanal" : "kanaler"} er lagret.`);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Lagre prosjekt";
      toast(error.message || "Prosjektet kunne ikke lagres.");
    }
  }

  function safeFilename(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/^\.+/, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 180);
  }

  function archiveSegment(value, fallback = "prosjekt") {
    return safeFilename(value).replace(/[^\p{L}\p{N}._-]/gu, "-").slice(0, 120) || fallback;
  }

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function patchCsv(patch) {
    const headings = ["Kanal", "Kilde", "Fysisk input", "Mikrofon / DI", "Preamp", "Routing", "+48V", "Notat"];
    const lines = [headings, ...(patch || []).map((row) => [
      row.channel,
      row.source,
      row.connection,
      row.microphone,
      row.preamp,
      row.destination,
      row.phantom ? "Ja" : "Nei",
      row.notes,
    ])];
    return `\ufeff${lines.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
  }

  function timeLogCsv(entries) {
    const headings = ["Dato", "Arbeidstype", "Utført av", "Timer", "Notat"];
    const lines = [headings, ...(entries || []).map((entry) => [entry.date, entry.category, entry.worker, entry.hours, entry.notes])];
    return `\ufeff${lines.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
  }

  function exportEntries(manifest) {
    const encoder = new TextEncoder();
    const textEntry = (name, input) => ({ name, input, size: encoder.encode(input).byteLength });
    const readme = [
      "LOKI LYDSTUDIO – COLD STORAGE-BACKUP",
      "",
      `Eksportert: ${new Date(manifest.exportedAt).toLocaleString("nb-NO")}`,
      `Omfang: ${manifest.scope === "project" ? "Ett prosjekt" : "Alle prosjekter"}`,
      `Antall prosjekter: ${manifest.projects.length}`,
      `Antall lydfiler: ${manifest.files.length}`,
      "",
      "Hver prosjektmappe inneholder prosjekt.json med Spotify-referanser, patcheliste.csv, timelogg.csv og mappen Lydfiler.",
      "Arkivet inneholder kundeopplysninger og kan inneholde upublisert lyd. Oppbevar det sikkert og kryptert.",
      "Lydfilene lagres uten ekstra ZIP-komprimering for effektiv eksport og tapsfri bevaring.",
      "",
    ].join("\r\n");
    const entries = [textEntry("README.txt", readme)];

    manifest.projects.forEach((project) => {
      const projectSuffix = archiveSegment(project.id, "id").slice(-12);
      const root = `${archiveSegment(project.name) || "prosjekt"}-${projectSuffix}`;
      const projectData = { ...project };
      entries.push(textEntry(`${root}/prosjekt.json`, `${JSON.stringify(projectData, null, 2)}\n`));
      entries.push(textEntry(`${root}/patcheliste.csv`, patchCsv(project.patch)));
      entries.push(textEntry(`${root}/timelogg.csv`, timeLogCsv(project.timeEntries)));
      const projectFiles = manifest.files.filter((file) => file.projectId === project.id);
      projectFiles.forEach((file, index) => {
        entries.push({
          kind: "audio",
          name: `${root}/Lydfiler/${String(index + 1).padStart(2, "0")}-${archiveSegment(file.version, "versjon")}-${archiveSegment(file.filename, "lydfil")}`,
          size: Number(file.size) || 0,
          url: file.downloadUrl,
        });
      });
    });

    return entries;
  }

  async function* zipInputs(entries, statusNode) {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (statusNode) statusNode.textContent = `Pakker ${index + 1} av ${entries.length}: ${entry.name.split("/").pop()}`;
      if (entry.kind !== "audio") {
        yield { name: entry.name, input: entry.input, size: entry.size, lastModified: new Date() };
        continue;
      }
      const response = await fetch(entry.url, { credentials: "same-origin" });
      if (response.status === 401) {
        location.replace("/crm-login.html");
        throw new Error("Innlogging kreves.");
      }
      if (!response.ok) throw new Error(`Kunne ikke hente ${entry.name.split("/").pop()}.`);
      yield { name: entry.name, input: response, size: entry.size, lastModified: new Date() };
    }
  }

  async function exportProjects(projectId, button) {
    if (!projects.length || !window.LokiZip?.downloadZip) return toast("ZIP-modulen kunne ikke lastes.");
    const selected = projectId ? projects.find((project) => project.id === projectId) : null;
    const hasUnsavedChanges = document.getElementById("project-save-state")?.textContent === "Ulagrede endringer";
    if (hasUnsavedChanges && !confirm("Backupen inneholder sist lagrede versjon. Fortsett uten de ulagrede endringene?")) return;
    const date = new Date().toISOString().slice(0, 10);
    const filename = projectId
      ? `Loki-${archiveSegment(selected?.name)}-${date}.zip`
      : `Loki-alle-prosjekter-${date}.zip`;
    const originalText = button.textContent;
    const statusNode = projectId ? document.getElementById("project-export-state") : null;
    let fileHandle = null;

    try {
      if (window.showSaveFilePicker) {
        try {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: "ZIP-arkiv", accept: { "application/zip": [".zip"] } }],
          });
        } catch (error) {
          if (error?.name === "AbortError") return;
          throw error;
        }
      }

      button.disabled = true;
      button.textContent = "Forbereder …";
      if (statusNode) {
        statusNode.hidden = false;
        statusNode.textContent = "Henter eksportoversikt …";
      }
      const query = projectId ? `&id=${encodeURIComponent(projectId)}` : "";
      const manifest = await request(`/api/studio?action=project-export${query}`);
      const entries = exportEntries(manifest);
      const totalAudioSize = manifest.files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);

      if (!fileHandle && totalAudioSize > 750 * 1024 * 1024 && !confirm(`Denne backupen inneholder ${formatBytes(totalAudioSize)} lyd. Nettleseren må holde hele ZIP-filen i minnet før nedlasting. Fortsett?`)) return;

      button.textContent = "Eksporterer …";
      const metadata = entries.map(({ name, size }) => ({ name, size }));
      const zipResponse = window.LokiZip.downloadZip(zipInputs(entries, statusNode), { metadata });
      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await zipResponse.body.pipeTo(writable);
      } else {
        const blob = await zipResponse.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      toast(projectId ? "Prosjektbackupen er lagret som ZIP." : "Full prosjektbackup er lagret som ZIP.");
    } catch (error) {
      toast(error.message || "ZIP-backupen kunne ikke opprettes.");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
      if (statusNode) statusNode.hidden = true;
    }
  }

  async function deleteProject() {
    const project = projects.find((item) => item.id === selectedProjectId);
    if (!project) return;
    const attachedCount = projectTracks().length;
    const audioWarning = attachedCount
      ? ` og ${attachedCount} ${attachedCount === 1 ? "tilknyttet lydfil" : "tilknyttede lydfiler"}`
      : "";
    if (!confirm(`Slett «${project.name}»${audioWarning} permanent?\n\nEksporter gjerne en ZIP-backup først. Handlingen kan ikke angres.`)) return;

    const button = document.getElementById("delete-project");
    button.disabled = true;
    button.textContent = "Sletter …";
    try {
      const result = await request(`/api/studio?action=projects&id=${encodeURIComponent(project.id)}`, { method: "DELETE" });
      const deletedTrackIds = new Set(tracks.filter((track) => track.projectId === project.id).map((track) => track.id));
      projects = projects.filter((item) => item.id !== project.id);
      tracks = tracks.filter((track) => track.projectId !== project.id);
      audioComments = audioComments.filter((comment) => !deletedTrackIds.has(comment.trackId));
      selectedProjectId = projects[0]?.id || null;
      render();
      const trackText = result.deletedTrackCount ? ` og ${result.deletedTrackCount} lydfil${result.deletedTrackCount === 1 ? "" : "er"}` : "";
      toast(`Prosjektet${trackText} er slettet permanent.`);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Slett prosjekt";
      toast(error.message || "Prosjektet kunne ikke slettes.");
    }
  }

  async function uploadAudio(event) {
    event.preventDefault();
    const file = document.getElementById("audio-file").files[0];
    const extension = String(file?.name || "").split(".").pop().toLowerCase();
    if (!file || !audioTypes[extension]) return toast("Velg WAV, MP3, FLAC, AIFF, M4A, AAC, OGG eller WebM.");
    if (file.size > 750 * 1024 * 1024) return toast("Lydfilen kan være maksimalt 750 MB.");
    if (!window.LokiBlob?.uploadPresigned) return toast("Opplastingsmodulen kunne ikke lastes.");

    const button = document.getElementById("upload-audio");
    const progress = document.getElementById("upload-progress");
    const bar = progress.querySelector("i");
    const filename = safeFilename(file.name);
    const trackId = `track-${crypto.randomUUID()}`;
    const pathname = `loki-crm/audio/${trackId}/${filename}`;
    button.disabled = true;
    button.textContent = "Laster opp …";
    progress.classList.add("active");

    try {
      const blob = await window.LokiBlob.uploadPresigned(pathname, file, {
        access: "private",
        contentType: audioTypes[extension],
        handleUploadUrl: "/api/studio?action=upload",
        clientPayload: JSON.stringify({ projectId: selectedProjectId, trackId, filename }),
        multipart: true,
        onUploadProgress: ({ percentage }) => { bar.style.width = `${Math.max(2, percentage)}%`; },
      });
      const data = await request("/api/studio?action=audio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "register",
          track: {
            id: trackId,
            projectId: selectedProjectId,
            pathname: blob.pathname,
            filename,
            title: document.getElementById("audio-title").value || filename.replace(/\.[^.]+$/, ""),
            version: document.getElementById("audio-version").value || "V1",
          },
        }),
      });
      tracks.unshift(data.track);
      render();
      toast("Lydfilen er lastet opp privat og klar i spilleren.");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Last opp";
      progress.classList.remove("active");
      toast(error.message || "Lydfilen kunne ikke lastes opp.");
    }
  }

  async function shareTrack(id) {
    try {
      const data = await request("/api/studio?action=audio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "share", id, days: 14 }),
      });
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.url);
        toast("Kundelenken er kopiert. Den utløper om 14 dager.");
      } else {
        window.prompt("Kopier kundelenken:", data.url);
      }
    } catch (error) {
      toast(error.message || "Kundelenken kunne ikke opprettes.");
    }
  }

  async function deleteTrack(id) {
    const track = tracks.find((item) => item.id === id);
    if (!track || !confirm(`Slett «${track.title} · ${track.version}» permanent fra lydlageret?`)) return;
    try {
      await request(`/api/studio?action=audio&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      tracks = tracks.filter((item) => item.id !== id);
      audioComments = audioComments.filter((comment) => comment.trackId !== id);
      render();
      toast("Lydfilen er slettet fra plattformen.");
    } catch (error) {
      toast(error.message || "Lydfilen kunne ikke slettes.");
    }
  }

  function setupModal() {
    const modal = document.getElementById("project-modal");
    const close = () => modal.classList.remove("open");
    document.getElementById("new-project").onclick = () => modal.classList.add("open");
    document.getElementById("export-all-projects").onclick = (event) => exportProjects(null, event.currentTarget);
    document.getElementById("close-project-modal").onclick = close;
    document.getElementById("cancel-project-modal").onclick = close;
    document.getElementById("project-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const data = await request("/api/studio?action=projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ project: Object.fromEntries(values) }),
        });
        projects.unshift(data.project);
        selectedProjectId = data.project.id;
        form.reset();
        close();
        render();
        toast("Prosjekt opprettet med 32 klare kanaler.");
      } catch (error) {
        toast(error.message || "Prosjektet kunne ikke opprettes.");
      } finally {
        button.disabled = false;
      }
    };
  }

  async function init(options = {}) {
    if (initialized) return;
    initialized = true;
    activeOwner = String(options.user?.email || "").toLowerCase().startsWith("charles@") ? "Charles" : "Leon";
    setupModal();
    try {
      const [projectData, audioData] = await Promise.all([
        request("/api/studio?action=projects"),
        request("/api/studio?action=audio"),
      ]);
      projects = projectData.projects || [];
      tracks = audioData.tracks || [];
      audioComments = audioData.comments || [];
      selectedProjectId = projects[0]?.id || null;
      render();
    } catch (error) {
      initialized = false;
      toast(error.message || "Studiomodulen kunne ikke lastes.");
    }
  }

  window.LokiStudio = { init };
})();
