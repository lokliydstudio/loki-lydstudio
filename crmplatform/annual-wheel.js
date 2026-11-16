(function () {
  "use strict";

  const endpoint = "/api/studio?action=annual-wheel";
  const monthShort = ["JAN", "FEB", "MAR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DES"];
  const state = { wheel: null, selectedMonth: 1, editingMonth: false, initialized: false, saving: false };

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
  const lines = (value) => String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const polar = (center, radius, degrees) => {
    const radians = (degrees - 90) * Math.PI / 180;
    return { x: center + radius * Math.cos(radians), y: center + radius * Math.sin(radians) };
  };
  const sectorPath = (index) => {
    const center = 210;
    const outer = 184;
    const inner = 101;
    const start = index * 30 + 1.3;
    const end = (index + 1) * 30 - 1.3;
    const outerStart = polar(center, outer, start);
    const outerEnd = polar(center, outer, end);
    const innerEnd = polar(center, inner, end);
    const innerStart = polar(center, inner, start);
    return `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)} A ${outer} ${outer} 0 0 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)} L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)} A ${inner} ${inner} 0 0 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)} Z`;
  };

  function status(message, tone = "") {
    const node = document.getElementById("annual-wheel-status");
    if (!node) return;
    node.textContent = message;
    node.className = `annual-wheel-status ${tone}`.trim();
  }

  function updateMeta() {
    const heading = document.getElementById("annual-wheel-heading");
    const updated = document.getElementById("annual-wheel-updated");
    if (heading) heading.textContent = `Årshjul ${state.wheel.year}`;
    if (!updated) return;
    if (!state.wheel.updatedAt) {
      updated.textContent = "Grunnplan klar til bruk";
      return;
    }
    const date = new Date(state.wheel.updatedAt);
    const actor = String(state.wheel.updatedBy || "").split("@")[0];
    updated.textContent = `Sist oppdatert ${new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short" }).format(date)}${actor ? ` av ${actor}` : ""}`;
  }

  function renderWheel() {
    const svg = document.getElementById("annual-wheel-svg");
    if (!svg || !state.wheel) return;
    const sectors = state.wheel.months.map((month, index) => {
      const angle = index * 30 + 15;
      const label = polar(210, 142, angle);
      const active = state.selectedMonth === month.month;
      return `<g class="annual-wheel-sector${active ? " active" : ""}" data-wheel-month="${month.month}" role="button" tabindex="0" aria-label="${esc(`${month.name}: ${month.focus}`)}" aria-pressed="${String(active)}"><path d="${sectorPath(index)}"></path><text x="${label.x.toFixed(2)}" y="${(label.y + 4).toFixed(2)}" text-anchor="middle">${monthShort[index]}</text></g>`;
    }).join("");
    svg.innerHTML = `${sectors}<circle class="annual-wheel-center" cx="210" cy="210" r="86"></circle><text class="annual-wheel-center-kicker" x="210" y="184" text-anchor="middle">${esc(state.wheel.title.toUpperCase())}</text><text class="annual-wheel-center-year" x="210" y="226" text-anchor="middle">${state.wheel.year}</text><text class="annual-wheel-center-copy" x="210" y="251" text-anchor="middle">ÅRSPLAN</text>`;
    svg.querySelectorAll("[data-wheel-month]").forEach((node) => {
      const select = () => {
        state.selectedMonth = Number(node.dataset.wheelMonth);
        state.editingMonth = false;
        renderWheel();
        renderMonth();
      };
      node.addEventListener("click", select);
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      });
    });
  }

  function renderMonth() {
    const container = document.getElementById("annual-month-detail");
    const month = state.wheel?.months.find((item) => item.month === state.selectedMonth);
    if (!container || !month) return;
    if (state.editingMonth) {
      container.innerHTML = `<form class="annual-month-form" id="annual-month-form"><div class="annual-month-number">${String(month.month).padStart(2, "0")}</div><div><span class="kicker">REDIGER ${esc(month.name.toUpperCase())}</span><h3>${esc(month.name)}</h3></div><label>Hovedfokus<input name="focus" required maxlength="160" value="${esc(month.focus)}"></label><label>Oppgaver og aktiviteter <small>Én aktivitet per linje</small><textarea name="items" rows="10" maxlength="5000">${esc(month.items.join("\n"))}</textarea></label><div class="button-row"><button class="secondary" type="button" id="annual-month-cancel">Avbryt</button><button class="primary" type="submit">Lagre måned</button></div></form>`;
      document.getElementById("annual-month-cancel").onclick = () => { state.editingMonth = false; renderMonth(); };
      document.getElementById("annual-month-form").onsubmit = async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        month.focus = String(data.get("focus") || "").trim();
        month.items = lines(data.get("items"));
        if (await saveWheel()) {
          state.editingMonth = false;
          renderAll();
        }
      };
      return;
    }
    container.innerHTML = `<div class="annual-month-head"><div class="annual-month-number">${String(month.month).padStart(2, "0")}</div><div><span class="kicker">${esc(month.name.toUpperCase())}</span><h3>${esc(month.focus)}</h3></div><button class="annual-edit-button" type="button" id="annual-month-edit" aria-label="Rediger planen for ${esc(month.name)}"><span aria-hidden="true">✎</span> Rediger</button></div><ol class="annual-month-items">${month.items.map((item) => `<li><span aria-hidden="true"></span><p>${esc(item)}</p></li>`).join("") || '<li class="annual-empty">Ingen aktiviteter er lagt inn.</li>'}</ol>`;
    document.getElementById("annual-month-edit").onclick = () => { state.editingMonth = true; renderMonth(); container.querySelector("input")?.focus(); };
  }

  function renderRhythms() {
    const rhythmGrid = document.getElementById("annual-rhythm-grid");
    const goalList = document.getElementById("annual-goal-list");
    if (!rhythmGrid || !goalList || !state.wheel) return;
    rhythmGrid.innerHTML = state.wheel.rhythms.map((rhythm, index) => `<article><span class="annual-rhythm-index">0${index + 1}</span><h3>${esc(rhythm.label)}</h3><ul>${rhythm.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></article>`).join("");
    goalList.innerHTML = state.wheel.goals.map((goal, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span><p>${esc(goal)}</p></li>`).join("");
  }

  function fillRhythmForm() {
    document.getElementById("annual-title").value = state.wheel.title;
    document.getElementById("annual-year").value = state.wheel.year;
    ["weekly", "monthly", "quarterly"].forEach((id) => {
      document.getElementById(`annual-${id}`).value = state.wheel.rhythms.find((rhythm) => rhythm.id === id)?.items.join("\n") || "";
    });
    document.getElementById("annual-goals").value = state.wheel.goals.join("\n");
  }

  function toggleRhythmForm(open) {
    const form = document.getElementById("annual-rhythm-form");
    const button = document.getElementById("annual-edit-rhythm");
    if (!form || !button) return;
    form.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      fillRhythmForm();
      form.scrollIntoView({ block: "start", behavior: "smooth" });
      document.getElementById("annual-title")?.focus({ preventScroll: true });
    }
  }

  async function saveWheel() {
    if (state.saving) return false;
    state.saving = true;
    status("Lagrer endringer …", "saving");
    document.querySelectorAll("#annual-wheel button").forEach((button) => { button.disabled = true; });
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wheel: state.wheel }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Årshjulet kunne ikke lagres.");
      state.wheel = data.wheel;
      status("Alle endringer er lagret", "saved");
      updateMeta();
      return true;
    } catch (error) {
      status(error.message || "Årshjulet kunne ikke lagres.", "error");
      return false;
    } finally {
      state.saving = false;
      document.querySelectorAll("#annual-wheel button").forEach((button) => { button.disabled = false; });
    }
  }

  function renderAll() {
    renderWheel();
    renderMonth();
    renderRhythms();
    updateMeta();
  }

  function bind() {
    document.getElementById("annual-edit-rhythm").onclick = () => toggleRhythmForm(true);
    document.getElementById("annual-rhythm-cancel").onclick = () => toggleRhythmForm(false);
    document.getElementById("annual-rhythm-form").onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      state.wheel.title = String(data.get("title") || "").trim();
      state.wheel.year = Number(data.get("year"));
      state.wheel.rhythms = state.wheel.rhythms.map((rhythm) => ({
        ...rhythm,
        items: lines(data.get(rhythm.id)),
      }));
      state.wheel.goals = lines(data.get("goals"));
      if (await saveWheel()) {
        toggleRhythmForm(false);
        renderAll();
      }
    };
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    bind();
    status("Henter årsplan …");
    try {
      const response = await fetch(endpoint, { credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Årshjulet kunne ikke hentes.");
      state.wheel = data.wheel;
      const now = new Date();
      state.selectedMonth = state.wheel.year === now.getFullYear() ? now.getMonth() + 1 : 1;
      renderAll();
      status("Årsplanen er oppdatert", "saved");
    } catch (error) {
      status(error.message || "Årshjulet kunne ikke hentes.", "error");
      const detail = document.getElementById("annual-month-detail");
      if (detail) detail.innerHTML = '<div class="annual-load-error"><strong>Kunne ikke hente årshjulet</strong><p>Prøv å laste siden på nytt.</p></div>';
    }
  }

  window.LokiAnnualWheel = { init };
})();
