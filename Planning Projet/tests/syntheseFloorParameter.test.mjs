import test from "node:test";
import assert from "node:assert/strict";

import { FLOOR_TEMPLATE } from "../assets/js/services/syntheseFloorTemplate.js";
import {
  MODEL_ANCHOR_DATE,
  MODEL_FLOOR_NAME,
  MODEL_ZONE_NAME,
  buildParametreActions,
  floorTemplateFor,
  parseFloorTemplate,
  projectKeyOf,
  shouldCloseParameterDialog,
  readProjectParameter,
  serializeFloorTemplate,
  templateItemsFromRows,
  templateToRows,
  templateWarnings,
  withParametre,
} from "../assets/js/services/syntheseFloorParameter.js";

const json = (items, version = 1) => JSON.stringify({ version, items });
const task = (code, name, extra = {}) => ({ code, name, nature: "", parent: "", link: "", days: 0, ...extra });

test("lecture : JSON valide → éléments ; vide, illisible, version inconnue ou sans tâche → null", () => {
  assert.equal(parseFloorTemplate(""), null);
  assert.equal(parseFloorTemplate("{"), null);
  assert.equal(parseFloorTemplate(json([task("T1", "A")], 2)), null);
  assert.equal(parseFloorTemplate(json([{ code: "C1", name: "CYCLE", nature: "Cycle" }])), null);
  assert.equal(parseFloorTemplate(undefined), null);
  const items = parseFloorTemplate(json([task("T1", "A")]));
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "A");
});

test("lecture tolérante : doublon ignoré, parent non-cycle ramené à l'étage, lien inconnu vidé, days hors bornes = 0", () => {
  const items = parseFloorTemplate(json([
    task("T1", "PREMIERE"),
    task("T1", "DOUBLON"),
    task("T2", "ENFANT", { parent: "T1", link: "T1 FD", days: 3 }),
    task("T3", "LIEN INCONNU", { link: "X9 FD" }),
    task("T4", "NEGATIF", { days: -2 }),
    task("T5", "ENORME", { days: 1e9 }),
    task("T6", "", { days: 1 }),
    task("T7", "SOI MEME", { link: "T7 FD" }),
    task("T8", "PARENT INCONNU", { parent: "Z" }),
  ]));
  assert.deepEqual(items.map((item) => item.code), ["T1", "T2", "T3", "T4", "T5", "T7", "T8"]);
  assert.equal(items[0].name, "PREMIERE");
  assert.equal(items[1].parent, "");
  assert.equal(items[1].link, "T1 FD");
  assert.equal(items[1].days, 3);
  assert.equal(items[2].link, "");
  assert.equal(items[3].days, 0);
  assert.equal(items[4].days, 0);
  assert.equal(items[5].link, "");
  assert.equal(items[6].parent, "");
});

test("lecture : un lien vers un groupe est vidé, un parent placé après est ramené à l'étage", () => {
  const items = parseFloorTemplate(json([
    task("T1", "A", { parent: "C1", link: "C1 FD" }),
    { code: "C1", name: "CYCLE 1", nature: "Cycle", parent: "" },
    task("T2", "B", { parent: "C1", link: "T1 FD+2" }),
  ]));
  assert.equal(items[0].parent, "");
  assert.equal(items[0].link, "");
  assert.equal(items[2].parent, "C1");
  assert.equal(items[2].link, "T1 FD+2");
});

function structureOf(items) {
  const byCode = new Map(items.map((item) => [item.code, item]));
  return items.map((item) => {
    const isGroup = item.nature === "Cycle" || item.nature === "Sous-groupe";
    const [predCode, ...rest] = (item.link || "").split(" ");
    return {
      name: item.name,
      nature: isGroup ? undefined : (item.nature || ""),
      parent: item.parent ? byCode.get(item.parent).name : "",
      link: item.link ? [byCode.get(predCode).name, ...rest].join("|") : "",
      days: isGroup ? undefined : item.days || 0,
    };
  });
}

test("aller-retour du modèle d'origine : structure identique, codes traduits", () => {
  const back = templateItemsFromRows(templateToRows(FLOOR_TEMPLATE));
  assert.equal(back.length, FLOOR_TEMPLATE.length);
  assert.deepEqual(structureOf(back), structureOf(FLOOR_TEMPLATE));
  assert.ok(back.every((item) => (item.days === undefined) || item.days === 0));
  assert.equal(new Set(back.map((item) => item.code)).size, back.length);
});

test("lignes en mémoire datées depuis le lundi fictif", () => {
  assert.equal(MODEL_ANCHOR_DATE, "2026-01-05");
  const template = FLOOR_TEMPLATE.map((item) => (item.code.startsWith("T") ? { ...item, days: 2 } : item));
  const rows = templateToRows(template, { firstId: 10 });
  assert.equal(rows.length, template.length + 1);
  assert.equal(rows[0].id, 10);
  assert.equal(rows[0].Etage, true);
  assert.equal(rows[0].Taches, MODEL_FLOOR_NAME);
  rows.forEach((row) => {
    assert.equal(row.Service, "Synthese");
    assert.equal(row.Ordre, "");
    assert.equal(row.Type_doc, "");
    assert.equal(row.ID2, "");
    assert.equal(row.Indice, "");
    assert.equal(row.Controle_Coffrage, false);
    assert.equal(row.Zone, MODEL_ZONE_NAME);
    assert.ok("Diff_coffrage" in row && "Diff_armature" in row);
  });
  const named = (name) => rows.find((row) => row.Taches === name);
  const reception = named("RECEPTION ARCH/TOPO/STR");
  assert.equal(reception.Diff_coffrage, "2026-01-05");
  assert.equal(reception.Diff_armature, "2026-01-06");
  assert.equal(reception.Duree_1, 2);
  assert.equal(reception.Groupe, "Étage type");
  const fond = named("FOND DE PLAN DE SYNTHESE NIV {E}");
  assert.equal(fond.Diff_coffrage, "2026-01-05");
  assert.equal(fond.Lien, `${reception.id} DD`);
  const diffusion = named("DIFFUSION FDS Indice 0");
  assert.equal(diffusion.Diff_coffrage, "2026-01-07");
  assert.equal(diffusion.Diff_armature, "2026-01-08");
  assert.equal(diffusion.Duree_1, 2);
  const cycle = named("CYCLE 1");
  assert.equal(cycle.Diff_coffrage, null);
  assert.equal(cycle.Nature, "Cycle");
});

test("lignes en mémoire : une tâche sans durée est un jalon daté", () => {
  const rows = templateToRows(FLOOR_TEMPLATE);
  const reception = rows.find((row) => row.Taches === "RECEPTION ARCH/TOPO/STR");
  assert.equal(reception.Diff_coffrage, "2026-01-05");
  assert.equal(reception.Diff_armature, "2026-01-05");
  assert.equal(reception.Duree_1, 0);
});

test("modèle modifié relu à l'identique", () => {
  const rows = templateToRows(FLOOR_TEMPLATE);
  const meeting = rows.filter((row) => row.Taches === "REUNION + DIFFUSION SYT").pop();
  const base = { Service: "Synthese", Type_doc: "", ID2: "", Indice: "", Ordre: "", Zone: MODEL_ZONE_NAME, Groupe: MODEL_FLOOR_NAME, Etage: false, NomProjet: "P", Controle_Coffrage: false, Diff_coffrage: null, Diff_armature: null };
  const extra = [
    { ...base, id: 500, Taches: "CYCLE 4", Nature: "Cycle", Duree_1: 0, Parent: "", Lien: "" },
    { ...base, id: 501, Taches: "NOUVELLE", Nature: "", Duree_1: 3, Parent: "500", Lien: `${meeting.id} FD`, ID2: "A1", Indice: "B", Controle_Coffrage: true },
  ];
  const items = templateItemsFromRows([...rows, ...extra]);
  const added = items.filter((item) => item.name === "NOUVELLE");
  assert.equal(added.length, 1);
  assert.equal(added[0].days, 3);
  assert.equal(added[0].id2, "A1");
  assert.equal(added[0].indice, "B");
  assert.equal(added[0].control, true);
  assert.equal(items.find((item) => item.name === "CYCLE 4").nature, "Cycle");
  assert.deepEqual(parseFloorTemplate(serializeFloorTemplate(items)), items);
});

test("avertissements : sans FOND DE PLAN, sans tâche contrôlée, sans Demarrage", () => {
  assert.deepEqual(templateWarnings(templateToRows(FLOOR_TEMPLATE)), []);
  const without = (predicate) => {
    const kept = FLOOR_TEMPLATE.filter((item) => !predicate(item));
    return templateWarnings(templateToRows(parseFloorTemplate(serializeFloorTemplate(kept))));
  };
  const noPlan = without((item) => item.name.startsWith("FOND DE PLAN"));
  assert.equal(noPlan.length, 1);
  assert.match(noPlan[0], /FOND DE PLAN DE SYNTHESE/);
  assert.match(noPlan[0], /0 Prev/);
  const noControl = without((item) => item.code === "T15");
  assert.equal(noControl.length, 1);
  assert.match(noControl[0], /Contrôler par rapport au coffrage/);
  const noStart = without((item) => item.nature === "Demarrage");
  assert.equal(noStart.length, 1);
  assert.match(noStart[0], /Demarrage/);
  assert.match(noStart[0], /Global/);
});

const configsOf = (raw) => [{ projectId: "3", projectNumber: "26", ...(raw === "ABSENT" ? {} : { parametreRaw: raw }) }];
const PROJECT = { number: "26", ids: [3] };

test("Projets2 : colonne absente, vide, illisible, lue", () => {
  const valid = json([task("T1", "A", { days: 2 })]);
  assert.deepEqual(readProjectParameter(configsOf("ABSENT"), PROJECT), { column: false, items: null, invalid: false });
  assert.deepEqual(readProjectParameter(configsOf(""), PROJECT), { column: true, items: null, invalid: false });
  assert.deepEqual(readProjectParameter(configsOf("{"), PROJECT), { column: true, items: null, invalid: true });
  const read = readProjectParameter(configsOf(valid), PROJECT);
  assert.equal(read.column, true);
  assert.equal(read.invalid, false);
  assert.equal(read.items.length, 1);
  assert.equal(floorTemplateFor(configsOf("ABSENT"), PROJECT).template, FLOOR_TEMPLATE);
  assert.equal(floorTemplateFor(configsOf(""), PROJECT).template, FLOOR_TEMPLATE);
  assert.deepEqual([floorTemplateFor(configsOf("{"), PROJECT).template === FLOOR_TEMPLATE, floorTemplateFor(configsOf("{"), PROJECT).invalid], [true, true]);
  assert.equal(floorTemplateFor(configsOf(valid), PROJECT).template.length, 1);
  assert.equal(floorTemplateFor(configsOf(valid), PROJECT).invalid, false);
});

test("Projets2 : une action sur toutes les lignes du projet", () => {
  const options = { table: "Projets2", column: "Synthese_Parametre" };
  assert.deepEqual(buildParametreActions(configsOf(""), PROJECT, "TXT", options),
    [["UpdateRecord", "Projets2", 3, { Synthese_Parametre: "TXT" }]]);
  const configs = [
    { projectId: "3", projectNumber: "26", parametreRaw: "" },
    { projectId: "5", projectNumber: "26", parametreRaw: "" },
    { projectId: "9", projectNumber: "99", parametreRaw: "" },
  ];
  const project = { number: "26", ids: [3, 5] };
  assert.deepEqual(buildParametreActions(configs, project, "TXT", options),
    [["BulkUpdateRecord", "Projets2", [3, 5], { Synthese_Parametre: ["TXT", "TXT"] }]]);
  assert.deepEqual(buildParametreActions([], project, "TXT", options), []);
  const next = withParametre(configs, project, "TXT");
  assert.deepEqual(next.map((config) => config.parametreRaw), ["TXT", "TXT", ""]);
  assert.equal(configs[0].parametreRaw, "");
});

test("projectKeyOf : id, sinon numéro, sinon nom ; vide si pas de projet", () => {
  assert.equal(projectKeyOf({ id: 7, number: "P1", name: "Tour" }), "7");
  assert.equal(projectKeyOf({ number: "P1", name: "Tour" }), "P1");
  assert.equal(projectKeyOf({ id: "", number: " ", name: "Tour" }), "Tour");
  assert.equal(projectKeyOf(null), "");
  assert.equal(projectKeyOf(undefined), "");
  assert.notEqual(projectKeyOf({ id: 1 }), projectKeyOf({ id: 2 }));
});

test("shouldCloseParameterDialog : autre service ou autre projet", () => {
  const ok = { selectedService: "Synthese", currentKey: "7", openedKey: "7" };
  assert.equal(shouldCloseParameterDialog(ok), false);
  assert.equal(shouldCloseParameterDialog({ ...ok, selectedService: "Structure" }), true);
  assert.equal(shouldCloseParameterDialog({ ...ok, currentKey: "8" }), true);
});
