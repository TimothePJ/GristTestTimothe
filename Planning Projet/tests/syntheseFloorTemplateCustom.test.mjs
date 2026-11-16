import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBulkAddAction,
  buildFloorFromTemplate,
  buildTemplateLinks,
  buildZoneAnchorRow,
  completeZoneAnchorRow,
} from "../assets/js/services/syntheseFloorTemplate.js";
import { NATURES, TASK_COLUMNS } from "../assets/js/services/syntheseTaskModel.js";

const CUSTOM = [
  { code: "C1", name: "CYCLE A", nature: NATURES.cycle },
  { code: "T1", name: "PLAN {E}", parent: "C1", days: 3 },
  { code: "T2", name: "VISA", parent: "C1", link: "T1 FD+2", days: 0 },
  { code: "C2", name: "CYCLE B", nature: NATURES.cycle, parent: "C1" },
];

test("modèle personnalisé : ligne-étage puis éléments, Duree_1 = days, {E} remplacé", () => {
  const rows = buildFloorFromTemplate({ floorName: "R+1", zoneName: "Z", projectName: "P", template: CUSTOM });
  assert.equal(rows.length, 5);
  assert.equal(rows[2].Duree_1, 3);
  assert.equal(rows[2].Taches, "PLAN R+1");
  assert.equal(rows[1].Nature, NATURES.cycle);
  assert.equal(rows[1].Duree_1, 0);
  assert.equal(rows[4].Nature, "Sous-groupe");
});

test("replaceToken: false garde {E}", () => {
  const rows = buildFloorFromTemplate({ floorName: "R+1", template: CUSTOM, replaceToken: false });
  assert.equal(rows[2].Taches, "PLAN {E}");
});

test("N°, Indice et Contrôle : mêmes colonnes sur toutes les lignes", () => {
  const template = [
    { code: "T1", name: "A", id2: "12", indice: "B" },
    { code: "T2", name: "B", control: true },
  ];
  const rows = buildFloorFromTemplate({ floorName: "E", template, withFormworkCheck: true });
  rows.forEach((row) => {
    assert.ok("ID2" in row);
    assert.ok("Indice" in row);
    assert.ok("Controle_Coffrage" in row);
  });
  assert.equal(rows[1].ID2, "12");
  assert.equal(rows[2].ID2, "");
  assert.equal(rows[0].Controle_Coffrage, false);
  assert.equal(rows[2].Controle_Coffrage, true);
  const action = buildBulkAddAction(rows);
  Object.values(action[3]).forEach((col) => assert.ok(!col.includes(null)));
  const without = buildFloorFromTemplate({ floorName: "E", template });
  assert.ok(without.every((row) => !("Controle_Coffrage" in row)));
  const plain = buildFloorFromTemplate({ floorName: "E", template: CUSTOM, withFormworkCheck: true });
  assert.ok(plain.every((row) => !("ID2" in row) && !("Indice" in row) && !("Controle_Coffrage" in row)));
});

test("liens résolus d'après les ids, même vers un élément placé plus loin", () => {
  const template = [
    { code: "C1", name: "C", nature: NATURES.cycle },
    { code: "T1", name: "A", parent: "C1", link: "T2 FD" },
    { code: "T2", name: "B", parent: "C1" },
    { code: "T3", name: "D", parent: "C1" },
  ];
  const { fieldsById } = buildTemplateLinks([10, 11, 12, 13, 14], template);
  assert.equal(fieldsById.get(12).Lien, "13 FD");
  assert.equal(fieldsById.get(12).Parent, "11");
});

test("buildTemplateLinks : nombre d'ids contrôlé d'après le modèle", () => {
  assert.throws(() => buildTemplateLinks([1, 2, 3, 4], CUSTOM));
});

test("ligne d'ancrage de zone : mêmes colonnes optionnelles que les lignes du modèle, jamais null", () => {
  const template = [
    { code: "T1", name: "PLAN {E}", id2: "ID-1", indice: "A", control: true, days: 2 },
  ];
  const rows = buildFloorFromTemplate({ floorName: "R+1", zoneName: "Z", projectName: "P", template, withFormworkCheck: true });
  const anchor = completeZoneAnchorRow(buildZoneAnchorRow({ zoneName: "Nouvelle", projectName: "P" }), rows[0]);
  const action = buildBulkAddAction([...rows, anchor]);
  Object.entries(action[3]).forEach(([column, values]) => {
    assert.ok(values.every((value) => value !== null), `${column} sans null`);
  });
  assert.equal(anchor[TASK_COLUMNS.id2], "");
  assert.equal(anchor[TASK_COLUMNS.formworkCheck], false);
});
