(() => {
  const list = document.getElementById("tasks");
  const status = document.getElementById("status");
  const form = document.getElementById("task-form");
  let tasks = [];
  let filter = "open";
  let userName = "";

  function message(value) { status.textContent = value || ""; }
  async function api(options = {}) {
    const response = await fetch("/api/studio?action=workspace", { credentials: "same-origin", ...options });
    if (response.status === 401) {
      location.replace("/crm-login.html");
      throw new Error("Innlogging kreves.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Kunne ikke hente oppgavene.");
    return data;
  }
  function taskNode(task) {
    const row = document.createElement("article");
    row.className = `task${task.completed ? " done" : ""}`;
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = Boolean(task.completed);
    check.setAttribute("aria-label", `Marker «${task.title}» som ${task.completed ? "åpen" : "fullført"}`);
    check.addEventListener("change", async () => {
      check.disabled = true;
      try {
        const data = await api({ method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: task.id, changes: { completed: check.checked } }) });
        tasks = tasks.map((item) => item.id === task.id ? data.item : item);
        message("");
        render();
      } catch (error) {
        check.checked = !check.checked;
        message(error.message);
        check.disabled = false;
      }
    });
    const copy = document.createElement("div");
    copy.className = "task-copy";
    const title = document.createElement("strong");
    title.textContent = task.title;
    const meta = document.createElement("small");
    meta.textContent = [task.assignee, task.dueDate ? `Frist ${task.dueDate}` : "Ingen frist", task.priority === "Høy" ? "Høy prioritet" : ""].filter(Boolean).join(" · ");
    copy.append(title, meta);
    if (task.details) {
      const details = document.createElement("small");
      details.textContent = task.details;
      copy.append(details);
    }
    row.append(check, copy);
    return row;
  }
  function render() {
    const open = tasks.filter((task) => !task.completed);
    document.getElementById("summary").textContent = `${open.length} åpne · ${tasks.length - open.length} fullført`;
    document.querySelectorAll("[data-filter]").forEach((button) => {
      const active = button.dataset.filter === filter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const visible = tasks.filter((task) => filter === "all" || (filter === "open" && !task.completed) || (filter === "mine" && !task.completed && (task.assignee === userName || task.assignee === "Begge")));
    visible.sort((left, right) => Number(left.completed) - Number(right.completed) || String(left.dueDate || "9999").localeCompare(String(right.dueDate || "9999")));
    list.replaceChildren(...visible.map(taskNode));
    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Ingen oppgaver i denne visningen.";
      list.append(empty);
    }
  }
  async function load() {
    try {
      const data = await api();
      tasks = data.tasks || [];
      message("");
      render();
    } catch (error) { message(error.message); }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const item = Object.fromEntries(new FormData(form));
      const data = await api({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "task", item }) });
      tasks.unshift(data.item);
      form.reset();
      message("");
      render();
    } catch (error) { message(error.message); }
    finally { button.disabled = false; }
  });
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { filter = button.dataset.filter; render(); }));
  document.getElementById("refresh").addEventListener("click", load);
  fetch("/api/crm/auth-status", { credentials: "same-origin" })
    .then((response) => { if (!response.ok) throw new Error("Innlogging kreves."); return response.json(); })
    .then((data) => { userName = data.user.email.startsWith("charles") ? "Charles" : "Leon"; return load(); })
    .catch(() => location.replace("/crm-login.html"));
})();
