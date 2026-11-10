import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildTimelineDataFromPlanningRows } from "../assets/js/services/planningService.js";
import {
  PLANNING_EXPORT_COLUMNS,
  buildPlanningExportModel,
  planningExportRowTone,
} from "../assets/js/services/planningExport.js";

const PROJECT = "HOTEL DIEU";
const EXPORTED_AT = new Date(2026, 10, 10, 15, 2);

function row(overrides = {}) {
  return { NomProjet: PROJECT, Service: "Structure", ...overrides };
}

// Deux zones (« B » volontairement créée avant « A »), une zone vide et des lignes sans zone :
// l'export doit suivre l'ordre de l'écran, pas l'ordre des identifiants.
const ROWS = [
  row({ id: 1, Zone: "ZONE B" }),
  row({
    id: 2, Zone: "ZONE B", Groupe: "1", ID2: "1200", Taches: "COFFRAGE R+1 B",
    Type_doc: "COFFRAGE", Diff_coffrage: "2026-03-20", Duree_1: 2, Indice: "A",
  }),
  row({ id: 3, Zone: "ZONE A" }),
  row({
    id: 4, Zone: "ZONE A", Groupe: "1", ID2: "1100", Taches: "COFFRAGE RDC A",
    Type_doc: "COFFRAGE", Diff_coffrage: "2026-02-13", Duree_1: 3,
  }),
  row({
    id: 5, Zone: "ZONE A", Groupe: "1", ID2: "1101", Taches: "ARMATURES RDC A",
    Type_doc: "ARMATURES", Diff_coffrage: "2026-02-13", Diff_armature: "2026-02-27",
    Duree_2: 2, Duree_3: 1, Demarrages_travaux: "2026-03-06",
  }),
  row({
    id: 6, Zone: "", ID2: "007", Taches: "NOTE DE CALCUL", Type_doc: "NDC",
    Date_limite: "2026-01-09", Diff_coffrage: "2026-01-30", Duree_1: 3,
  }),
  row({ id: 7, Zone: "ZONE C" }),
];

function exportOf(rows = ROWS, extra = {}) {
  const timelineData = buildTimelineDataFromPlanningRows(rows, PROJECT, "", null, null);
  return {
    timelineData,
    model: buildPlanningExportModel({
      groups: timelineData.groups,
      projectName: PROJECT,
      projectNumber: "24-117",
      serviceName: "Structure",
      exportedAt: EXPORTED_AT,
      ...extra,
    }),
  };
}

function headerTextsFromIndexHtml(html) {
  const left = html.slice(
    html.indexOf('<div class="planning-header-left">'),
    html.indexOf('<div class="planning-header-right">')
  );
  return [...left.matchAll(/<div\s+class="hcol[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((match) => match[1]
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/&eacute;/g, "é")
    .replace(/&acirc;/g, "â")
    .trim());
}

test("les en-têtes de l'export sont ceux du planning, dans le même ordre", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const screenHeaders = headerTextsFromIndexHtml(html);
  assert.equal(screenHeaders.length, 11);
  assert.deepEqual(PLANNING_EXPORT_COLUMNS.map((column) => column.header), screenHeaders);
});

test("les lignes suivent exactement l'ordre de l'écran : bandeau de zone puis ses lignes", () => {
  const { timelineData, model } = exportOf();
  const screenOrder = timelineData.groups.map((group) => (
    group.isZoneHeader ? `zone:${group.zoneHeaderLabel}` : `ligne:${group.tachesLabel}`
  ));
  const exportOrder = model.rows.map((entry) => (
    entry.kind === "zone" ? `zone:${entry.label}` : `ligne:${entry.cells[1].value}`
  ));
  assert.deepEqual(exportOrder, screenOrder);
  assert.deepEqual(exportOrder, [
    "zone:ZONE A",
    "ligne:COFFRAGE RDC A",
    "ligne:ARMATURES RDC A",
    "zone:ZONE B",
    "ligne:COFFRAGE R+1 B",
    "zone:ZONE C",
    "zone:Sans zone",
    "ligne:NOTE DE CALCUL",
  ]);
  assert.equal(model.zoneCount, 4);
  assert.equal(model.taskCount, 4);
});

test("chaque cellule reprend la valeur affichée, en vraie date ou en vrai nombre", () => {
  const { model } = exportOf();
  const tasks = model.rows.filter((entry) => entry.kind === "task");
  const armatures = tasks.find((entry) => entry.cells[1].value === "ARMATURES RDC A");
  const values = armatures.cells.map((cell) => cell.value);

  assert.equal(values[0], 1101);
  assert.equal(values[2], null);
  assert.deepEqual(values[3], new Date(Date.UTC(2026, 1, 13)));
  assert.equal(values[4], 2);
  assert.deepEqual(values[5], new Date(Date.UTC(2026, 1, 27)));
  assert.equal(values[6], 1);
  assert.deepEqual(values[7], new Date(Date.UTC(2026, 2, 6)));
  assert.equal(values[8], null);
  assert.equal(values[9], 0);

  // Un code à zéro de tête reste du texte : Excel ne doit pas le transformer en 7.
  const ndc = tasks.find((entry) => entry.cells[1].value === "NOTE DE CALCUL");
  assert.equal(ndc.cells[0].value, "007");
  assert.equal(ndc.tone, "ndc");

  // Coffrage du groupe de ZONE A : Début = Diff_coffrage − 3 semaines, comme à l'écran.
  const coffrage = tasks.find((entry) => entry.cells[1].value === "COFFRAGE RDC A");
  assert.deepEqual(coffrage.cells[3].value, new Date(Date.UTC(2026, 0, 23)));
  assert.deepEqual(coffrage.cells[5].value, new Date(Date.UTC(2026, 1, 13)));
  assert.equal(coffrage.tone, "coffrage");
  assert.equal(armatures.tone, "armature");
});

test("réalisation forcée, avancement terminé et retard justifié sont repris", () => {
  const groups = [
    { isZoneHeader: true, zoneHeaderLabel: "ZONE A" },
    {
      tachesLabel: "Forcée", typeDocLabel: "COFFRAGE", realiseLabel: "100",
      dateClotureLabel: "15/07/2026", retardsLabel: "0", remarqueLabel: "",
    },
    {
      tachesLabel: "Terminée", typeDocLabel: "ARMATURES", realiseLabel: "100",
      retardsLabel: "", remarqueLabel: "",
    },
    {
      tachesLabel: "En retard", typeDocLabel: "COFFRAGE", realiseLabel: "40",
      retardsLabel: "12.6", remarqueLabel: "Attente fond de plan architecte",
    },
    {
      tachesLabel: "Justifiée à l'heure", typeDocLabel: "COFFRAGE", realiseLabel: "40",
      retardsLabel: "-3", remarqueLabel: "Note sans retard",
    },
  ];
  const model = buildPlanningExportModel({ groups, projectName: PROJECT, exportedAt: EXPORTED_AT });
  const [forced, done, late, onTime] = model.rows.filter((entry) => entry.kind === "task");

  assert.equal(forced.cells[9].value, "100 % — réalisation forcée le 15/07/2026");
  assert.equal(forced.forcedClosure, true);
  assert.equal(forced.realiseComplete, true);
  assert.equal(forced.cells[10].value, null);

  assert.equal(done.cells[9].value, 100);
  assert.equal(done.realiseComplete, true);
  assert.equal(done.forcedClosure, false);

  assert.equal(late.cells[10].value, 12);
  assert.equal(late.cells[10].note, "Attente fond de plan architecte");
  assert.equal(late.late, true);
  assert.equal(late.justified, true);
  assert.equal(late.realiseComplete, false);

  assert.equal(onTime.cells[10].value, null);
  assert.equal(onTime.cells[10].note, "Note sans retard");
  assert.equal(onTime.late, false);
  assert.equal(onTime.justified, true);
});

test("la couleur d'une ligne suit la règle de l'écran", () => {
  assert.equal(planningExportRowTone("COFFRAGE"), "coffrage");
  assert.equal(planningExportRowTone("ARMATURES"), "armature");
  assert.equal(planningExportRowTone("NDC"), "ndc");
  assert.equal(planningExportRowTone("Note de calcul"), "ndc");
  assert.equal(planningExportRowTone("COUPES"), "coupes");
  assert.equal(planningExportRowTone("Démolition"), "demolition");
  assert.equal(planningExportRowTone("RESERVATIONS"), "generic");
  assert.equal(planningExportRowTone(""), "");
  // Plusieurs mots-clés : la dernière règle de la feuille de style l'emporte, comme à l'écran.
  assert.equal(planningExportRowTone("COFFRAGE COUPE"), "coupes");
  assert.equal(planningExportRowTone("COUPE DEMOLITION"), "demolition");
});

test("l'en-tête du fichier décrit le projet, le service, la date et le contenu", () => {
  const { model } = exportOf();
  assert.equal(model.title, "Planning Structure");
  assert.equal(model.projectName, PROJECT);
  assert.deepEqual(model.details, [
    "N° de projet : 24-117",
    "Exporté le 10/11/2026 à 15:02",
    "4 zones, 4 lignes",
  ]);
  assert.equal(model.sheetName, "Planning Structure");
  assert.equal(model.fileName, "Planning Structure - HOTEL DIEU - 2026-11-10.xlsx");
});

test("sans numéro ni service, l'en-tête reste propre et le singulier est respecté", () => {
  const model = buildPlanningExportModel({
    groups: [
      { isZoneHeader: true, zoneHeaderLabel: "ZONE A" },
      { tachesLabel: "Seule", typeDocLabel: "COFFRAGE", realiseLabel: "0" },
    ],
    projectName: PROJECT,
    exportedAt: EXPORTED_AT,
  });
  assert.equal(model.title, "Planning projet");
  assert.deepEqual(model.details, ["Exporté le 10/11/2026 à 15:02", "1 zone, 1 ligne"]);
  assert.equal(model.fileName, "Planning projet - HOTEL DIEU - 2026-11-10.xlsx");
});

test("les caractères interdits par Windows et Excel sont retirés des noms", () => {
  const model = buildPlanningExportModel({
    groups: [],
    projectName: '  Lot 2/3 : "Tour*Nord"?  ',
    serviceName: "Topo[graphie]/Réseaux:extérieurs et intérieurs",
    exportedAt: EXPORTED_AT,
  });
  // « / \ : | » deviennent un tiret (« Lot 2/3 » reste lisible), « * ? " < > » disparaissent.
  assert.equal(model.fileName, "Planning Topo[graphie]-Réseaux-extérieurs et intérieurs - Lot 2-3 - TourNord - 2026-11-10.xlsx");
  assert.ok(model.sheetName.length <= 31, model.sheetName);
  assert.doesNotMatch(model.sheetName, /[\\/?*[\]:]/);
});
