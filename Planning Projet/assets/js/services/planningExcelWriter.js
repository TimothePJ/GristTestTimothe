// Classeur Excel du planning, construit avec ExcelJS (passé en paramètre : chargé par CDN dans le
// widget, imité dans les tests). Il reçoit le modèle de planningExport.js et ne lit rien d'autre.
//
//   1   Planning Structure                                   [logos]
//   2   Projet : …
//   3   N° de projet · Exporté le … · n zones, n lignes
//   4   (espace)
//   5   Id | Tâches | Ligne planning | Début | … | Retard (j)     ← figée, répétée à l'impression
//   6+  bandeau de zone, puis ses lignes
//
// Pas de plan Excel (lignes repliables par zone) : ExcelJS 4.4.0 écrit alors <pageSetUpPr> avant
// <outlinePr> dans <sheetPr>, à l'inverse de l'ordre imposé par le format, et Excel propose de
// « réparer » le fichier — en perdant l'ajustement à la largeur de la page.

export const PLANNING_EXCEL_LAYOUT = Object.freeze({
  titleRow: 1,
  projectRow: 2,
  detailsRow: 3,
  spacerRow: 4,
  headerRow: 5,
  firstDataRow: 6,
  // Le titre, le projet et les détails occupent les colonnes A à F ; les logos se rangent après.
  textBlockLastColumn: 6,
  logoHeightPx: 48,
  logoGapPx: 8,
});

// Couleurs de la frise (styles.css) et bleu VINCI (variables.css), au format ARGB d'Excel.
const COLORS = Object.freeze({
  vinciBlue: "FF004990",
  white: "FFFFFFFF",
  text: "FF1F2937",
  muted: "FF595959",
  border: "FFD9D9D9",
  headerBorder: "FF7F9CC0",
  zoneFill: "FFE8F2FF",
  zoneText: "FF1D4F91",
  zoneBorder: "FFC6DBFF",
  complete: "FF15803D",
  completeArmature: "FF22C55E",
  forcedFill: "FFDCFCE7",
  forcedText: "FF166534",
  retard: "FFDC2626",
  retardJustified: "FFEA580C",
  justifiedOnly: "FF92400E",
});

const ROW_TONE_FILLS = Object.freeze({
  coffrage: "FFFFF8DC",
  ndc: "FFE9E6F2",
  coupes: "FFD4F7E6",
  demolition: "FFFDE8E8",
  generic: "FFEDE9FF",
});

const DATE_FORMAT = "dd/mm/yyyy";

function solidFill(argb) {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function thinBorder(argb) {
  const side = { style: "thin", color: { argb } };
  return { top: side, left: side, bottom: side, right: side };
}

// Largeur d'une colonne Excel en pixels (police par défaut, chiffre de 7 px).
function columnPixelWidth(width) {
  return Math.trunc(width * 7 + 5);
}

// « & » introduit un code de mise en page dans les en-têtes et pieds de page Excel.
function escapeHeaderFooterText(text) {
  return String(text ?? "").replace(/&/g, "&&");
}

function writeTextBlock(sheet, model) {
  const { titleRow, projectRow, detailsRow, spacerRow, textBlockLastColumn } = PLANNING_EXCEL_LAYOUT;
  const lines = [
    {
      row: titleRow,
      value: model.title,
      height: 28,
      font: { bold: true, size: 16, color: { argb: COLORS.vinciBlue } },
    },
    {
      row: projectRow,
      value: model.projectName ? `Projet : ${model.projectName}` : "Projet",
      height: 20,
      font: { bold: true, size: 12, color: { argb: COLORS.text } },
    },
    {
      row: detailsRow,
      value: model.details.join("   ·   "),
      height: 16,
      font: { size: 10, color: { argb: COLORS.muted } },
    },
  ];
  lines.forEach(({ row, value, height, font }) => {
    sheet.mergeCells(row, 1, row, textBlockLastColumn);
    const cell = sheet.getCell(row, 1);
    cell.value = value;
    cell.font = font;
    cell.alignment = { horizontal: "left", vertical: "middle" };
    sheet.getRow(row).height = height;
  });
  sheet.getRow(spacerRow).height = 6;
}

function writeHeaderRow(sheet, columns) {
  const { headerRow } = PLANNING_EXCEL_LAYOUT;
  sheet.getRow(headerRow).height = 30;
  columns.forEach((column, index) => {
    const cell = sheet.getCell(headerRow, index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: COLORS.white } };
    cell.fill = solidFill(COLORS.vinciBlue);
    cell.alignment = { horizontal: column.align, vertical: "middle", wrapText: true };
    cell.border = thinBorder(COLORS.headerBorder);
    if (column.note) cell.note = column.note;
  });
}

function writeZoneRow(sheet, rowNumber, entry, columnCount) {
  const zoneSide = { style: "thin", color: { argb: COLORS.zoneBorder } };
  for (let col = 1; col <= columnCount; col += 1) {
    const cell = sheet.getCell(rowNumber, col);
    cell.fill = solidFill(COLORS.zoneFill);
    cell.border = { top: zoneSide, bottom: zoneSide };
  }
  sheet.mergeCells(rowNumber, 1, rowNumber, columnCount);
  const cell = sheet.getCell(rowNumber, 1);
  cell.value = entry.label;
  cell.font = { bold: true, size: 11, color: { argb: COLORS.zoneText } };
  cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  sheet.getRow(rowNumber).height = 20;
}

// Vert du « 100 % » : styles.css colore à part les armatures (#22c55e) et les coffrages
// (#15803d) ; les autres types gardent la couleur par défaut donnée.
function completeColor(tone, fallback) {
  if (tone === "armature") return COLORS.completeArmature;
  if (tone === "coffrage") return COLORS.complete;
  return fallback;
}

function retardFont(entry) {
  if (entry.late && entry.justified) return { bold: true, color: { argb: COLORS.retardJustified } };
  if (entry.late) return { bold: true, color: { argb: COLORS.retard } };
  if (entry.justified) return { bold: true, color: { argb: COLORS.justifiedOnly } };
  return null;
}

function writeTaskRow(sheet, rowNumber, entry, columns) {
  const toneFill = ROW_TONE_FILLS[entry.tone];
  const realiseIndex = columns.findIndex((column) => column.key === "realise");
  const retardIndex = columns.findIndex((column) => column.key === "retards");

  columns.forEach((column, index) => {
    const source = entry.cells[index] || { value: null };
    const cell = sheet.getCell(rowNumber, index + 1);
    cell.value = source.value ?? null;
    if (source.note) cell.note = source.note;
    if (column.kind === "date") cell.numFmt = DATE_FORMAT;
    if (toneFill) cell.fill = solidFill(toneFill);
    cell.border = thinBorder(COLORS.border);
    cell.alignment = { horizontal: column.align, vertical: "middle" };
    // Indice et Réalisation sont en demi-gras à l'écran.
    cell.font = column.key === "indice" || column.key === "realise"
      ? { bold: true, color: { argb: COLORS.text } }
      : { color: { argb: COLORS.text } };
  });

  const realise = sheet.getCell(rowNumber, realiseIndex + 1);
  if (entry.forcedClosure) {
    // À l'écran, le vert « 100 % » des coffrages et des armatures l'emporte sur celui de la
    // réalisation forcée (règle CSS plus précise) ; le fond vert reste.
    realise.fill = solidFill(COLORS.forcedFill);
    realise.font = { bold: true, size: 9, color: { argb: completeColor(entry.tone, COLORS.forcedText) } };
    realise.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    sheet.getRow(rowNumber).height = 26;
  } else if (entry.realiseComplete) {
    realise.font = { bold: true, color: { argb: completeColor(entry.tone, COLORS.complete) } };
  }

  const font = retardFont(entry);
  if (font) sheet.getCell(rowNumber, retardIndex + 1).font = font;
}

// Les logos se rangent de gauche à droite après le bloc de texte, chacun au bord d'une colonne
// (ExcelJS place mal un décalage à l'intérieur d'une colonne de largeur personnalisée). Un logo
// qui dépasserait la largeur du tableau est laissé de côté.
function placeLogos(workbook, sheet, columns, logos) {
  const { textBlockLastColumn, logoHeightPx, logoGapPx } = PLANNING_EXCEL_LAYOUT;
  const lefts = [];
  let total = 0;
  columns.forEach((column) => {
    lefts.push(total);
    total += columnPixelWidth(column.width);
  });

  let cursor = lefts[textBlockLastColumn] ?? total;
  (Array.isArray(logos) ? logos : []).forEach((logo) => {
    if (!logo?.base64 || !(logo.width > 0) || !(logo.height > 0)) return;
    const width = Math.round(logoHeightPx * logo.width / logo.height);
    const col = lefts.findIndex((left, index) => index >= textBlockLastColumn && left >= cursor);
    if (col < 0 || lefts[col] + width > total) return;
    const imageId = workbook.addImage({ base64: logo.base64, extension: logo.extension });
    sheet.addImage(imageId, {
      tl: { col, row: 0.15 },
      ext: { width, height: logoHeightPx },
      editAs: "oneCell",
    });
    cursor = lefts[col] + width + logoGapPx;
  });
}

export function buildPlanningWorkbook(ExcelJS, model, { logos = [] } = {}) {
  const { headerRow, firstDataRow } = PLANNING_EXCEL_LAYOUT;
  const columns = model.columns;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Planning Projet";
  workbook.created = model.exportedAt;

  const footerProject = escapeHeaderFooterText(model.projectName);
  const footerTitle = escapeHeaderFooterText(model.title);
  const sheet = workbook.addWorksheet(model.sheetName, {
    views: [{ state: "frozen", xSplit: 0, ySplit: headerRow, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: `${headerRow}:${headerRow}`,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    // Pas de code de taille de police (« &8 ») : un nom de projet commençant par un chiffre
    // serait lu comme une taille.
    headerFooter: {
      oddFooter: `&L${footerProject}&C${footerTitle}&RPage &P / &N`,
    },
  });

  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  writeTextBlock(sheet, model);
  writeHeaderRow(sheet, columns);

  model.rows.forEach((entry, index) => {
    const rowNumber = firstDataRow + index;
    if (entry.kind === "zone") writeZoneRow(sheet, rowNumber, entry, columns.length);
    else writeTaskRow(sheet, rowNumber, entry, columns);
  });

  placeLogos(workbook, sheet, columns, logos);
  return workbook;
}
