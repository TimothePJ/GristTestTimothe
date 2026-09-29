import test from "node:test";
import assert from "node:assert/strict";

import {
  NO_ZONE_KEY,
  PLANNING_TABLE,
  TASK_COLUMNS,
  floorKeyOf,
  formatDate,
  formatDuration,
  isFloorRow,
  isSyntheseRow,
  isTaskRow,
  nextWorkingDay,
  previousWorkingDay,
  readTask,
  zoneKeyOf,
} from "../assets/js/services/syntheseTaskModel.js";

const day = (year, month, date) => new Date(year, month - 1, date);
const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);

function taskRow(fields = {}) {
  return {
    id: 5,
    NomProjet: "HOTEL DIEU",
    Taches: "Visa MOE",
    Type_doc: "",
    ID2: "",
    Zone: "Zone Z2A",
    Diff_coffrage: "2026-10-09",
    Diff_armature: "2026-10-23",
    Duree_1: 11,
    ...fields,
  };
}

test("une tâche est une ligne nommée sans type de document ni ID", () => {
  assert.equal(isTaskRow(taskRow()), true);
  assert.equal(isTaskRow(taskRow({ Taches: "  " })), false, "ligne de zone");
  assert.equal(isTaskRow(taskRow({ Type_doc: "COFFRAGE" })), false, "document");
  assert.equal(isTaskRow(taskRow({ ID2: "001" })), false, "document numéroté");
  assert.equal(isTaskRow(taskRow({ id: 0 })), false, "id invalide");
  assert.equal(isTaskRow(null), false);
});

// Review Focus 4 : Grist livre les dates en secondes à minuit UTC.
test("readTask lit les dates Grist et compte les jours ouvrés bornes incluses", () => {
  const task = readTask(taskRow({
    Diff_coffrage: Date.UTC(2026, 8, 15) / 1000,
    Diff_armature: "08/10/2026",
  }));
  assert.equal(iso(task.start), "2026-09-15");
  assert.equal(iso(task.end), "2026-10-08");
  assert.equal(task.durationDays, 18, "comme MS Project : Mar 15/09 → Jeu 08/10");
  assert.equal(task.isMilestone, false);
  assert.equal(task.zoneKey, "zonez2a");
});

test("les jours fériés ne comptent pas (11 novembre)", () => {
  const task = readTask(taskRow({ Diff_coffrage: "2026-11-06", Diff_armature: "2026-11-12" }));
  assert.equal(task.durationDays, 4);
});

test("Duree_1 = 0 avec Début = Fin fait un jalon", () => {
  const milestone = readTask(taskRow({ Diff_coffrage: "2026-11-12", Diff_armature: "2026-11-12", Duree_1: 0 }));
  assert.equal(milestone.isMilestone, true);
  assert.equal(milestone.durationDays, 0);
  const oneDay = readTask(taskRow({ Diff_coffrage: "2026-11-12", Diff_armature: "2026-11-12", Duree_1: 1 }));
  assert.equal(oneDay.isMilestone, false);
  assert.equal(oneDay.durationDays, 1);
});

test("dates manquantes ou inversées", () => {
  const undated = readTask(taskRow({ Diff_coffrage: null, Diff_armature: "" }));
  assert.equal(undated.start, null);
  assert.equal(undated.end, null);
  assert.equal(undated.durationDays, null);
  const reversed = readTask(taskRow({ Diff_coffrage: "2026-10-23", Diff_armature: "2026-10-09" }));
  assert.equal(iso(reversed.start), "2026-10-09");
  assert.equal(iso(reversed.end), "2026-10-23");
});

test("recalage sur les jours ouvrés", () => {
  assert.equal(iso(nextWorkingDay(day(2026, 9, 19))), "2026-09-21", "samedi → lundi");
  assert.equal(iso(nextWorkingDay(day(2026, 11, 11))), "2026-11-12", "férié → lendemain");
  assert.equal(iso(nextWorkingDay(day(2026, 9, 23))), "2026-09-23", "déjà ouvré");
  assert.equal(iso(previousWorkingDay(day(2026, 9, 20))), "2026-09-18", "dimanche → vendredi");
  assert.equal(iso(previousWorkingDay(day(2027, 1, 1))), "2026-12-31", "férié → veille");
});

test("zoneKeyOf ignore casse, accents et ponctuation", () => {
  assert.equal(zoneKeyOf("ZONE 1A (BAT A3, A4)"), zoneKeyOf("zone-1a bat a3 a4"));
  assert.equal(zoneKeyOf("Élévations"), "elevations");
  assert.equal(zoneKeyOf("Sans zone"), NO_ZONE_KEY);
  assert.equal(zoneKeyOf(""), NO_ZONE_KEY);
  assert.equal(zoneKeyOf(null), NO_ZONE_KEY);
});

test("affichage des durées et des dates", () => {
  assert.equal(formatDuration(0), "0 jour");
  assert.equal(formatDuration(1), "1 jour");
  assert.equal(formatDuration(18), "18 jours");
  assert.equal(formatDuration(null), "—");
  assert.equal(formatDate(day(2026, 9, 14)), "Lun 14/09/26");
  assert.equal(formatDate(null), "—");
});

test("les colonnes Grist utilisées", () => {
  assert.equal(PLANNING_TABLE, "Planning_Projet");
  assert.deepEqual({ ...TASK_COLUMNS }, {
    id: "id",
    project: "NomProjet",
    name: "Taches",
    typeDoc: "Type_doc",
    id2: "ID2",
    zone: "Zone",
    group: "Groupe",
    floor: "Etage",
    start: "Diff_coffrage",
    end: "Diff_armature",
    duration: "Duree_1",
  });
});

// Review Focus 2 : Etage sous toutes ses formes.
test("un étage est une ligne nommée, sans type ni ID, marquée Etage", () => {
  assert.equal(isFloorRow(taskRow({ Etage: true })), true);
  assert.equal(isFloorRow(taskRow({ Etage: "true" })), true);
  assert.equal(isFloorRow(taskRow({ Etage: " TRUE " })), true);
  assert.equal(isFloorRow(taskRow({ Etage: false })), false);
  assert.equal(isFloorRow(taskRow({ Etage: "" })), false);
  assert.equal(isFloorRow(taskRow()), false, "colonne absente");
  assert.equal(isFloorRow(taskRow({ Etage: true, Type_doc: "COFFRAGE" })), false);
  assert.equal(isFloorRow(taskRow({ Etage: true, Taches: " " })), false);
});

test("un étage n'est pas une tâche ; tâches et étages sont des lignes Synthese", () => {
  assert.equal(isTaskRow(taskRow({ Etage: true })), false);
  assert.equal(isTaskRow(taskRow({ Etage: false })), true);
  assert.equal(isSyntheseRow(taskRow({ Etage: true })), true);
  assert.equal(isSyntheseRow(taskRow()), true);
  assert.equal(isSyntheseRow(taskRow({ Type_doc: "COFFRAGE" })), false);
  assert.equal(isSyntheseRow(taskRow({ Taches: "" })), false);
});

test("readTask lit le Groupe : l'étage de la tâche", () => {
  const inFloor = readTask(taskRow({ Groupe: " PH RDB " }));
  assert.equal(inFloor.groupName, "PH RDB");
  assert.equal(inFloor.floorKey, "phrdb");
  const atZone = readTask(taskRow());
  assert.equal(atZone.groupName, "");
  assert.equal(atZone.floorKey, "");
});

// Review Focus 1 : dates au format de la ligne d'exemple (ISO avec heure).
test("dates ISO avec heure (« 2026-11-30T00:00:00.000Z ») lues au bon jour", () => {
  const task = readTask(taskRow({
    Diff_coffrage: "2026-11-30T00:00:00.000Z",
    Diff_armature: "2026-11-30T00:00:00.000Z",
    Duree_1: 0,
  }));
  assert.equal(iso(task.start), "2026-11-30");
  assert.equal(iso(task.end), "2026-11-30");
  assert.equal(task.isMilestone, true);
});

test("floorKeyOf ignore casse, accents et ponctuation", () => {
  assert.equal(floorKeyOf("PH RDB"), "phrdb");
  assert.equal(floorKeyOf(" Ph-Rdb "), "phrdb");
  assert.equal(floorKeyOf("Étage R+1"), "etagerp1");
  assert.equal(floorKeyOf(""), "");
  assert.equal(floorKeyOf(null), "");
});

test("floorKeyOf distingue les niveaux signés : R+1 ≠ R-1, sans séparer « PH RDB » et « ph-rdb »", () => {
  assert.notEqual(floorKeyOf("PH R+1"), floorKeyOf("PH R-1"));
  assert.equal(floorKeyOf("PH R-1"), floorKeyOf("PH R−1"), "signe moins typographique");
  assert.equal(floorKeyOf("PH R-1"), floorKeyOf("PH R–1"), "tiret demi-cadratin");
  assert.equal(floorKeyOf("PH R-1"), floorKeyOf("ph r - 1"));
  assert.equal(floorKeyOf("PH R+1"), floorKeyOf("ph r + 1"));
  assert.notEqual(floorKeyOf("Niveau -2"), floorKeyOf("Niveau 2"));
  assert.equal(floorKeyOf("PH RDB"), floorKeyOf("ph-rdb"));
});
