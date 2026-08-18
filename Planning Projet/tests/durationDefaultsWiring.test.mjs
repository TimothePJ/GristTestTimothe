import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Le formulaire est décrit dans index.html et piloté par main.js via des
// identifiants. Une divergence entre les deux ne casse rien à l'exécution : elle rend
// juste le bouton ou un champ inerte, silencieusement. On vérifie donc l'accord.

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

const REQUIRED_IDS = [
  "durationDefaultsToggle",
  "durationDefaultsDialog",
  "durationDefaultsForm",
  "durationDefaultsScope",
  "durationDefaultsBody",
  "durationDefaultsSummary",
  "durationDefaultsError",
  "durationDefaultsCloseBtn",
  "durationDefaultsCancelBtn",
  "durationDefaultsApplyBtn",
];

test("chaque identifiant piloté par main.js existe dans index.html", () => {
  REQUIRED_IDS.forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `identifiant ${id} absent de index.html`);
    assert.ok(
      mainJs.includes(`getElementById("${id}")`),
      `identifiant ${id} jamais retrouvé par main.js`
    );
  });
});

// Le plan doit être calculé sur les lignes Grist brutes : `group.meta` est la ligne
// normalisée, ses durées sont en camelCase et ses dates sont dérivées.
test("le plan est alimenté par les lignes brutes, pas par group.meta", () => {
  assert.match(mainJs, /rawRowsById: buildRawPlanningRowsById\(/);
  assert.match(mainJs, /rawRowsById: scope\?\.rawRowsById/);
  // Une mention en commentaire est permise ; une lecture de propriété, non.
  assert.equal(
    /group\.meta\s*[.[]/.test(mainJs),
    false,
    "main.js ne doit pas lire les valeurs stockées dans group.meta"
  );
});

// Le résumé renvoie l'utilisateur « aux durées en rouge » : la classe doit exister.
test("le champ invalide a bien un style", () => {
  assert.match(css, /\.planning-duration-defaults-table__duration\.is-invalid\s*\{/);
});

test("les classes du formulaire sont stylées", () => {
  [
    "planning-duration-defaults-dialog",
    "planning-duration-defaults-dialog__body",
    "planning-duration-defaults-dialog__actions",
    "planning-duration-defaults-table",
    "planning-duration-defaults-table__duration",
    "planning-duration-defaults-table__mode",
    "planning-duration-defaults-table__unavailable",
    "planning-duration-defaults-toggle",
  ].forEach((className) => {
    assert.ok(css.includes(`.${className}`), `classe ${className} sans style`);
  });
});

// `method="dialog"` ferme la fenêtre dès la soumission : sans preventDefault,
// l'écriture Grist partirait sur une fenêtre déjà fermée.
// Le corps de bindDurationDefaultsDialog est isolé explicitement : chercher
// `els.form.addEventListener("submit"` dans tout le fichier tomberait sur le
// formulaire d'ajout de zone, qui possède le même appel.
test("la soumission du formulaire est interceptée avant la fermeture native", () => {
  const start = mainJs.indexOf("function bindDurationDefaultsDialog");
  assert.notEqual(start, -1, "bindDurationDefaultsDialog introuvable dans main.js");

  const bindBody = mainJs.slice(start, mainJs.indexOf("\n}", start));
  assert.match(bindBody, /els\.form\.addEventListener\("submit"/);
  assert.match(bindBody, /event\.preventDefault\(\)/);
  assert.match(bindBody, /applyDurationDefaults\(\)/);
});

// Sans cet appel dans bootstrap, la fenêtre existe mais aucun bouton ne l'ouvre.
test("la fenêtre est câblée au démarrage du widget", () => {
  assert.match(mainJs, /bindDurationDefaultsDialog\(\);/);
});

// L'écriture de masse est la plus destructrice du widget : elle doit être refusée
// planning verrouillé, à l'ouverture comme au moment d'appliquer.
test("le verrou d'édition est vérifié à l'ouverture et à l'application", () => {
  const openBody = mainJs.slice(
    mainJs.indexOf("function openDurationDefaultsDialog"),
    mainJs.indexOf("function closeDurationDefaultsDialog")
  );
  const applyBody = mainJs.slice(
    mainJs.indexOf("async function applyDurationDefaults"),
    mainJs.indexOf("function bindDurationDefaultsDialog")
  );

  assert.match(openBody, /requirePlanningEditing\(/);
  assert.match(applyBody, /requirePlanningEditing\(/);
});

// Une écriture par ligne coûterait une lecture complète de Planning_Projet et une
// synchronisation dérivée par ligne : le widget se figerait sur un gros projet.
test("l'application passe par un lot unique, pas par l'écriture ligne à ligne", () => {
  const applyBody = mainJs.slice(
    mainJs.indexOf("async function applyDurationDefaults"),
    mainJs.indexOf("function bindDurationDefaultsDialog")
  );

  assert.match(applyBody, /syncPlanningDerivedValues\(\{/);
  assert.match(applyBody, /runExclusivePlanningWrite\(/);
  assert.equal(
    applyBody.includes("updatePlanningDurationAndLeftDate"),
    false,
    "l'écriture unitaire ne doit pas être bouclée"
  );
  assert.equal(
    (applyBody.match(/refreshPlanning\(/g) || []).length,
    1,
    "un seul rafraîchissement pour tout le lot"
  );
});

// Le bouton doit vivre dans .filters : c'est le seul bloc de la barre d'outils que
// les modes embarqués masquent.
test("le bouton est dans le bloc masqué en mode embarqué", () => {
  const filtersBlock = html.slice(html.indexOf('<div class="filters">'), html.indexOf("<!-- Zoom"));
  assert.ok(filtersBlock.includes('id="durationDefaultsToggle"'));
  assert.match(css, /body\.planning-sync-embedded \.filters \{\s*display: none;/);
});
