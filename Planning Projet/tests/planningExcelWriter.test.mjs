import test from "node:test";
import assert from "node:assert/strict";

import { buildPlanningExportModel } from "../assets/js/services/planningExport.js";
import {
  PLANNING_EXCEL_LAYOUT,
  buildPlanningWorkbook,
} from "../assets/js/services/planningExcelWriter.js";
import { createFakeExcelJs } from "./helpers/fakeExcelJs.mjs";

const EXPORTED_AT = new Date(2026, 10, 10, 15, 2);
const COLUMN_COUNT = 11;
const { headerRow, firstDataRow } = PLANNING_EXCEL_LAYOUT;

const GROUPS = [
  { isZoneHeader: true, zoneHeaderLabel: "ZONE A" },
  {
    id2Label: "1100", tachesLabel: "COFFRAGE RDC A", typeDocLabel: "COFFRAGE",
    debutIso: "2026-01-23", dureeDebutFinLabel: "3", finIso: "2026-02-13",
    indiceLabel: "A", realiseLabel: "40", retardsLabel: "12", remarqueLabel: "Attente archi",
  },
  {
    id2Label: "1101", tachesLabel: "ARMATURES RDC A", typeDocLabel: "ARMATURES",
    debutIso: "2026-02-13", finIso: "2026-02-27", demarrageIso: "2026-03-06",
    realiseLabel: "100", retardsLabel: "0",
  },
  {
    id2Label: "1102", tachesLabel: "COFFRAGE R+1 A", typeDocLabel: "COFFRAGE",
    realiseLabel: "100", dateClotureLabel: "15/07/2026",
  },
  { isZoneHeader: true, zoneHeaderLabel: "Sans zone" },
];

function workbookOf(groups = GROUPS, options = {}) {
  const model = buildPlanningExportModel({
    groups,
    projectName: "HOTEL DIEU & ANNEXES",
    projectNumber: "24-117",
    serviceName: "Structure",
    exportedAt: EXPORTED_AT,
  });
  const workbook = buildPlanningWorkbook(createFakeExcelJs(), model, options);
  return { model, workbook, sheet: workbook.worksheets[0] };
}

function argb(hex) {
  return `FF${hex.toUpperCase()}`;
}

test("un seul onglet, nommé d'après le service, avec l'en-tête du tableau figé", () => {
  const { workbook, sheet } = workbookOf();
  assert.equal(workbook.worksheets.length, 1);
  assert.equal(sheet.name, "Planning Structure");
  assert.equal(workbook.creator, "Planning Projet");
  assert.equal(workbook.created, EXPORTED_AT);
  assert.deepEqual(sheet.views, [{ state: "frozen", xSplit: 0, ySplit: headerRow, showGridLines: false }]);
});

test("en haut : titre, projet et détails, puis la ligne d'en-têtes du planning", () => {
  const { sheet, model } = workbookOf();
  assert.equal(sheet.getCell(1, 1).value, "Planning Structure");
  assert.equal(sheet.getCell(1, 1).font.bold, true);
  assert.equal(sheet.getCell(2, 1).value, "Projet : HOTEL DIEU & ANNEXES");
  assert.equal(sheet.getCell(3, 1).value, model.details.join("   ·   "));
  [1, 2, 3].forEach((row) => {
    assert.ok(sheet.merges.some(([top, left, bottom, right]) => (
      top === row && bottom === row && left === 1 && right === PLANNING_EXCEL_LAYOUT.textBlockLastColumn
    )), `ligne ${row} fusionnée sur le bloc de texte`);
  });

  assert.deepEqual(sheet.rowValues(headerRow, COLUMN_COUNT), model.columns.map((column) => column.header));
  const headerCell = sheet.getCell(headerRow, 1);
  assert.equal(headerCell.fill.fgColor.argb, argb("004990"));
  assert.equal(headerCell.font.color.argb, argb("FFFFFF"));
  assert.equal(headerCell.alignment.wrapText, true);
  assert.equal(sheet.getCell(headerRow, 4).note, "Date limite de réception des données d'entrées");
  model.columns.forEach((column, index) => {
    assert.equal(sheet.getColumn(index + 1).width, column.width);
  });
});

test("un bandeau de zone occupe toute la largeur, aux couleurs de la frise", () => {
  const { sheet } = workbookOf();
  assert.equal(sheet.getCell(firstDataRow, 1).value, "ZONE A");
  assert.ok(sheet.merges.some(([top, left, bottom, right]) => (
    top === firstDataRow && bottom === firstDataRow && left === 1 && right === COLUMN_COUNT
  )));
  for (let col = 1; col <= COLUMN_COUNT; col += 1) {
    assert.equal(sheet.getCell(firstDataRow, col).fill.fgColor.argb, argb("E8F2FF"));
  }
  assert.equal(sheet.getCell(firstDataRow, 1).font.color.argb, argb("1D4F91"));
  assert.equal(sheet.getCell(firstDataRow, 1).font.bold, true);
  // « Sans zone », vide, a aussi son bandeau.
  assert.equal(sheet.getCell(firstDataRow + 4, 1).value, "Sans zone");
});

test("les lignes reprennent valeurs, formats et couleurs de l'écran", () => {
  const { sheet } = workbookOf();
  const coffrageRow = firstDataRow + 1;
  const armatureRow = firstDataRow + 2;
  const forcedRow = firstDataRow + 3;

  const coffrage = sheet.rowValues(coffrageRow, COLUMN_COUNT);
  assert.equal(coffrage[0], 1100);
  assert.equal(coffrage[1], "COFFRAGE RDC A");
  assert.deepEqual(coffrage[3], new Date(Date.UTC(2026, 0, 23)));
  assert.equal(sheet.getCell(coffrageRow, 4).numFmt, "dd/mm/yyyy");
  assert.equal(sheet.getCell(coffrageRow, 6).numFmt, "dd/mm/yyyy");
  assert.equal(sheet.getCell(coffrageRow, 8).numFmt, "dd/mm/yyyy");
  for (let col = 1; col <= COLUMN_COUNT; col += 1) {
    assert.equal(sheet.getCell(coffrageRow, col).fill?.fgColor?.argb, argb("FFF8DC"));
  }
  // Retard justifié : orange (comme la frise), la justification en commentaire.
  const retard = sheet.getCell(coffrageRow, 11);
  assert.equal(retard.value, 12);
  assert.equal(retard.font.color.argb, argb("EA580C"));
  assert.equal(retard.note, "Attente archi");

  // Armatures : pas de fond ; 100 % en vert clair.
  for (let col = 1; col <= COLUMN_COUNT; col += 1) {
    assert.equal(sheet.getCell(armatureRow, col).fill, undefined);
  }
  assert.equal(sheet.getCell(armatureRow, 10).value, 100);
  assert.equal(sheet.getCell(armatureRow, 10).font.color.argb, argb("22C55E"));
  assert.equal(sheet.getCell(armatureRow, 11).value, null);

  // Réalisation forcée : même texte que l'écran, sur fond vert ; sur un coffrage, le vert du
  // « 100 % » des coffrages l'emporte, comme à l'écran.
  const forced = sheet.getCell(forcedRow, 10);
  assert.equal(forced.value, "100 % — réalisation forcée le 15/07/2026");
  assert.equal(forced.fill.fgColor.argb, argb("DCFCE7"));
  assert.equal(forced.font.color.argb, argb("15803D"));
  assert.equal(forced.alignment.wrapText, true);
  assert.ok(sheet.getRow(forcedRow).height >= 24);
});

test("le vert d'une réalisation forcée suit le type de la ligne, comme à l'écran", () => {
  const forcedOf = (typeDocLabel) => {
    const { sheet } = workbookOf([
      { isZoneHeader: true, zoneHeaderLabel: "ZONE A" },
      { tachesLabel: "Forcée", typeDocLabel, realiseLabel: "100", dateClotureLabel: "15/07/2026" },
    ]);
    return sheet.getCell(firstDataRow + 1, 10).font.color.argb;
  };
  assert.equal(forcedOf("COFFRAGE"), argb("15803D"));
  assert.equal(forcedOf("ARMATURES"), argb("22C55E"));
  assert.equal(forcedOf("NDC"), argb("166534"));
  assert.equal(forcedOf("RESERVATIONS"), argb("166534"));
});

// ExcelJS 4.4.0 écrit <pageSetUpPr> avant <outlinePr> : avec l'ajustement à la page, un plan
// Excel rendrait le fichier « à réparer ». Aucun réglage de plan ne doit donc être posé.
test("aucun plan Excel n'est posé à côté de l'ajustement à la page", () => {
  const { sheet } = workbookOf();
  assert.equal(sheet.options.properties, undefined);
  assert.equal(sheet.properties.outlineProperties, undefined);
  for (const row of sheet.rowMap.values()) {
    assert.equal(row.outlineLevel, 0, `ligne ${row.number}`);
  }
});

test("un retard non justifié est rouge, sans commentaire", () => {
  const { sheet } = workbookOf([
    { isZoneHeader: true, zoneHeaderLabel: "ZONE A" },
    { tachesLabel: "En retard", typeDocLabel: "COFFRAGE", realiseLabel: "0", retardsLabel: "4" },
  ]);
  const retard = sheet.getCell(firstDataRow + 1, 11);
  assert.equal(retard.value, 4);
  assert.equal(retard.font.color.argb, argb("DC2626"));
  assert.equal(retard.font.bold, true);
  assert.equal(retard.note, undefined);
});

test("impression : paysage, une page en largeur, en-têtes répétés, pied de page paginé", () => {
  const { sheet } = workbookOf();
  assert.equal(sheet.pageSetup.orientation, "landscape");
  assert.equal(sheet.pageSetup.paperSize, 9);
  assert.equal(sheet.pageSetup.fitToPage, true);
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.fitToHeight, 0);
  assert.equal(sheet.pageSetup.printTitlesRow, `${headerRow}:${headerRow}`);
  // « & » est un code de mise en page dans un pied de page Excel : il est doublé.
  assert.match(sheet.headerFooter.oddFooter, /HOTEL DIEU && ANNEXES/);
  assert.match(sheet.headerFooter.oddFooter, /&P \/ &N/);
});

test("les logos se placent à droite du titre, sans déborder du tableau", () => {
  const logos = [
    { base64: "AAA", extension: "jpeg", width: 2057, height: 745 },
    { base64: "BBB", extension: "png", width: 683, height: 270 },
    { base64: "CCC", extension: "png", width: 799, height: 923 },
  ];
  const { workbook, sheet, model } = workbookOf(GROUPS, { logos });
  assert.deepEqual(workbook.media.map((media) => media.extension), ["jpeg", "png", "png"]);
  assert.equal(sheet.images.length, 3);

  const columnPx = model.columns.map((column) => Math.trunc(column.width * 7 + 5));
  const leftOf = (index) => columnPx.slice(0, index).reduce((sum, px) => sum + px, 0);
  const tableWidth = leftOf(COLUMN_COUNT);
  let previousRight = leftOf(PLANNING_EXCEL_LAYOUT.textBlockLastColumn);
  sheet.images.forEach(({ range }) => {
    assert.ok(Number.isInteger(range.tl.col), "ancré au bord d'une colonne");
    assert.equal(range.ext.height, PLANNING_EXCEL_LAYOUT.logoHeightPx);
    const left = leftOf(range.tl.col);
    assert.ok(left >= previousRight, "les logos ne se chevauchent pas");
    previousRight = left + range.ext.width;
    assert.ok(previousRight <= tableWidth, "le logo reste dans la largeur du tableau");
  });
  // Proportions gardées.
  assert.equal(sheet.images[0].range.ext.width, Math.round(48 * 2057 / 745));
});

test("un logo qui ne tient plus est laissé de côté, et sans logo rien ne casse", () => {
  const tooWide = [
    { base64: "AAA", extension: "png", width: 2000, height: 100 },
    { base64: "BBB", extension: "png", width: 100, height: 100 },
  ];
  const { sheet } = workbookOf(GROUPS, { logos: tooWide });
  assert.ok(sheet.images.length <= 1);

  const { sheet: plain, workbook } = workbookOf(GROUPS, { logos: [] });
  assert.equal(plain.images.length, 0);
  assert.equal(workbook.media.length, 0);
});

test("un projet vide donne quand même un fichier avec son en-tête", () => {
  const { sheet, model } = workbookOf([]);
  assert.equal(model.rows.length, 0);
  assert.deepEqual(sheet.rowValues(headerRow, COLUMN_COUNT), model.columns.map((column) => column.header));
});
