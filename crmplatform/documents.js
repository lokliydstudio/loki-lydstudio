(() => {
  const maxSize = 500 * 1024 * 1024;
  const safeExtensions = new Set([
    "aac", "aif", "aiff", "ai", "bmp", "csv", "doc", "docx", "epub", "flac", "gif", "heic", "indd",
    "jpeg", "jpg", "json", "key", "m4a", "m4v", "mov", "mp3", "mp4", "numbers", "odf", "ods", "odt",
    "ogg", "pages", "pdf", "png", "ppt", "pptx", "psd", "rtf", "tif", "tiff", "txt", "wav", "weba",
    "webm", "webp", "xls", "xlsx", "zip",
  ]);
  const mimeByExtension = {
    aac: "audio/aac", aif: "audio/aiff", aiff: "audio/aiff", bmp: "image/bmp", csv: "text/csv",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    epub: "application/epub+zip", flac: "audio/flac", gif: "image/gif", heic: "image/heic", jpeg: "image/jpeg",
    jpg: "image/jpeg", json: "application/json", m4a: "audio/mp4", m4v: "video/mp4", mov: "video/quicktime",
    mp3: "audio/mpeg", mp4: "video/mp4", ods: "application/vnd.oasis.opendocument.spreadsheet",
    odt: "application/vnd.oasis.opendocument.text", ogg: "audio/ogg", pdf: "application/pdf", png: "image/png",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    rtf: "application/rtf", tif: "image/tiff", tiff: "image/tiff", txt: "text/plain", wav: "audio/wav",
    weba: "audio/webm", webm: "video/webm", webp: "image/webp", xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zip: "application/zip",
  };
  let initialized = false;
  let documents = [];
  let uploadTargetId = null;

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);

  function toast(text) {
    const node = document.getElementById("toast");
    node.textContent = `✓ ${text}`;
    node.classList.add("show");
    clearTimeout(window.documentToastTimer);
    window.documentToastTimer = setTimeout(() => node.classList.remove("show"), 4200);
  }

  function extension(filename) {
    return String(filename || "").toLowerCase().split(".").pop();
  }

  function contentType(filename) {
    return mimeByExtension[extension(filename)] || "application/octet-stream";
  }

  function typeLabel(filename) {
    const ext = extension(filename);
    if (["xlsx", "xls", "csv", "numbers", "ods"].includes(ext)) return "Regneark";
    if (["doc", "docx", "odt", "pages", "rtf", "txt"].includes(ext)) return "Tekstdokument";
    if (ext === "pdf") return "PDF";
    if (["ppt", "pptx", "key"].includes(ext)) return "Presentasjon";
    if (["jpg", "jpeg", "png", "gif", "webp", "heic", "tif", "tiff", "bmp", "psd", "ai"].includes(ext)) return "Bilde";
    if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "Video";
    if (["wav", "mp3", "flac", "aif", "aiff", "m4a", "aac", "ogg", "weba"].includes(ext)) return "Lyd";
    return ext ? ext.toUpperCase() : "Dokument";
  }

  function safeFilename(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/^\.+/, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 180);
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
    return `${(bytes / 1024 / 1024).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} MB`;
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

  function updateConnectionStatus() {
    const available = documents.filter((item) => item.available).length;
    const jottaDot = document.getElementById("jotta-dot");
    const jottaStatus = document.getElementById("jotta-status");
    if (jottaDot) jottaDot.className = "dot green";
    if (jottaStatus) jottaStatus.textContent = documents.length
      ? `${documents.length} indeksert · ${available} kan åpnes`
      : "Bro klar · venter på første indeks";
  }

  function render() {
    const list = document.getElementById("document-list");
    const needle = String(document.getElementById("document-search")?.value || "").trim().toLowerCase();
    const visible = documents.filter((item) => `${item.name} ${item.path} ${item.type}`.toLowerCase().includes(needle));
    document.getElementById("document-count").textContent = `${documents.filter((item) => item.available).length} av ${documents.length} kan åpnes`;
    if (!visible.length) {
      list.innerHTML = `<div class="empty">${documents.length ? "Ingen dokumenter matcher søket." : "Ingen dokumenter er indeksert ennå."}</div>`;
      updateConnectionStatus();
      return;
    }
    list.innerHTML = visible.map((item) => {
      const actionUrl = `/api/crm/documents?action=download&id=${encodeURIComponent(item.id)}`;
      const actions = item.available
        ? `<div class="document-actions"><a class="tiny-button" href="${actionUrl}" target="_blank" rel="noreferrer">Åpne</a><a class="tiny-button" href="${actionUrl}&amp;download=1">Last ned</a></div>`
        : `<div class="document-actions"><button class="tiny-button" data-connect-document="${esc(item.id)}">Koble fil</button></div>`;
      return `<article class="doc-row"><div class="document-name"><span class="doc-icon">▱</span><span><strong>${esc(item.name)}</strong><small title="${esc(item.path)}">${esc(item.path)} · ${formatBytes(item.size)}</small></span></div><span>${esc(item.type)}</span><span><em class="state ${item.available ? "green" : "neutral"}">${item.available ? "Kan åpnes" : "Kun indeks"}</em></span><p>${esc(item.note)}</p>${actions}</article>`;
    }).join("");
    document.querySelectorAll("[data-connect-document]").forEach((button) => {
      button.onclick = () => chooseFiles(button.dataset.connectDocument);
    });
    updateConnectionStatus();
  }

  function chooseFiles(targetId = null) {
    const input = document.getElementById("document-upload-input");
    uploadTargetId = targetId;
    input.multiple = !targetId;
    input.value = "";
    input.click();
  }

  function matchingIndexedDocument(file) {
    const name = String(file.name || "").toLowerCase();
    const matches = documents.filter((item) => !item.available && item.name.toLowerCase() === name);
    return matches.length === 1 ? matches[0] : null;
  }

  async function uploadOne(file, target) {
    const ext = extension(file.name);
    if (!safeExtensions.has(ext)) throw new Error(`Filtypen .${ext || "ukjent"} er ikke tillatt.`);
    if (file.size > maxSize) throw new Error(`${file.name} er større enn grensen på 500 MB.`);
    if (target && target.name.toLowerCase() !== file.name.toLowerCase()) {
      throw new Error(`Velg filen «${target.name}» for denne raden.`);
    }

    const documentId = target?.id || `document-${crypto.randomUUID()}`;
    const filename = safeFilename(file.name);
    const pathname = `loki-crm/documents/${documentId}/${filename}`;
    const payload = {
      id: documentId,
      name: file.name,
      path: target?.path || file.name,
      type: target?.type || typeLabel(file.name),
      size: file.size,
      modifiedAt: new Date(file.lastModified || Date.now()).toISOString(),
    };
    const progress = document.getElementById("document-upload-progress");
    const bar = progress.querySelector("i");
    const status = document.getElementById("document-upload-status");
    status.textContent = `Laster opp ${file.name} · 0 %`;
    bar.style.width = "2%";

    const blob = await window.LokiBlob.upload(pathname, file, {
      access: "private",
      contentType: contentType(file.name),
      handleUploadUrl: "/api/crm/documents?action=upload",
      clientPayload: JSON.stringify(payload),
      multipart: true,
      onUploadProgress: ({ percentage }) => {
        const rounded = Math.max(0, Math.min(100, Math.round(percentage)));
        bar.style.width = `${Math.max(2, rounded)}%`;
        status.textContent = `Laster opp ${file.name} · ${rounded} %`;
      },
    });
    const result = await request("/api/crm/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "register", document: { ...payload, pathname: blob.pathname } }),
    });
    const index = documents.findIndex((item) => item.id === result.document.id);
    if (index >= 0) documents[index] = result.document;
    else documents.unshift(result.document);
  }

  async function uploadSelected(event) {
    const files = [...event.currentTarget.files];
    if (!files.length) return;
    if (!window.LokiBlob?.upload) return toast("Opplastingsmodulen kunne ikke lastes.");
    const button = document.getElementById("document-upload-button");
    const progress = document.getElementById("document-upload-progress");
    const target = uploadTargetId ? documents.find((item) => item.id === uploadTargetId) : null;
    button.disabled = true;
    progress.classList.add("active");
    try {
      for (const file of files) await uploadOne(file, target || matchingIndexedDocument(file));
      toast(`${files.length} ${files.length === 1 ? "fil er" : "filer er"} nå tilgjengelig i CRM.`);
    } catch (error) {
      toast(error.message || "Dokumentet kunne ikke lastes opp.");
    } finally {
      render();
      uploadTargetId = null;
      button.disabled = false;
      progress.classList.remove("active");
      document.getElementById("document-upload-status").textContent = "";
    }
  }

  async function load() {
    const data = await request("/api/crm/documents");
    documents = data.documents || [];
    render();
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    document.getElementById("document-upload-button").onclick = () => chooseFiles();
    document.getElementById("document-upload-input").onchange = uploadSelected;
    document.getElementById("document-search").oninput = render;
    try {
      await load();
    } catch (error) {
      initialized = false;
      document.getElementById("document-list").innerHTML = `<div class="empty">${esc(error.message || "Dokumentene kunne ikke lastes.")}</div>`;
    }
  }

  window.LokiDocuments = { init };
})();
