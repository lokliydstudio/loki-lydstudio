(() => {
  const form = document.getElementById("application-form");
  const status = document.getElementById("form-status");
  const submit = document.getElementById("submit-button");
  const submitLabel = document.getElementById("submit-label");
  const bio = form.elements.bio;
  const counter = document.getElementById("bio-count");
  const dietary = form.elements.dietary;
  const otherWrap = document.getElementById("dietary-other-wrap");
  const other = form.elements.dietaryOther;
  const dietaryConsent = form.elements.dietaryConsent;
  const dietaryConsentWrap = document.getElementById("dietary-consent-wrap");

  function updateBioCount() {
    const count = bio.value.trim().split(/\s+/).filter(Boolean).length;
    counter.textContent = `${count} / 500 ord`;
    counter.classList.toggle("over", count > 500);
  }

  function updateDietary() {
    otherWrap.hidden = dietary.value !== "Annet";
    other.required = dietary.value === "Annet";
    if (!other.required) other.value = "";
    const hasDietaryInformation = Boolean(dietary.value && !["Ingen", "Oppgis senere"].includes(dietary.value));
    dietaryConsentWrap.hidden = !hasDietaryInformation;
    dietaryConsent.required = hasDietaryInformation;
    if (!hasDietaryInformation) dietaryConsent.checked = false;
  }

  bio.addEventListener("input", updateBioCount);
  dietary.addEventListener("change", updateDietary);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";
    const roles = [...form.querySelectorAll('input[name="roles"]:checked')].map((input) => input.value);
    if (!roles.length) {
      status.textContent = "Velg minst én musikalsk rolle.";
      document.getElementById("roles-group").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const wordCount = bio.value.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount > 500) {
      status.textContent = "Musikkbiografien kan være på maks 500 ord.";
      bio.focus();
      return;
    }
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.roles = roles;
    payload.feeAccepted = data.has("feeAccepted");
    payload.privacyAccepted = data.has("privacyAccepted");
    payload.dietaryConsent = data.has("dietaryConsent");
    submit.disabled = true;
    submitLabel.textContent = "Sender …";
    try {
      const response = await fetch("/api/camp-application", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Søknaden kunne ikke sendes. Prøv igjen.");
      form.hidden = true;
      const success = document.getElementById("success-card");
      success.hidden = false;
      success.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      status.textContent = error.message || "Søknaden kunne ikke sendes. Prøv igjen.";
      status.scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      submit.disabled = false;
      submitLabel.textContent = "Send søknad";
    }
  });
  updateBioCount();
  updateDietary();
})();
