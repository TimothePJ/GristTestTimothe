// Fenêtre de lien d'une tâche (vue Synthese), ouverte par le clic droit : lecture du formulaire
// (fonction pure) et branchements du DOM (lus dans le source).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { readLinkForm } from "../assets/js/ui/syntheseLinkDialog.js";

const source = await readFile(new URL("../assets/js/ui/syntheseLinkDialog.js", import.meta.url), "utf8");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

test("formulaire lu : tâche à suivre, type, décalage ; aucune tâche = plus de lien", () => {
  assert.deepEqual(readLinkForm({ predId: "1000", type: "DD", lag: "2" }), { ok: true, link: { predId: 1000, type: "DD", lag: 2 } });
  assert.deepEqual(readLinkForm({ predId: "1000", type: "FF", lag: "-3" }), { ok: true, link: { predId: 1000, type: "FF", lag: -3 } });
  assert.deepEqual(readLinkForm({ predId: "1000", type: "FD", lag: "" }), { ok: true, link: { predId: 1000, type: "FD", lag: 0 } });
  assert.deepEqual(readLinkForm({ predId: "1000", type: "??", lag: "0" }), { ok: true, link: { predId: 1000, type: "FD", lag: 0 } });
  assert.deepEqual(readLinkForm({ predId: "", type: "FD", lag: "5" }), { ok: true, link: null });
});

test("formulaire refusé : décalage non entier, ou au-delà de 9999 jours", () => {
  assert.deepEqual(readLinkForm({ predId: "1000", type: "FD", lag: "2.5" }), { ok: false, error: "Le décalage doit être un nombre entier de jours ouvrés." });
  assert.deepEqual(readLinkForm({ predId: "1000", type: "FD", lag: "abc" }), { ok: false, error: "Le décalage doit être un nombre entier de jours ouvrés." });
  assert.deepEqual(readLinkForm({ predId: "1000", type: "FD", lag: "10000" }), { ok: false, error: "Le décalage est limité à 9999 jours ouvrés." });
});

test("fenêtre : modale, Échap ferme, recherche par nom ou numéro, aperçu à chaque changement", () => {
  assert.match(source, /\.showModal\(\)/);
  assert.match(source, /addEventListener\("cancel"/);
  assert.match(source, /search\.addEventListener\("input"/);
  assert.match(source, /form\.addEventListener\("change"/);
  assert.match(css, /\.synthese-link-dialog\s*\{/);
  assert.match(css, /\.synthese-link-dialog__option\.is-disabled\s*\{/);
});

test("Entrée dans la recherche ne valide pas la fenêtre : elle choisit la première tâche trouvée", () => {
  assert.match(source, /search\.addEventListener\("keydown"[\s\S]{0,200}event\.key !== "Enter"\) return;\s*event\.preventDefault\(\)/);
});

test("lien actuel vers une tâche disparue : « Aucune » est cochée ; décalage illisible : refusé, pas lu comme 0", () => {
  assert.match(source, /checked: !current \|\| !rows\.some\(\(row\) => row\.selected\)/);
  assert.match(source, /lagInput\.validity\?\.badInput \? "\?" : lagInput\.value/);
});
