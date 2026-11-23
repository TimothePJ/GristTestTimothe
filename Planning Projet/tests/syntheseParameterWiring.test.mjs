import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");
const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");

function functionBody(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}[(]`));
  assert.ok(start >= 0, `${name} introuvable`);
  const rest = source.slice(start + 1);
  const next = rest.search(/\n(?:async )?function /);
  return source.slice(start, next >= 0 ? start + 1 + next : undefined);
}

test("bouton Paramètre juste après Par étage", () => {
  const layout = /<button\s+id="syntheseLayoutToggle"[\s\S]*?<\/button>/.exec(html);
  assert.ok(layout, "bouton Par étage absent");
  const after = html.slice(layout.index + layout[0].length);
  const button = /^\s*<button\s+id="syntheseParametreToggle"[\s\S]*?<\/button>/.exec(after)?.[0];
  assert.ok(button, "bouton Paramètre absent juste après Par étage");
  assert.match(button, /type="button"/);
  assert.match(button, /class="planning-synthese-parametre-toggle"/);
  assert.match(button, /title="Modèle d'étage du projet : cycles, tâches, liens et durées d'un nouvel étage"/);
  assert.match(button, /data-service-context-navigation/);
  assert.match(button, />Paramètre<\/button>$/);
});

test("bouton visible seulement en Synthese", () => {
  const hidden = /([^{}]+)\{\s*display:\s*none\s*!important;\s*\}/g;
  const selectors = [...css.matchAll(hidden)]
    .map((match) => match[1])
    .filter((selector) => selector.includes("#syntheseParametreToggle"))
    .join(",");
  ["body:not(.is-synthese-space)", "body.is-global-space", "body.planning-sync-embedded"].forEach((scope) => {
    assert.ok(selectors.includes(`${scope} #syntheseParametreToggle`), `${scope} devrait masquer le bouton`);
  });
  assert.match(css, /#toolbar \.planning-synthese-parametre-toggle\s*\{/);
});

test("main.js : le modèle du projet est passé au contrôleur principal", () => {
  const body = functionBody(mainJs, "getSyntheseTasks");
  assert.ok(body.includes("getFloorTemplate: () => floorTemplateFor(cachedProjectAvancementConfigs,"));
});

test("main.js : ouverture après relecture hors cache, droits, enregistrement dans Projets2", () => {
  const body = functionBody(mainJs, "bindSyntheseParameterDialog");
  const refresh = body.indexOf("refreshProjectRegistryFromGrist({ notify: false, clearInvalid: false, forceRefresh: true })");
  const open = body.indexOf(".open(");
  assert.ok(refresh >= 0 && open > refresh, "relecture hors cache avant open");
  assert.ok(body.includes("await refreshProjectRegistryFromGrist"));
  assert.match(body, /canEdit: canEditSyntheseParameter\(read\.column\)/);
  const rule = functionBody(mainJs, "canEditSyntheseParameter");
  assert.match(rule, /isPlanningEditingUnlocked\(\)/);
  assert.match(rule, /accessMode === "editable"/);
  assert.match(body, /columnMissing/);
  const build = body.indexOf("buildParametreActions(");
  const apply = body.indexOf("window.grist.docApi.applyUserActions");
  const withP = body.indexOf("withParametre(");
  assert.ok(build >= 0 && apply > build && withP > apply, "ordre buildParametreActions, applyUserActions, withParametre");
});

test("main.js : ouverture après relecture hors cache, droits, enregistrement dans Projets2", () => {
  const body = functionBody(mainJs, "bindSyntheseParameterDialog");
  const refresh = body.indexOf("refreshProjectRegistryFromGrist({ notify: false, clearInvalid: false, forceRefresh: true })");
  const open = body.indexOf(".open(");
  assert.ok(refresh >= 0 && open > refresh, "relecture hors cache avant open");
  assert.ok(body.includes("await refreshProjectRegistryFromGrist"));
  assert.match(body, /canEdit: canEditSyntheseParameter\(read\.column\)/);
  const rule = functionBody(mainJs, "canEditSyntheseParameter");
  assert.match(rule, /isPlanningEditingUnlocked\(\)/);
  assert.match(rule, /accessMode === "editable"/);
  assert.match(body, /columnMissing/);
  const build = body.indexOf("buildParametreActions(");
  const apply = body.indexOf("window.grist.docApi.applyUserActions");
  const withP = body.indexOf("withParametre(");
  assert.ok(build >= 0 && apply > build && withP > apply, "ordre buildParametreActions, applyUserActions, withParametre");
});

test("main.js : la fenêtre se ferme au changement de projet ou de service, suit Editer", () => {
  const body = functionBody(mainJs, "bindSyntheseParameterDialog");
  assert.match(body, /serviceContext\.subscribe\?\.\(/);
  assert.match(body, /\.close\(\)/);
  assert.match(functionBody(mainJs, "setPlanningEditingEnabled"), /parameterDialog\?\.setCanEdit\(/);
});

test("main.js : le projet est un objet, identifié par projectKeyOf", () => {
  const body = functionBody(mainJs, "bindSyntheseParameterDialog");
  assert.ok(!mainJs.includes("String(project)"));
  assert.ok(!mainJs.includes("String(currentSyntheseProject()"));
  assert.match(body, /openedKey = projectKeyOf\(project\)/);
  assert.match(body, /projectName: project\.name/);
  assert.match(body, /shouldCloseParameterDialog\(\{[^}]*projectKeyOf\(currentSyntheseProject\(\)\)/);
  assert.match(body, /projectKeyOf\(currentSyntheseProject\(\)\) !== openedKey/);
  assert.ok(body.includes("Le projet a changé : fermez la fenêtre et rouvrez-la."));
  assert.match(body, /buildParametreActions\(cachedProjectAvancementConfigs, openedProject,/);
  assert.match(body, /withParametre\(cachedProjectAvancementConfigs, openedProject,/);
});

test("main.js : bindSyntheseParameterDialog est appelé au démarrage", () => {
  assert.ok(mainJs.includes("bindSyntheseParameterDialog();"));
});

test("versions servies", () => {
  assert.ok(html.includes("main.js?v=20261123-fluide2"));
  assert.ok(html.includes("styles.css?v=20261123-fluide2"));
});

test("main.js : erreurs d'enregistrement lisibles (userMessage), droits revérifiés, ouverture gardée", () => {
  const body = functionBody(mainJs, "bindSyntheseParameterDialog");
  assert.match(body, /const refuse = \(message\) => Object\.assign\(new Error\(message\), \{ userMessage: message \}\)/);
  assert.ok(body.includes("Modification impossible : activez « Editer » dans un service modifiable."));
  assert.match(body, /if \(!canEditSyntheseParameter\(true\)\)/);
  assert.ok(body.indexOf("canEditSyntheseParameter(true)") < body.indexOf("buildParametreActions("), "droits avant l'écriture");
  ["Le projet a changé : fermez la fenêtre et rouvrez-la.", "Aucune ligne Projets2 pour le projet courant."].forEach((text) => {
    const at = body.indexOf(text);
    assert.ok(at >= 0, text);
    assert.match(body.slice(Math.max(0, at - 20), at), /refuse\(/, `${text} porte un userMessage`);
  });
  const awaited = body.indexOf("await refreshProjectRegistryFromGrist");
  const recheck = body.indexOf("projectKeyOf(currentSyntheseProject()) !== projectKeyOf(project)");
  assert.ok(recheck > awaited && recheck < body.indexOf(".open("), "projet revérifié après l'attente, avant open");
  assert.ok(body.includes("Ouverture du modèle d'étage impossible : réessayez dans un instant."));
  assert.ok(!body.includes("Modèle d'étage illisible : réessayez"));
});
