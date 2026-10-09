import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, `bornes introuvables : ${startToken} → ${endToken}`);
  return source.slice(start, end);
}

test("bouton « Lien Structure » juste après « Editer », actif même en lecture seule", () => {
  const editAt = html.indexOf('id="planningEditToggle"');
  const linkAt = html.indexOf('id="structureLinkToggle"');
  const durationsAt = html.indexOf('id="durationDefaultsToggle"');
  assert.ok(editAt > 0 && linkAt > editAt && linkAt < durationsAt, "placé entre Editer et Durées");
  const button = sliceBetween(html, '<button\n        id="structureLinkToggle"', "</button>");
  assert.match(button, /type="button"/);
  assert.match(button, />Lien Structure$/);
  // La fenêtre n'écrit rien : le contexte partagé ne doit pas griser le bouton hors du service de l'utilisateur.
  assert.match(button, /data-service-context-navigation/);
});

test("le bouton n'apparaît que dans la vue Synthese", () => {
  assert.match(css, /body:not\(\.is-synthese-space\) #structureLinkToggle\s*\{\s*display:\s*none !important;/);
});

test("fenêtre : titre, message, en-têtes des deux côtés, corps, bouton Fermer", () => {
  const dialog = sliceBetween(html, '<dialog id="structureLinkDialog"', "</dialog>");
  assert.match(dialog, /aria-labelledby="structureLinkTitle"/);
  assert.match(dialog, /<h3 id="structureLinkTitle">Lien Structure<\/h3>/);
  assert.match(dialog, /id="structureLinkCloseBtn"[^>]*aria-label="Fermer"/);
  assert.match(dialog, /id="structureLinkStatus"[^>]*role="status"[^>]*hidden/);
  assert.match(dialog, /Synth&egrave;se &mdash; &eacute;tages/);
  assert.match(dialog, /Structure &mdash; coffrage/);
  assert.match(dialog, /<div id="structureLinkBody" class="structure-link-dialog__body"><\/div>/);
});

test("styles : deux colonnes en face, liste en retrait avec flèche, texte foncé sur fond clair", () => {
  assert.match(css, /\.structure-link-dialog\s*\{[^}]*color-scheme:\s*light;/);
  assert.match(css, /\.structure-link-zone\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);/);
  assert.match(css, /\.structure-link-item::before\s*\{[^}]*content:\s*"→";/);
  assert.match(css, /\.structure-link-dialog__body\s*\{[^}]*overflow:\s*auto;/);
});

test("main.js : la fenêtre lit les deux tables du projet et passe par le tableau de tâches pour écrire", () => {
  assert.match(mainJs, /import \{ createStructureLinkDialog \} from "\.\/ui\/structureLinkDialog\.js";/);
  const bind = sliceBetween(mainJs, "function bindStructureLinkDialog(", "\n}\n");
  assert.match(bind, /if \(EMBEDDED_PLANNING_SYNC_MODE\) return;/);
  assert.match(bind, /fetchProjectRows\("Planning_Projet"\)/);
  assert.match(bind, /fetchProjectRows\("ListePlan_NDC_COF"\)/);
  assert.match(bind, /return \{ projectRows, planRows \};/);
  assert.match(bind, /getSource: \(\) => syntheseTasks\?\.getStructureLinkSource\(\) \|\| null/);
  assert.match(bind, /syntheseTasks\.applyStructureLink\(request\)/);
  assert.match(bind, /getElementById\("structureLinkToggle"\)\s*\?\.addEventListener\("click", \(\) => \{\s*void structureLinkDialog\.open\(\);/);
  assert.match(mainJs, /bindSyntheseSpace\(\);\s*bindStructureLinkDialog\(\);/);
  assert.match(
    bind,
    /serviceContext\.subscribe\?\.\(\(context\) => \{\s*if \(context\?\.selectedService !== SYNTHESE_SERVICE_NAME\) structureLinkDialog\.close\(\);\s*else structureLinkDialog\.closeIfStale\(\);\s*\}\);/
  );
});

test("styles du lien : cibles de dépôt, états, coffrage déplaçable, boutons, message d'erreur", () => {
  assert.match(css, /\.structure-link-item\s*\{[^}]*display:\s*flex;/);
  assert.match(css, /\.structure-link-floor\.is-droppable\s*\{[^}]*border-color:/);
  assert.match(css, /\.structure-link-floor\.is-drop-target\s*\{[^}]*background:/);
  assert.match(css, /\.structure-link-linkrow\s*\{[^}]*flex-basis:\s*100%;/);
  assert.match(css, /\.structure-link-floor\.is-state-stale \.structure-link-link\s*\{/);
  assert.match(css, /\.structure-link-formwork\.is-draggable\s*\{[^}]*cursor:\s*grab;/);
  assert.match(css, /\.structure-link-formwork\.is-dragging\s*\{[^}]*opacity:/);
  assert.match(css, /\.structure-link-action\s*\{[^}]*cursor:\s*pointer;/);
  assert.match(css, /\.structure-link-dialog__status\.is-error\s*\{[^}]*color:/);
  assert.match(css, /\.structure-link-dialog__body\.is-busy[^{]*\{[^}]*cursor:\s*progress;/);
});

test("les scripts sont servis dans leur nouvelle version", () => {
  assert.ok(html.includes("main.js?v=20261009-limite3"));
  assert.ok(html.includes("styles.css?v=20261009-limite3"));
  assert.ok(html.includes("grist-service-context.js?v=20261009-limite3"));
});
