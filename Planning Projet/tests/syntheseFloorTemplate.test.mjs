import test from "node:test";
import assert from "node:assert/strict";

import {
  FLOOR_TEMPLATE,
  buildBulkAddAction,
  buildFloorFromTemplate,
  buildTemplateLinks,
} from "../assets/js/services/syntheseFloorTemplate.js";
import { cascadeFrom, parseLink } from "../assets/js/services/syntheseLinks.js";
import { CAPTURE_DAYS, isTemplateTask } from "./helpers/templateRows.mjs";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
// Ids rendus par Grist pour les 26 lignes : la ligne-étage (201), puis le modèle (202 à 226).
const IDS = Array.from({ length: 26 }, (_, index) => 201 + index);

test("modèle : 3 cycles, 2 sous-groupes, 20 tâches", () => {
  assert.equal(FLOOR_TEMPLATE.length, 25);
  assert.deepEqual(
    FLOOR_TEMPLATE.filter((item) => item.nature === "Cycle").map((item) => item.name),
    ["CYCLE 1", "CYCLE 2", "CYCLE 3"]
  );
  assert.deepEqual(
    FLOOR_TEMPLATE.filter((item) => item.nature === "Sous-groupe").map((item) => item.name),
    ["PLAN SYT CYCLE 2", "PLAN SYT CYCLE 3"]
  );
  assert.equal(FLOOR_TEMPLATE.filter(isTemplateTask).length, 20);
});

// Les durées se saisissent à la main : un nouvel étage n'en pré-remplit aucune.
test("nouvel étage : toutes les tâches créées avec une durée de 0", () => {
  const rows = buildFloorFromTemplate({ floorName: "SS1", zoneName: "Zone Z3A", projectName: "HOTEL DIEU" });
  assert.deepEqual([...new Set(rows.map((row) => row.Duree_1))], [0]);
  assert.ok(FLOOR_TEMPLATE.every((item) => !("days" in item)), "plus de durée dans le modèle");
});

test("lignes d'un nouvel étage : la ligne-étage puis le modèle, sans dates, le nom de l'étage dans les noms", () => {
  const rows = buildFloorFromTemplate({ floorName: " SS1 ", zoneName: "Zone Z3A", projectName: "HOTEL DIEU" });
  assert.equal(rows.length, 26);
  assert.deepEqual(rows[0], {
    Taches: "SS1",
    Zone: "Zone Z3A",
    Groupe: "",
    Etage: true,
    NomProjet: "HOTEL DIEU",
    Nature: "",
    Duree_1: 0,
  });
  assert.deepEqual(rows.slice(1).map((row) => row.Taches), [
    "RECEPTION ARCH/TOPO/STR",
    "CYCLE 1",
    "FOND DE PLAN DE SYNTHESE NIV SS1",
    "DIFFUSION FDS Indice 0",
    "RECEPTION RENDU CET RESEAUX (GED)",
    "VISA Indice 0",
    "PLAN DE SYNTHESE RESEAUX NIV SS1",
    "REUNION + DIFFUSION SYT RSX Indice 0",
    "CYCLE 2",
    "RECEPTION RENDU CET RSX RESA TER",
    "PLAN SYT CYCLE 2",
    "PLAN DE SYNTHESE RESEAUX NIV SS1",
    "PLAN DE SYNTHESE RESERVATIONS NIV SS1",
    "PLAN DE SYNTHESE TERMINAUX NIV SS1",
    "REUNION + DIFFUSION SYT",
    "CYCLE 3",
    "RECEPTION RENDU CET RSX RESA TER",
    "VISA Indice A",
    "PLAN SYT CYCLE 3",
    "PLAN DE SYNTHESE RESEAUX NIV SS1",
    "PLAN DE SYNTHESE RESERVATIONS NIV SS1",
    "PLAN DE SYNTHESE TERMINAUX NIV SS1",
    "REUNION + DIFFUSION SYT",
    "SIGNATURE PLANS SYNTHESE",
    "DEMARRAGE GO SS1 (date prévisionnelle)",
  ]);
  rows.slice(1).forEach((row) => {
    assert.equal(row.Groupe, "SS1");
    assert.equal(row.Zone, "Zone Z3A");
    assert.equal(row.NomProjet, "HOTEL DIEU");
    assert.equal(row.Etage, false);
    assert.equal("Diff_coffrage" in row, false);
    assert.equal("Diff_armature" in row, false);
  });
  assert.deepEqual(rows.map((row) => row.Nature).filter(Boolean), [
    "Cycle", "Reunion", "Cycle", "Sous-groupe", "Reunion", "Cycle", "Sous-groupe", "Reunion", "Demarrage",
  ]);
});

test("une seule écriture BulkAddRecord, mêmes colonnes pour toutes les lignes", () => {
  const rows = buildFloorFromTemplate({ floorName: "SS1", zoneName: "Zone Z3A", projectName: "HOTEL DIEU" });
  const [verb, table, ids, columns] = buildBulkAddAction(rows);
  assert.equal(verb, "BulkAddRecord");
  assert.equal(table, "Planning_Projet");
  assert.deepEqual(ids, new Array(26).fill(null));
  assert.deepEqual(Object.keys(columns).sort(), ["Duree_1", "Etage", "Groupe", "Nature", "NomProjet", "Taches", "Zone"]);
  Object.values(columns).forEach((values) => assert.equal(values.length, 26));
  assert.equal(columns.Taches[3], "FOND DE PLAN DE SYNTHESE NIV SS1");
  assert.equal(columns.Etage[0], true);
});

test("Parent et Lien d'après les ids rendus par Grist", () => {
  const { action, fieldsById } = buildTemplateLinks(IDS);
  assert.deepEqual(
    Object.fromEntries([...fieldsById].map(([id, fields]) => [id, [fields.Parent, fields.Lien]])),
    {
      204: ["203", "202 DD"],
      205: ["203", "204 FD"],
      206: ["203", "205 FD"],
      207: ["203", "206 FD"],
      208: ["203", "206 FD"],
      209: ["203", "208 FD"],
      211: ["210", "209 FD"],
      212: ["210", ""],
      213: ["212", "211 FD"],
      214: ["212", "213 FF"],
      215: ["212", "213 FF"],
      216: ["210", "213 FD"],
      218: ["217", "216 FD"],
      219: ["217", "218 FD"],
      220: ["217", ""],
      221: ["220", "218 FD"],
      222: ["220", "221 FF"],
      223: ["220", "221 FF"],
      224: ["217", "221 FD"],
      225: ["217", "219 FD+5"],
      226: ["217", "225 FD"],
    }
  );
  assert.equal(action[0], "BulkUpdateRecord");
  assert.equal(action[1], "Planning_Projet");
  assert.deepEqual(action[2], [...fieldsById.keys()]);
  assert.equal(action[3].Parent.length, 21);
  assert.equal(action[3].Lien[action[2].indexOf(225)], "219 FD+5");
});

test("ids incomplets ou invalides : erreur", () => {
  assert.throws(() => buildTemplateLinks(IDS.slice(1)));
  assert.throws(() => buildTemplateLinks([...IDS.slice(1), 0]));
  assert.throws(() => buildTemplateLinks(null));
});

// Avec les durées de la capture saisies, les liens du modèle redonnent ses dates.
test("le modèle redonne la capture : premier jalon au 02/01/26, SIGNATURE et DEMARRAGE GO au 09/03/26", () => {
  const { fieldsById } = buildTemplateLinks(IDS);
  const tasks = FLOOR_TEMPLATE
    .map((item, index) => ({ item, id: IDS[index + 1] }))
    .filter(({ item }) => isTemplateTask(item))
    .map(({ item, id }) => ({
      id,
      start: null,
      end: null,
      durationDays: CAPTURE_DAYS[item.code],
      isMilestone: false,
      link: parseLink(fieldsById.get(id)?.Lien),
    }));
  const first = { ...tasks[0], start: new Date(2026, 0, 2), end: new Date(2026, 0, 2), durationDays: 0, isMilestone: true };
  const byId = new Map(cascadeFrom(first, tasks).map((task) => [task.id, task]));
  assert.equal(byId.size, 19);
  assert.deepEqual([iso(byId.get(204).start), iso(byId.get(204).end)], ["2026-01-02", "2026-01-05"]);
  assert.deepEqual([iso(byId.get(219).start), iso(byId.get(219).end)], ["2026-02-17", "2026-03-02"]);
  assert.equal(iso(byId.get(225).start), "2026-03-09");
  assert.equal(iso(byId.get(226).start), "2026-03-09");
});
