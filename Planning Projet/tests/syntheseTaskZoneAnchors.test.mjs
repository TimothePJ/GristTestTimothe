import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRowModel,
  buildSections,
  readTask,
  summarizeTasks,
} from "../assets/js/services/syntheseTaskModel.js";

function task(id, name, start, end, duration) {
  return readTask({
    id,
    Taches: name,
    Type_doc: "",
    ID2: "",
    Zone: "Z",
    Diff_coffrage: start,
    Diff_armature: end,
    Duree_1: duration,
  });
}

test("une zone qui commence et finit par un jalon le signale", () => {
  const summary = summarizeTasks([
    task(1, "FOND DE PLAN", "2026-09-14", "2026-09-14", 0),
    task(2, "Plans avant synthèse", "2026-09-15", "2026-10-08", 18),
    task(3, "Démarrage", "2027-02-22", "2027-02-22", 0),
  ]);
  assert.equal(summary.startsWithMilestone, true);
  assert.equal(summary.endsWithMilestone, true);
});

test("un segment qui commence le même jour que le jalon l'emporte", () => {
  const summary = summarizeTasks([
    task(1, "Jalon", "2026-09-14", "2026-09-14", 0),
    task(2, "Segment", "2026-09-14", "2026-09-18", 5),
  ]);
  assert.equal(summary.startsWithMilestone, false);
  assert.equal(summary.endsWithMilestone, false);
});

test("une tâche qui finit le jour du dernier jalon l'emporte", () => {
  const summary = summarizeTasks([
    task(1, "Segment", "2026-09-21", "2026-09-25", 5),
    task(2, "Jalon", "2026-09-25", "2026-09-25", 0),
  ]);
  assert.equal(summary.endsWithMilestone, false);
});

test("le modèle de lignes porte les indicateurs sur la ligne de zone seulement", () => {
  const rows = [
    { id: 1, Taches: "Jalon", Type_doc: "", ID2: "", Zone: "Z", Diff_coffrage: "2026-09-14", Diff_armature: "2026-09-14", Duree_1: 0 },
    { id: 2, Taches: "Segment", Type_doc: "", ID2: "", Zone: "Z", Diff_coffrage: "2026-09-15", Diff_armature: "2026-09-18", Duree_1: 4 },
  ];
  const [zone, first, second] = buildRowModel(buildSections({ rows }));
  assert.equal(zone.startsWithMilestone, true);
  assert.equal(zone.endsWithMilestone, false);
  assert.equal(first.startsWithMilestone, false);
  assert.equal(second.endsWithMilestone, false);
});

test("zone sans dates : indicateurs faux", () => {
  const [zone] = buildRowModel(buildSections({
    rows: [{ id: 3, Taches: "", Type_doc: "", ID2: "", Zone: "Vide" }],
  }));
  assert.equal(zone.startsWithMilestone, false);
  assert.equal(zone.endsWithMilestone, false);
});
