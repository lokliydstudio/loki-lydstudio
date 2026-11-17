(() => {
  "use strict";

  const guide = Object.freeze({
    title: "Veiledning for revisjoner",
    introduction: [
      "Hos Loki Studio ønsker vi at du skal være fornøyd med det ferdige resultatet. Derfor får du muligheten til å lytte gjennom miksen og komme med tilbakemeldinger før den endelige godkjenningen.",
    ],
    sections: Object.freeze([
      Object.freeze({
        heading: "Hva er en revisjon?",
        paragraphs: [
          "En revisjon er én samlet runde med justeringer av en miks eller lydleveranse, basert på tilbakemeldingene dine.",
          "Det kan blant annet innebære:",
        ],
        bullets: [
          ["Volum og balanse", "Justering av nivået på vokal, instrumenter eller andre elementer i miksen."],
          ["Lyd og klang", "Endringer i bass, diskant, EQ, romklang eller andre lydeffekter."],
          ["Dynamikk", "Justeringer av kompresjon, punch og forholdet mellom ulike elementer."],
          ["Detaljer", "Mindre justeringer på bestemte steder i låten, eksempelvis overganger, effekter eller enkelte partier."],
        ],
      }),
      Object.freeze({
        heading: "Hva regnes som én revisjon?",
        paragraphs: [
          "Én revisjon innebærer én samlet runde med tilbakemeldinger på en levert versjon.",
          "Vi anbefaler at du lytter gjennom hele låten og samler alle ønskede endringer før du sender inn tilbakemeldingen.",
          "Dersom du har mottatt flere låter, kan du gi tilbakemeldinger på hver enkelt låt.",
          "Når vi har mottatt ønskene dine, gjennomfører vi de avtalte justeringene og sender en oppdatert versjon til gjennomlytting.",
        ],
      }),
      Object.freeze({
        heading: "Hva inngår normalt ikke i en revisjon?",
        paragraphs: [
          "En revisjon gjelder justeringer av den eksisterende miksen, ikke større endringer i selve produksjonen.",
          "Følgende kan derfor falle utenfor en vanlig revisjon:",
        ],
        bullets: [
          "Ny innspilling av vokal eller instrumenter.",
          "Vesentlige endringer i arrangement eller låtstruktur.",
          "Tillegg av nye instrumenter eller lydspor.",
          "Omfattende redigering eller produksjonsarbeid som ikke var en del av den opprinnelige avtalen.",
          "En fullstendig ny miks med en vesentlig annen kreativ retning.",
        ],
        closing: [
          "Slike endringer kan vi selvfølgelig hjelpe med, men de kan kreve en egen avtale.",
        ],
      }),
      Object.freeze({
        heading: "Slik gir du gode tilbakemeldinger",
        paragraphs: [
          "For at vi skal kunne gjøre justeringene så presist som mulig, anbefaler vi at du:",
        ],
        steps: [
          "Lytter gjennom hele låten før du sender inn ønskene dine.",
          "Bruker kommentarfeltet til å beskrive hva du ønsker endret.",
          "Legger inn kommentarer på bestemte tidspunkter dersom endringen gjelder et spesifikt parti.",
          "Beskriver hva du opplever og gjerne hva du ønsker å oppnå.",
        ],
        example: "Ved 01:24 synes jeg vokalen blir litt lav i forhold til instrumentene. Kan den løftes noe i dette partiet?",
        closing: [
          "Du trenger ikke å bruke tekniske uttrykk. Beskriv gjerne hvordan du ønsker at lyden skal oppleves, så finner vi den beste løsningen.",
        ],
      }),
      Object.freeze({
        heading: "Når du er fornøyd",
        paragraphs: [
          "Når du har lyttet gjennom låten og ikke har flere endringsønsker, kan du trykke på «Godkjenn miks».",
          "Da registreres den aktuelle versjonen som godkjent, og vi kan gå videre med leveransen i henhold til avtalen.",
          "Har du spørsmål underveis, er det bare å ta kontakt med oss.",
          "Vi ønsker at sluttresultatet skal bli så bra som mulig, og gode tilbakemeldinger er en viktig del av prosessen.",
        ],
        signature: "— Loki Studio",
      }),
    ]),
  });

  const appendParagraphs = (container, paragraphs = []) => {
    paragraphs.forEach((copy) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = copy;
      container.appendChild(paragraph);
    });
  };

  const render = (target) => {
    if (!target) return;
    target.replaceChildren();

    const intro = document.createElement("div");
    intro.className = "revision-guide-introduction";
    appendParagraphs(intro, guide.introduction);
    target.appendChild(intro);

    guide.sections.forEach((section) => {
      const article = document.createElement("section");
      article.className = "revision-guide-section";
      const heading = document.createElement("h3");
      heading.textContent = section.heading;
      article.appendChild(heading);
      appendParagraphs(article, section.paragraphs);

      if (section.bullets) {
        const list = document.createElement("ul");
        section.bullets.forEach((entry) => {
          const item = document.createElement("li");
          if (Array.isArray(entry)) {
            const label = document.createElement("strong");
            label.textContent = `${entry[0]}: `;
            item.append(label, document.createTextNode(entry[1]));
          } else {
            item.textContent = entry;
          }
          list.appendChild(item);
        });
        article.appendChild(list);
      }

      if (section.steps) {
        const list = document.createElement("ol");
        section.steps.forEach((copy) => {
          const item = document.createElement("li");
          item.textContent = copy;
          list.appendChild(item);
        });
        article.appendChild(list);
      }

      if (section.example) {
        const exampleLabel = document.createElement("p");
        exampleLabel.className = "revision-guide-example-label";
        exampleLabel.textContent = "Eksempel:";
        const quote = document.createElement("blockquote");
        quote.textContent = `«${section.example}»`;
        article.append(exampleLabel, quote);
      }

      appendParagraphs(article, section.closing);
      if (section.signature) {
        const signature = document.createElement("p");
        signature.className = "revision-guide-signature";
        signature.textContent = section.signature;
        article.appendChild(signature);
      }
      target.appendChild(article);
    });
  };

  const openDialog = (dialog, trigger) => {
    if (!dialog) return;
    dialog.__revisionGuideReturnTarget = trigger;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    requestAnimationFrame(() => dialog.querySelector("[data-revision-guide-close]")?.focus());
  };

  const closeDialog = (dialog) => {
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else {
      dialog.removeAttribute("open");
      dialog.dispatchEvent(new Event("close"));
    }
  };

  const init = (root = document) => {
    root.querySelectorAll("[data-revision-guide-title]").forEach((node) => {
      node.textContent = guide.title;
    });
    root.querySelectorAll("[data-revision-guide-content]").forEach(render);
    root.querySelectorAll("[data-revision-guide-open]").forEach((trigger) => {
      if (trigger.dataset.revisionGuideBound === "true") return;
      trigger.dataset.revisionGuideBound = "true";
      trigger.addEventListener("click", () => {
        const dialogId = trigger.getAttribute("aria-controls") || "revision-guide-dialog";
        openDialog(document.getElementById(dialogId), trigger);
      });
    });
    root.querySelectorAll("dialog[data-revision-guide-dialog]").forEach((dialog) => {
      if (dialog.dataset.revisionGuideBound === "true") return;
      dialog.dataset.revisionGuideBound = "true";
      dialog.querySelector("[data-revision-guide-close]")?.addEventListener("click", () => closeDialog(dialog));
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeDialog(dialog);
      });
      dialog.addEventListener("close", () => {
        const returnTarget = dialog.__revisionGuideReturnTarget;
        dialog.__revisionGuideReturnTarget = null;
        if (returnTarget?.isConnected) returnTarget.focus();
      });
    });
  };

  window.LokiRevisionGuide = Object.freeze({ guide, render, init });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => init());
  else init();
})();
