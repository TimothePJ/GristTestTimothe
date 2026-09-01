// Rend le selecteur du bloc qui declare `name`, et la valeur declaree. La
// tolerance aux espaces evite qu'un simple reformatage du CSS fasse echouer le
// test pour une mauvaise raison.
function findDeclaration(name) {
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(CSS);
  if (!match) return null;
  const openBrace = CSS.lastIndexOf("{", match.index);
  const selector = CSS.slice(CSS.lastIndexOf("}", openBrace) + 1, openBrace);
  return {
    selector: selector.replace(/\/\*[\s\S]*?\*\//g, "").trim(),
    value: match[1].trim(),
  };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS = readFileSync(
  fileURLToPath(new URL("../assets/css/styles.css", import.meta.url)),
  "utf8"
);

test("les teintes de charge sont declarees sur :root, avec les bonnes valeurs", () => {
  // --load-overload-text est NOUVELLE : #6d3b00 etait ecrite en dur.
  const expected = {
    "--load-partial": "#edf4fb",
    "--load-balanced": "#d7eccb",
    "--load-overload": "#ffe1a8",
    "--load-overload-text": "#6d3b00",
  };

  Object.entries(expected).forEach(([name, hex]) => {
    const found = findDeclaration(name);
    assert.ok(found, `${name} introuvable dans styles.css`);

    // Assertion POSITIVE, et non « different de .ps-segment-edit-load » : un
    // simple `notEqual` laisserait passer un selecteur MORT, qui ne matche
    // aucun element. Or une variable CSS qui ne resout pas ne leve aucune
    // erreur — la propriete est juste abandonnee. C'est exactement la panne
    // silencieuse que ce fichier existe pour empecher : l'assertion doit donc
    // nommer la portee attendue, pas seulement en exclure une.
    assert.equal(found.selector, ":root", `${name} n'est pas declaree sur :root`);

    // La teinte elle-meme est le contrat : elle doit se lire a l'identique dans
    // Gestion-User, gestion-depenses2 et ici. Une coquille sur un chiffre hexa
    // ne casserait rien de visible — juste la coherence entre les trois widgets.
    assert.equal(found.value, hex, `${name} n'a pas la teinte attendue`);
  });
});

test("la fenetre de segment consomme toujours les trois teintes", () => {
  // Les trois etats de la barre de la fenetre de segment, un par teinte. Le
  // deplacement vers :root ne doit rien avoir casse ici.
  assert.match(CSS, /\.ps-segment-edit-load-fill\s*\{[^}]*var\(--load-partial\)/);
  assert.match(CSS, /\.ps-segment-edit-load\.is-balanced[^{]*\{[^}]*var\(--load-balanced\)/);
  assert.match(CSS, /\.ps-segment-edit-load\.is-overload[^{]*\{[^}]*var\(--load-overload\)/);
});
