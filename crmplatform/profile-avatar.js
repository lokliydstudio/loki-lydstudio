(function () {
  "use strict";

  const endpoint = "/api/studio?action=profile";
  const types = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  const maxSize = 5 * 1024 * 1024;
  let currentUser = null;
  let currentProfile = null;
  let profiles = [];
  let initialized = false;

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);

  function setStatus(message, tone = "") {
    const node = document.getElementById("profile-avatar-status");
    if (!node) return;
    node.textContent = message;
    node.className = `profile-avatar-status ${tone}`.trim();
  }

  function renderAvatar(node, profile) {
    if (!node) return;
    const initial = profile?.initial || String(currentUser?.email || "L").slice(0, 1).toUpperCase();
    node.classList.toggle("has-image", Boolean(profile?.hasAvatar && profile.avatarUrl));
    node.innerHTML = profile?.hasAvatar && profile.avatarUrl
      ? `<img src="${esc(profile.avatarUrl)}" alt="">`
      : `<span>${esc(initial)}</span>`;
    const image = node.querySelector("img");
    if (image) image.addEventListener("error", () => {
      node.classList.remove("has-image");
      node.innerHTML = `<span>${esc(initial)}</span>`;
    }, { once: true });
  }

  function render(nextProfiles = profiles) {
    profiles = Array.isArray(nextProfiles) ? nextProfiles : [];
    currentProfile = profiles.find((profile) => profile.isCurrent) || currentProfile;
    document.querySelectorAll("[data-current-avatar]").forEach((node) => renderAvatar(node, currentProfile));
    const choose = document.getElementById("profile-avatar-choose");
    const remove = document.getElementById("profile-avatar-remove");
    if (choose) choose.textContent = currentProfile?.hasAvatar ? "Bytt profilbilde" : "Last opp profilbilde";
    if (remove) remove.hidden = !currentProfile?.hasAvatar;
    window.dispatchEvent(new CustomEvent("loki-profiles-updated", { detail: { current: currentProfile, profiles } }));
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Profilbildet kunne ikke oppdateres.");
    return data;
  }

  async function upload(file) {
    if (!file) return;
    if (!window.LokiBlob?.uploadPresigned) return setStatus("Opplastingsmodulen kunne ikke lastes.", "error");
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    const contentType = types[extension];
    if (!contentType || file.type !== contentType) return setStatus("Bruk JPEG, PNG eller WebP.", "error");
    if (file.size <= 0 || file.size > maxSize) return setStatus("Bildet kan være maksimalt 5 MB.", "error");
    const owner = String(currentUser?.email || "").split("@")[0].toLowerCase();
    const avatarId = `avatar-${crypto.randomUUID()}`;
    const filename = `${avatarId}.${extension === "jpeg" ? "jpg" : extension}`;
    const pathname = `loki-crm/profile-avatars/${owner}/${avatarId}/${filename}`;
    const choose = document.getElementById("profile-avatar-choose");
    const progress = document.getElementById("profile-avatar-progress");
    const progressBar = progress?.querySelector("i");
    if (choose) choose.disabled = true;
    if (progress) progress.hidden = false;
    if (progressBar) progressBar.style.width = "2%";
    setStatus("Laster opp profilbildet …", "saving");
    try {
      const blob = await window.LokiBlob.uploadPresigned(pathname, file, {
        access: "private",
        contentType,
        handleUploadUrl: "/api/studio?action=profile-avatar-upload",
        clientPayload: JSON.stringify({ avatarId, filename }),
        multipart: file.size > 4 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => {
          if (progressBar) progressBar.style.width = `${Math.max(2, Math.min(100, Math.round(percentage)))}%`;
        },
      });
      const data = await request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "register-avatar", avatar: { avatarId, filename, pathname: blob.pathname } }),
      });
      currentProfile = data.profile;
      render(data.profiles);
      setStatus("Profilbildet er lagret.", "saved");
    } catch (error) {
      setStatus(error.message || "Profilbildet kunne ikke lastes opp.", "error");
    } finally {
      if (choose) choose.disabled = false;
      if (progress) progress.hidden = true;
      if (progressBar) progressBar.style.width = "0";
      const input = document.getElementById("profile-avatar-input");
      if (input) input.value = "";
    }
  }

  async function remove() {
    if (!currentProfile?.hasAvatar || !confirm("Vil du fjerne profilbildet?")) return;
    const button = document.getElementById("profile-avatar-remove");
    if (button) button.disabled = true;
    setStatus("Fjerner profilbildet …", "saving");
    try {
      const data = await request(endpoint, { method: "DELETE" });
      currentProfile = data.profile;
      render(data.profiles);
      setStatus("Profilbildet er fjernet.", "saved");
    } catch (error) {
      setStatus(error.message || "Profilbildet kunne ikke fjernes.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function bind() {
    const input = document.getElementById("profile-avatar-input");
    document.getElementById("profile-avatar-choose").onclick = () => input.click();
    input.onchange = () => upload(input.files?.[0]);
    document.getElementById("profile-avatar-remove").onclick = remove;
  }

  async function init({ user } = {}) {
    currentUser = user || currentUser;
    if (initialized) return;
    initialized = true;
    bind();
    setStatus("Henter profil …");
    try {
      const data = await request(endpoint);
      currentProfile = data.profile;
      render(data.profiles);
      setStatus(currentProfile?.hasAvatar ? "Profilbildet er aktivt." : "Ingen profilbilde er lastet opp.");
    } catch (error) {
      setStatus(error.message || "Profilen kunne ikke hentes.", "error");
      throw error;
    }
  }

  window.LokiProfileAvatar = { init };
})();
