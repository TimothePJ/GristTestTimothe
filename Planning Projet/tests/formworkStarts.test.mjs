import test from "node:test";
import assert from "node:assert/strict";

// gristService lit `window.grist` au moment de l'appel seulement, mais son import
// exige que `window` existe.
globalThis.window = { location: { search: "" } };

const { buildFormworkStarts } = await import("../assets/js/services/formworkStarts.js");

const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  : date);

// Une ligne brute de Planning_Projet, aux vrais noms de colonnes.
function rawRow(fields = {}) {
  return {
    id: 1,
    NomProjet: "HOTEL DIEU",
    Service: "Structure",
    ID2: "3001",
    Taches: "PH SS1",
    Type_doc: "COFFRAGE",
    Zone: "Zone A",
    Groupe: "",
    Ligne_planning: "",
    Indice: "",
    Duree_1: null,
    Duree_2: null,
    Duree_3: null,
    Date_limite: null,
    Diff_coffrage: null,
    Diff_armature: null,
    Demarrages_travaux: null,
    Retards: 0,
    Realise: 0,
    Date_Realise: null,
    Date_Cloture: null,
    Remarque: "",
    ...fields,
  };
}

test("début du plan de coffrage : la colonne « Début » du planning Structure, coffrage par coffrage", () => {
  const starts = buildFormworkStarts([
    // Début saisi, sans durée.
    rawRow({ id: 1, ID2: "3001", Date_limite: "2026-03-02" }),
    // Fin (diffusion) au 15/07/26 et 4 semaines de plan : début le 17/06/26.
    rawRow({ id: 2, ID2: "3002", Diff_coffrage: "2026-07-15", Duree_1: 4 }),
    // Lié à une ligne du planning travaux : démarrage 07/09/26 − 2 semaines = fin le 24/08/26,
    // − 3 semaines de plan = début le 03/08/26.
    rawRow({ id: 3, ID2: "3003", Zone: "Zone B", Ligne_planning: "12", Demarrages_travaux: "2026-09-07", Duree_3: 2, Duree_1: 3 }),
    // Sans aucune date.
    rawRow({ id: 4, ID2: "3004" }),
    // Ni un coffrage, ni une ligne de Structure, ni un document : ignorés.
    rawRow({ id: 5, ID2: "4001", Type_doc: "ARMATURES", Diff_coffrage: "2026-07-15", Diff_armature: "2026-08-15" }),
    rawRow({ id: 6, ID2: "9001", Service: "Fluides", Date_limite: "2026-03-02" }),
    rawRow({ id: 7, ID2: "", Service: "Synthese", Type_doc: "", Taches: "PLAN DE SYNTHESE RESERVATIONS NIV SS1" }),
    null,
  ]);
  assert.deepEqual(starts.map((entry) => [entry.number, entry.zoneName, iso(entry.start)]), [
    ["3001", "Zone A", "2026-03-02"],
    ["3002", "Zone A", "2026-06-17"],
    ["3003", "Zone B", "2026-08-03"],
    ["3004", "Zone A", null],
  ]);
});

test("aucune ligne : aucun coffrage", () => {
  assert.deepEqual(buildFormworkStarts([]), []);
  assert.deepEqual(buildFormworkStarts(null), []);
});
