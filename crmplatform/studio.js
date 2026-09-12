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
  let selectedProjectId = null;

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

  function patchRows(project) {
    return project.patch.map((row) => `
      <tr data-channel="${row.channel}">
        <td><span class="channel-number">${row.channel}</span></td>
        <td><input type="text" data-field="source" value="${esc(row.source)}" aria-label="Kanal ${row.channel} lydkilde" placeholder="Vokal, kick, gitar …"></td>
        <td><input type="text" data-field="connection" value="${esc(row.connection)}" aria-label="Kanal ${row.channel} fysisk input" placeholder="Vegg A1 / XLR"></td>
        <td><input type="text" data-field="microphone" value="${esc(row.microphone)}" aria-label="Kanal ${row.channel} mikrofon" placeholder="U87 / DI"></td>
        <td><input type="text" data-field="preamp" value="${esc(row.preamp)}" aria-label="Kanal ${row.channel} preamp" placeholder="Neve / Interface"></td>
        <td><input type="text" data-field="destination" value="${esc(row.destination)}" aria-label="Kanal ${row.channel} routing" placeholder="Input ${row.channel}"></td>
        <td><input type="checkbox" data-field="phantom" ${row.phantom ? "checked" : ""} aria-label="Kanal ${row.channel} phantom power"></td>
        <td><input type="text" data-field="notes" value="${esc(row.notes)}" aria-label="Kanal ${row.channel} notat" placeholder="Pad, fase, HPF …"></td>
      </tr>`).join("");
  }

  function trackCards() {
    const visible = projectTracks();
    if (!visible.length) return '<div class="project-empty">Ingen lydfiler i prosjektet ennå.</div>';
    return visible.map((track) => `
      <article class="track-card">
        <div class="track-copy">
          <strong>${esc(track.title)} · ${esc(track.version)}</strong>
          <span>${esc(track.filename)} · ${formatBytes(track.size)}</span>
          <span>${esc(track.jottaStatus || "Venter på lokal synk")}</span>
        </div>
        <audio controls preload="metadata" src="/api/studio?action=internal-stream&amp;id=${encodeURIComponent(track.id)}">Nettleseren støtter ikke lydavspilling.</audio>
        <div class="track-actions">
          <button class="tiny-button" data-share-track="${esc(track.id)}">Kopier kundelenke</button>
          <button class="tiny-button danger" data-delete-track="${esc(track.id)}">Slett</button>
        </div>
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
      <section class="studio-section">
        <div class="studio-section-head"><div><span class="kicker">SIGNALFLYT</span><h3>32-kanals patcheliste</h3><p>Fysisk input → mikrofon / DI → preamp → lydkortets input.</p></div><div class="button-row"><button class="secondary" id="print-patch" type="button">⎙ Skriv ut patcheliste</button><span class="state green">32 kanaler</span></div></div>
        <div class="patch-wrap"><table class="patch-table"><thead><tr><th>CH</th><th>KILDE</th><th>FYSISK INPUT</th><th>MIK / DI</th><th>PREAMP</th><th>ROUTING</th><th>+48V</th><th>NOTAT</th></tr></thead><tbody id="patch-body">${patchRows(project)}</tbody></table></div>
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
        <strong>${esc(project.name)}</strong><span>${esc(project.clientName || "Ingen kunde")} · ${esc(project.status)}</span>
      </button>`).join("") : '<div class="project-empty">Ingen prosjekter ennå.</div>';

    const project = projects.find((item) => item.id === selectedProjectId);
    workspace.innerHTML = project ? editorMarkup(project) : '<div class="project-empty">Opprett et prosjekt for å sette opp de 32 kanalene og laste opp lyd.</div>';
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
    const deleteButton = document.getElementById("delete-project");
    if (deleteButton) deleteButton.onclick = deleteProject;
    const upload = document.getElementById("audio-upload-form");
    if (upload) upload.onsubmit = uploadAudio;
    document.querySelectorAll("[data-share-track]").forEach((button) => {
      button.onclick = () => shareTrack(button.dataset.shareTrack);
    });
    document.querySelectorAll("[data-delete-track]").forEach((button) => {
      button.onclick = () => deleteTrack(button.dataset.deleteTrack);
    });
    document.querySelectorAll("#project-workspace input, #project-workspace textarea, #project-workspace select").forEach((input) => {
      input.addEventListener("input", () => {
        const state = document.getElementById("project-save-state");
        if (state) state.textContent = "Ulagrede endringer";
      });
    });
  }

  function collectPatch() {
    return [...document.querySelectorAll("#patch-body tr")].map((row) => {
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
            patch: collectPatch(),
          },
        }),
      });
      projects = projects.map((project) => project.id === data.project.id ? data.project : project);
      render();
      toast("Prosjekt og 32-kanals patch er lagret.");
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
      "Hver prosjektmappe inneholder prosjekt.json, patcheliste.csv og mappen Lydfiler.",
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
      projects = projects.filter((item) => item.id !== project.id);
      tracks = tracks.filter((track) => track.projectId !== project.id);
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

  async function init() {
    if (initialized) return;
    initialized = true;
    setupModal();
    try {
      const [projectData, audioData] = await Promise.all([
        request("/api/studio?action=projects"),
        request("/api/studio?action=audio"),
      ]);
      projects = projectData.projects || [];
      tracks = audioData.tracks || [];
      selectedProjectId = projects[0]?.id || null;
      render();
    } catch (error) {
      initialized = false;
      toast(error.message || "Studiomodulen kunne ikke lastes.");
    }
  }

  window.LokiStudio = { init };
})();
