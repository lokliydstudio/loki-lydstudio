(function () {
  "use strict";

  const endpoint = "/api/studio?action=access";
  let currentUser = null;
  let initialized = false;
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const roleOptions = (selected) => [
    ["admin", "Administrator"],
    ["member", "Medarbeider"],
    ["viewer", "Lesetilgang"],
  ].map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`).join("");

  function setFeedback(message = "", tone = "") {
    const node = document.getElementById("access-feedback");
    if (!node) return;
    node.textContent = message;
    node.className = `access-feedback ${tone}`.trim();
  }

  async function request(url = endpoint, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Tilgangen kunne ikke oppdateres.");
    return data;
  }

  function applyPermissions(user) {
    currentUser = user;
    const permissions = new Set(user?.permissions || []);
    const canWrite = permissions.has("write");
    const canDelete = permissions.has("delete");
    document.body.classList.toggle("crm-read-only", !canWrite);
    document.body.classList.toggle("crm-no-delete", !canDelete);
    document.body.dataset.accessRole = user?.role || "";
    document.body.dataset.accessWrite = String(canWrite);
    document.body.dataset.accessDelete = String(canDelete);
    document.querySelectorAll("[data-owner-only]").forEach((node) => {
      if (node.matches("[data-settings-panel]")) {
        if (user?.role !== "owner") node.hidden = true;
        return;
      }
      node.hidden = user?.role !== "owner";
    });
    document.querySelectorAll("[data-current-role]").forEach((node) => { node.textContent = user?.roleLabel || "Bruker"; });
    const banner = document.getElementById("access-denied-banner");
    if (banner) banner.textContent = canWrite ? "" : "Du er logget inn med lesetilgang. Endringer, utsendinger og opplastinger er deaktivert.";
    const avatarControls = document.querySelector(".profile-avatar-controls");
    if (avatarControls) avatarControls.hidden = user?.role !== "owner";
    window.LokiCRMAccess = { user, canRead: permissions.has("read"), canWrite, canDelete, canManageUsers: permissions.has("manageUsers") };
  }

  function renderUsers(users = []) {
    const root = document.getElementById("access-user-list");
    if (!root) return;
    root.innerHTML = users.map((user) => {
      const owner = user.role === "owner";
      const initial = String(user.name || user.email || "?").slice(0, 1).toUpperCase();
      return `<div class="access-user-row" data-access-user="${esc(user.email)}"><div class="access-user"><span class="access-user-avatar">${esc(initial)}</span><span class="access-user-copy"><strong>${esc(user.name)}</strong><span>${esc(user.email)}</span></span></div>${owner ? `<strong>${esc(user.roleLabel)}</strong>` : `<select aria-label="Rolle for ${esc(user.name)}" data-user-role>${roleOptions(user.role)}</select>`}<span class="access-status ${esc(user.status)}">${user.status === "active" ? "Aktiv" : "Deaktivert"}</span><span class="access-row-actions">${owner ? '<span class="access-role-badge">Fast eier</span>' : `<button class="secondary" type="button" data-save-user>Lagre</button><button class="secondary" type="button" data-toggle-user>${user.status === "active" ? "Deaktiver" : "Aktiver"}</button>`}</span></div>`;
    }).join("");
    root.querySelectorAll("[data-save-user]").forEach((button) => button.addEventListener("click", () => saveUser(button.closest("[data-access-user]"), false)));
    root.querySelectorAll("[data-toggle-user]").forEach((button) => button.addEventListener("click", () => saveUser(button.closest("[data-access-user]"), true)));
  }

  function renderInvites(invites = []) {
    const root = document.getElementById("access-invite-list");
    if (!root) return;
    if (!invites.length) {
      root.innerHTML = '<div class="access-empty">Ingen ventende invitasjoner.</div>';
      return;
    }
    root.innerHTML = invites.map((invite) => `<div class="access-user-row" data-access-invite="${esc(invite.id)}"><div class="access-user"><span class="access-user-avatar">${esc(String(invite.name || invite.email).slice(0, 1).toUpperCase())}</span><span class="access-user-copy"><strong>${esc(invite.name)}</strong><span>${esc(invite.email)}</span></span></div><strong>${esc(invite.roleLabel)}</strong><span class="access-status ${esc(invite.status)}">${invite.status === "pending" ? "Venter" : "Utløpt"}</span><span class="access-row-actions"><button class="secondary" type="button" data-resend-invite>Send på nytt</button><button class="secondary" type="button" data-revoke-invite>Trekk tilbake</button></span></div>`).join("");
    root.querySelectorAll("[data-resend-invite]").forEach((button) => button.addEventListener("click", () => resendInvite(button.closest("[data-access-invite]"))));
    root.querySelectorAll("[data-revoke-invite]").forEach((button) => button.addEventListener("click", () => revokeInvite(button.closest("[data-access-invite]"))));
  }

  async function load() {
    const users = document.getElementById("access-user-list");
    if (users) users.innerHTML = '<div class="access-loading">Henter brukere og roller …</div>';
    try {
      const data = await request();
      renderUsers(data.users);
      renderInvites(data.invites);
    } catch (error) {
      if (users) users.innerHTML = `<div class="access-empty">${esc(error.message)}</div>`;
    }
  }

  async function saveUser(row, toggle) {
    const email = row?.dataset.accessUser;
    const select = row?.querySelector("[data-user-role]");
    const status = row?.querySelector(".access-status")?.classList.contains("active") ? "active" : "suspended";
    const nextStatus = toggle ? (status === "active" ? "suspended" : "active") : status;
    if (toggle && nextStatus === "suspended" && !confirm(`Deaktivere CRM-tilgangen for ${email}?`)) return;
    setFeedback("Oppdaterer tilgangen …");
    try {
      await request(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role: select.value, status: nextStatus }) });
      setFeedback("Tilgangen er oppdatert.", "success");
      await load();
    } catch (error) { setFeedback(error.message, "error"); }
  }

  async function resendInvite(row) {
    setFeedback("Sender invitasjonen på nytt …");
    try {
      await request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resend", id: row.dataset.accessInvite }) });
      setFeedback("En ny invitasjon er sendt.", "success");
      await load();
    } catch (error) { setFeedback(error.message, "error"); }
  }

  async function revokeInvite(row) {
    if (!confirm("Trekke tilbake denne invitasjonen?")) return;
    setFeedback("Trekker tilbake invitasjonen …");
    try {
      await request(`${endpoint}&id=${encodeURIComponent(row.dataset.accessInvite)}`, { method: "DELETE" });
      setFeedback("Invitasjonen er trukket tilbake.", "success");
      await load();
    } catch (error) { setFeedback(error.message, "error"); }
  }

  function bindOwnerControls() {
    const form = document.getElementById("access-invite-form");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const values = Object.fromEntries(new FormData(form));
      button.disabled = true;
      setFeedback("Sender sikker invitasjon …");
      try {
        await request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
        form.reset();
        form.elements.role.value = "member";
        setFeedback("Invitasjonen er sendt.", "success");
        await load();
      } catch (error) { setFeedback(error.message, "error"); }
      finally { button.disabled = false; }
    });
  }

  async function init({ user } = {}) {
    applyPermissions(user || currentUser || {});
    if (initialized) return;
    initialized = true;
    if (user?.role === "owner") {
      bindOwnerControls();
      await load();
    }
  }

  window.LokiAccessControl = { init, load, applyPermissions };
})();
