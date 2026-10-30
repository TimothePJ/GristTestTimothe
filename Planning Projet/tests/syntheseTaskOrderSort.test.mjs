// Ordre libre des tâches (colonne Ordre) : lecture du rang et tri du contenu des conteneurs de
// la vue Synthese. Sans rang, l'ordre d'aujourd'hui ; avec rang, les éléments rangés d'abord.
import test from "node:test";
import assert from "node:assert/strict";

import {
  TASK_COLUMNS,
  buildRowModel,
  buildSections,
  detectOrderColumn,
  readOrder,
} from "../assets/js/services/syntheseTaskModel.js";
import { templateRows } from "./helpers/templateRows.mjs";

// Modèle d'étage SS1 (Zone Z3A), ids 201 à 226 : CYCLE 3 = 217 ; dans le cycle 3, RECEPTION
// RENDU 218, VISA A 219, PLAN SYT CYCLE 3 220 (RÉSEAUX 221, RÉSERVATIONS 222, TERMINAUX 223),
// REUNION 224, SIGNATURE 225, DÉMARRAGE GO 226.
const withOrder = (rows, orders) => rows.map((row) => (row.id in orders ? { ...row, Ordre: orders[row.id] } : row));
const keysAfter = (lines, key) => {
  const keys = lines.map((line) => line.key);
  return keys.slice(keys.indexOf(key));
};

test("colonne Ordre : texte ou nombre lu comme un nombre ; vide ou illisible = pas de rang", () => {
  assert.equal(TASK_COLUMNS.order, "Ordre");
  assert.deepEqual(
    ["3", " 12 ", 4, "2,5", "", null, undefined, "abc", "4 bis"].map(readOrder),
    [3, 12, 4, 2.5, null, null, null, null, null]
  );
});

test("colonne Ordre présente ou non, d'après les lignes lues", () => {
  assert.equal(detectOrderColumn([]), null);
  assert.equal(detectOrderColumn([{ id: 1 }]), false);
  assert.equal(detectOrderColumn([{ id: 1 }, { id: 2, Ordre: "" }]), true);
});

test("sans rang : l'ordre de création dans l'étage, ses cycles et ses sous-groupes, comme avant", () => {
  const lines = buildRowModel(buildSections({ rows: templateRows() }));
  assert.deepEqual(keysAfter(lines, "group:217"), [
    "group:217", "task:218", "task:219", "group:220", "task:221", "task:222", "task:223",
    "task:224", "task:225", "task:226",
  ]);
});

test("avec rang : les éléments rangés d'abord (par rang, « 10 » après « 9 »), puis les autres par création", () => {
  const rows = withOrder(templateRows(), { 219: "1", 218: "2", 220: "3", 226: "4", 221: "10", 222: "9" });
  const lines = buildRowModel(buildSections({ rows }));
  assert.deepEqual(keysAfter(lines, "group:217"), [
    "group:217", "task:219", "task:218", "group:220", "task:222", "task:221", "task:223",
    "task:226", "task:224", "task:225",
  ]);
  const task = buildSections({ rows })[0].floors[0].tasks.find((candidate) => candidate.id === 221);
  assert.equal(task.order, 10);
  assert.equal(buildSections({ rows })[0].floors[0].groups.find((group) => group.rowId === 220).order, 3);
});

// Review Focus 1 : un rang saisi à la main en double reste stable (même rang : par id).
test("rang en double (saisi à la main) : à égalité, par création", () => {
  const rows = withOrder(templateRows(), { 224: "1", 218: "1" });
  const lines = buildRowModel(buildSections({ rows }));
  assert.deepEqual(keysAfter(lines, "group:217").slice(0, 5), ["group:217", "task:218", "task:224", "task:219", "group:220"]);
});

test("niveau zone : sans rang par date, rangées d'abord ; les étages restent après, par date", () => {
  const plain = { NomProjet: "HOTEL DIEU", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "", Etage: false, Nature: "", Parent: "", Lien: "", Duree_1: 5 };
  const rows = [
    ...templateRows(),
    { ...plain, id: 301, Taches: "Visa tardif", Diff_coffrage: "2026-03-02", Diff_armature: "2026-03-06" },
    { ...plain, id: 302, Taches: "Visa précoce", Diff_coffrage: "2025-12-01", Diff_armature: "2025-12-05" },
    { ...plain, id: 303, Taches: "Visa sans date", Diff_coffrage: null, Diff_armature: null },
  ];
  const zoneLevel = (lines) => lines.filter((line) => line.level === 1).map((line) => line.key);
  assert.deepEqual(zoneLevel(buildRowModel(buildSections({ rows }))), ["task:302", "task:301", "task:303", "floor:zonez3a/ss1"]);
  const ranked = withOrder(rows, { 303: "1", 301: "2" });
  assert.deepEqual(zoneLevel(buildRowModel(buildSections({ rows: ranked }))), ["task:303", "task:301", "task:302", "floor:zonez3a/ss1"]);
});
