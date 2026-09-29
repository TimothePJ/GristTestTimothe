import test from "node:test";
import assert from "node:assert/strict";

import {
  NEW_FLOOR_NAME,
  buildFloorDeleteActions,
  buildFloorDeleteQuestion,
  buildFloorFields,
  buildFloorRenameActions,
  buildMoveFields,
  buildNewTask,
  buildTaskFields,
  containerKeyOf,
  detectFloorColumn,
  floorKeyOf,
  nextFloorName,
  readTask,
  resolveDropTarget,
  validateFloorName,
} from "../assets/js/services/syntheseTaskModel.js";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const TODAY = new Date(2026, 8, 23);

const RDB = { key: "phrdb", name: "PH RDB", rowIds: [20], tasks: [{ id: 2 }, { id: 3 }] };
const RDH = { key: "phrdh", name: "PH RDH", rowIds: [21], tasks: [] };

// Visa MOE : Ven 09/10/26 → Ven 23/10/26, dans la Zone Z3A.
function task(fields = {}) {
  return readTask({
    id: 7,
    Taches: "Visa MOE",
    Type_doc: "",
    ID2: "",
    Zone: "Zone Z3A",
    Groupe: "",
    Diff_coffrage: "2026-10-09",
    Diff_armature: "2026-10-23",
    Duree_1: 11,
    ...fields,
  });
}

test("nom d'étage : obligatoire, limité, avec une lettre ou un chiffre", () => {
  assert.equal(validateFloorName("   ").error, "Le nom de l'étage ne peut pas être vide.");
  assert.equal(validateFloorName("x".repeat(201)).error, "Le nom de l'étage est limité à 200 caractères.");
  assert.equal(validateFloorName("---").error, "Le nom de l'étage doit contenir au moins une lettre ou un chiffre.");
  assert.deepEqual(validateFloorName("  PH R+1 "), { ok: true, name: "PH R+1", key: "phrp1" });
});

test("nom d'étage : unique dans la zone, sans tenir compte de la casse ni des accents", () => {
  const floors = [RDB, RDH];
  assert.equal(validateFloorName("ph-rdh", { floors }).error, "Un étage « PH RDH » existe déjà dans cette zone.");
  // Review Focus 3 : changer la casse de son propre nom n'est pas un doublon.
  assert.equal(validateFloorName("Ph Rdb", { floors, currentKey: "phrdb" }).ok, true);
  assert.equal(validateFloorName("PH RDH", { floors, currentKey: "phrdb" }).ok, false);
});

test("nom par défaut : « Nouvel étage », puis numéroté", () => {
  assert.equal(nextFloorName([]), NEW_FLOOR_NAME);
  assert.equal(nextFloorName([{ key: "nouveletage" }]), "Nouvel étage 2");
  assert.equal(nextFloorName([{ key: "nouveletage" }, { key: "nouveletage2" }]), "Nouvel étage 3");
});

test("colonnes d'une nouvelle ligne-étage", () => {
  assert.deepEqual(buildFloorFields({ name: "PH RDB", zoneName: "Zone Z3A", projectName: "HOTEL DIEU" }), {
    Taches: "PH RDB",
    Zone: "Zone Z3A",
    Groupe: "",
    Etage: true,
    NomProjet: "HOTEL DIEU",
  });
});

test("renommer : lignes-étages et Groupe des tâches en une seule écriture", () => {
  assert.deepEqual(buildFloorRenameActions(RDB, "PH R+1"), [
    ["UpdateRecord", "Planning_Projet", 20, { Taches: "PH R+1" }],
    ["BulkUpdateRecord", "Planning_Projet", [2, 3], { Groupe: ["PH R+1", "PH R+1"] }],
  ]);
  assert.deepEqual(buildFloorRenameActions({ ...RDB, rowIds: [20, 22], tasks: [] }, "PH R+1"), [
    ["BulkUpdateRecord", "Planning_Projet", [20, 22], { Taches: ["PH R+1", "PH R+1"] }],
  ]);
  // Étage sans ligne (issu du Groupe des tâches) : seules ses tâches sont écrites.
  assert.deepEqual(buildFloorRenameActions({ ...RDB, rowIds: [] }, "PH R+1"), [
    ["BulkUpdateRecord", "Planning_Projet", [2, 3], { Groupe: ["PH R+1", "PH R+1"] }],
  ]);
});

test("supprimer : lignes-étages et tâches en une seule écriture ; question avec le nombre de tâches", () => {
  assert.deepEqual(buildFloorDeleteActions(RDB), [["BulkRemoveRecord", "Planning_Projet", [20, 2, 3]]]);
  assert.deepEqual(buildFloorDeleteActions(RDH), [["BulkRemoveRecord", "Planning_Projet", [21]]]);
  assert.equal(buildFloorDeleteQuestion(RDH), "Supprimer l'étage « PH RDH » ?");
  assert.equal(buildFloorDeleteQuestion({ ...RDB, tasks: [{ id: 2 }] }), "Supprimer l'étage « PH RDB » et sa tâche ?");
  const many = { ...RDB, tasks: Array.from({ length: 24 }, (_, index) => ({ id: index + 1 })) };
  assert.equal(buildFloorDeleteQuestion(many), "Supprimer l'étage « PH RDB » et ses 24 tâches ?");
});

test("cible d'un dépôt selon la ligne visée ; conteneur d'une tâche", () => {
  const zone = { kind: "zone", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "", floorName: "" };
  const floorLine = { kind: "floor", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "phrdb", floorName: "PH RDB" };
  const floorTask = { kind: "task", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "phrdb", floorName: "PH RDB" };
  const zoneTask = { kind: "task", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "", floorName: "" };
  const toFloor = {
    key: "floor:zonez3a/phrdb",
    zoneKey: "zonez3a",
    zoneName: "Zone Z3A",
    floorKey: "phrdb",
    floorName: "PH RDB",
    label: "Déplacer dans « PH RDB »",
  };
  const toZone = {
    key: "zone:zonez3a",
    zoneKey: "zonez3a",
    zoneName: "Zone Z3A",
    floorKey: "",
    floorName: "",
    label: "Déplacer au niveau de la zone « Zone Z3A »",
  };
  assert.deepEqual(resolveDropTarget(zone), toZone);
  assert.deepEqual(resolveDropTarget(floorLine), toFloor);
  assert.deepEqual(resolveDropTarget(floorTask), toFloor);
  assert.deepEqual(resolveDropTarget(zoneTask), toZone);
  const noZone = { kind: "zone", zoneKey: "", zoneName: "", floorKey: "", floorName: "" };
  assert.equal(resolveDropTarget(noZone).label, "Déplacer au niveau de la zone « Sans zone »");
  assert.equal(resolveDropTarget(null), null);
  assert.equal(containerKeyOf(floorTask), "floor:zonez3a/phrdb");
  assert.equal(containerKeyOf(zoneTask), "zone:zonez3a");
});

test("déplacer une tâche : seulement ce qui change, rien vers son conteneur actuel", () => {
  const toFloor = { zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "phrdb", floorName: "PH RDB" };
  const toZone = { zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "", floorName: "" };
  const toOtherZone = { zoneKey: "zonez2a", zoneName: "Zone Z2A", floorKey: "", floorName: "" };
  const atZone = task();
  const inFloor = task({ Groupe: "PH RDB" });
  assert.deepEqual(buildMoveFields(atZone, toFloor), { Groupe: "PH RDB" });
  assert.deepEqual(buildMoveFields(inFloor, toZone), { Groupe: "" });
  assert.deepEqual(buildMoveFields(inFloor, toOtherZone), { Zone: "Zone Z2A", Groupe: "" });
  assert.deepEqual(buildMoveFields(inFloor, toFloor), {});
  assert.deepEqual(buildMoveFields(atZone, toZone), {});
  // Dans « Sans zone », la tâche est au niveau zone même si son Groupe nomme un étage.
  const orphan = task({ Zone: "", Groupe: "PH RDB" });
  assert.deepEqual(buildMoveFields(orphan, { zoneKey: "", zoneName: "", floorKey: "", floorName: "" }), {});
});

test("nouvelle tâche dans un étage : après la dernière Fin de l'étage, Groupe écrit", () => {
  const created = buildNewTask({
    zoneName: "Zone Z3A",
    groupName: "PH RDB",
    groupTasks: [task({ Groupe: "PH RDB" })],
    today: TODAY,
  });
  assert.equal(iso(created.start), "2026-10-26");
  assert.equal(created.groupName, "PH RDB");
  assert.equal(created.floorKey, "phrdb");
  assert.deepEqual(buildTaskFields(created, { projectName: "HOTEL DIEU" }), {
    Taches: "Nouvelle tâche",
    Diff_coffrage: "2026-10-26",
    Diff_armature: "2026-10-26",
    Duree_1: 1,
    NomProjet: "HOTEL DIEU",
    Zone: "Zone Z3A",
    Groupe: "PH RDB",
  });
});

test("colonne Etage : présente, absente, ou inconnue sans ligne", () => {
  assert.equal(detectFloorColumn([]), null);
  assert.equal(detectFloorColumn([{ id: 1, Taches: "" }]), false);
  assert.equal(detectFloorColumn([{ id: 1 }, { id: 2, Etage: false }]), true);
});

test("nom d'étage : « PH R+1 » n'est pas un doublon de « PH R-1 »", () => {
  const floors = [{ key: floorKeyOf("PH R-1"), name: "PH R-1" }];
  assert.equal(validateFloorName("PH R+1", { floors }).ok, true);
  assert.equal(validateFloorName("ph r - 1", { floors }).error, "Un étage « PH R-1 » existe déjà dans cette zone.");
});
