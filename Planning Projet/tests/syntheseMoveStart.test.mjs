import test from "node:test";
import assert from "node:assert/strict";

import {
  TASK_COLUMNS,
  detectStructureLinkColumn,
  moveTaskStart,
  readTask,
} from "../assets/js/services/syntheseTaskModel.js";

const day = (year, month, date) => new Date(year, month - 1, date);
const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);

function task(fields) {
  return readTask({ Type_doc: "", ID2: "", Zone: "Zone Z2A", ...fields });
}
// Visa MOE : Ven 09/10/26 → Ven 23/10/26, 11 jours.
const visa = () => task({ id: 5, Taches: "Visa MOE", Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-23", Duree_1: 11 });
// Jalon du jeudi 12/11/26.
const milestone = () => task({ id: 6, Taches: "RECEPTION ARCH/TOPO/STR", Diff_coffrage: "2026-11-12", Diff_armature: "2026-11-12", Duree_1: 0 });
const planned = (days) => task({ id: 7, Taches: "FOND DE PLAN", Diff_coffrage: null, Diff_armature: null, Duree_1: days });

test("colonne du lien : Lien_Structure", () => {
  assert.equal(TASK_COLUMNS.structureLink, "Lien_Structure");
});

test("tâche datée : elle se décale et garde sa durée", () => {
  const result = moveTaskStart(visa(), day(2025, 11, 27)); // jeudi
  assert.equal(result.ok, true);
  assert.equal(result.task.durationDays, 11);
  assert.deepEqual(result.fields, { Diff_coffrage: "2025-11-27", Diff_armature: "2025-12-11", Duree_1: 11 });
});

test("jalon : il se déplace et reste un jalon", () => {
  const result = moveTaskStart(milestone(), day(2025, 11, 27));
  assert.equal(result.task.isMilestone, true);
  assert.deepEqual(result.fields, { Diff_coffrage: "2025-11-27", Diff_armature: "2025-11-27", Duree_1: 0 });
});

test("tâche sans dates : sa durée prévue donne la Fin (0 : jalon ; inconnue : un jour)", () => {
  assert.deepEqual(
    moveTaskStart(planned(2), day(2025, 11, 27)).fields,
    { Diff_coffrage: "2025-11-27", Diff_armature: "2025-11-28", Duree_1: 2 }
  );
  const asMilestone = moveTaskStart(planned(0), day(2025, 11, 27));
  assert.equal(asMilestone.task.isMilestone, true);
  assert.deepEqual(asMilestone.fields, { Diff_coffrage: "2025-11-27", Diff_armature: "2025-11-27", Duree_1: 0 });
  assert.deepEqual(
    moveTaskStart(planned(""), day(2025, 11, 27)).fields,
    { Diff_coffrage: "2025-11-27", Diff_armature: "2025-11-27", Duree_1: 1 }
  );
});

test("week-end ou férié : le Début passe au jour ouvré suivant", () => {
  assert.equal(iso(moveTaskStart(milestone(), day(2026, 11, 28)).task.start), "2026-11-30", "samedi → lundi");
  assert.equal(iso(moveTaskStart(milestone(), day(2026, 5, 1)).task.start), "2026-05-04", "vendredi 1er mai → lundi");
});

test("déjà à la bonne date : rien à écrire", () => {
  const result = moveTaskStart(milestone(), day(2026, 11, 12));
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields, {});
});

test("date illisible ou hors bornes : refus", () => {
  assert.deepEqual(moveTaskStart(visa(), null), { ok: false, error: "Date invalide." });
  assert.deepEqual(moveTaskStart(visa(), new Date(NaN)), { ok: false, error: "Date invalide." });
  assert.match(moveTaskStart(visa(), day(1999, 12, 31)).error, /entre 2000 et 2100/);
  assert.match(moveTaskStart(visa(), day(2101, 1, 1)).error, /entre 2000 et 2100/);
});

test("colonne Lien_Structure : présente, absente, inconnue sans ligne", () => {
  assert.equal(detectStructureLinkColumn([{ id: 1, Lien_Structure: "" }]), true);
  assert.equal(detectStructureLinkColumn([{ id: 1, Lien: "" }]), false);
  assert.equal(detectStructureLinkColumn([]), null);
  assert.equal(detectStructureLinkColumn(null), null);
});
