// Mise en forme de la fenetre « Lissage des taches » (styles.css) : largeur de la
// fenetre et icone du petit calendrier des cases de date manuelle.
//
// L'icone native du calendrier (::-webkit-calendar-picker-indicator) prend la
// couleur que le navigateur choisit : dans Grist, l'utilisateur la voyait blanc
// sur blanc (2026-11-09). On la dessine donc nous-memes, en bleu primaire, sur
// les deux cases de date (section « Plan particulier » et fenetre « Choisir les
// plans »).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS = readFileSync(fileURLToPath(new URL("../assets/css/styles.css", import.meta.url)), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

// Corps du PREMIER bloc dont le selecteur (liste) contient `selector`, hors
// @media. Echoue bruyamment si le bloc est absent.
function ruleBody(selector) {
  const blocks = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const found = blocks.find(([, selectors]) =>
    selectors.split(",").some((part) => part.trim() === selector)
  );
  assert.ok(found, `regle introuvable : ${selector}`);
  return found[2];
}

test("fenetre Lissage : aussi large que « Rechercher un plan » (1040 px)", () => {
  const body = ruleBody(".ps-modal-content--smoothing");
  assert.match(body, /width:\s*min\(1040px,\s*calc\(100vw - 32px\)\)/);
});

test("cases de date : l'icone du calendrier est dessinee en bleu, toujours visible", () => {
  for (const input of [".ps-smoothing-input--date", ".ps-plan-pick-date"]) {
    const body = ruleBody(`${input}::-webkit-calendar-picker-indicator`);
    assert.match(body, /opacity:\s*1/, `${input} : icone opaque`);
    assert.match(body, /background-image:\s*url\("data:image\/svg\+xml/, `${input} : icone dessinee`);
    assert.match(body, /%23004990/, `${input} : icone en bleu primaire (#004990)`);
    assert.match(body, /cursor:\s*pointer/, `${input} : curseur main`);
  }
});

test("cases de date : schema clair force, le texte reste lisible", () => {
  for (const input of [".ps-smoothing-input--date", ".ps-plan-pick-date"]) {
    const body = ruleBody(input);
    assert.match(body, /color-scheme:\s*light/, `${input} : color-scheme light`);
  }
});
