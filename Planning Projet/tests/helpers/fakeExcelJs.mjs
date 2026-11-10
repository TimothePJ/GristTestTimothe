// Imitation minimale d'ExcelJS (Workbook / Worksheet / Row / Column / Cell) : elle garde ce que
// l'écrivain du planning lui demande, pour que les tests relisent valeurs, styles, fusions et
// images sans charger la vraie bibliothèque (servie par CDN dans le widget).

class FakeCell {
  constructor(row, col) {
    this.row = row;
    this.col = col;
    this.value = null;
  }
}

class FakeRow {
  constructor(worksheet, number) {
    this.worksheet = worksheet;
    this.number = number;
    this.height = undefined;
    this.outlineLevel = 0;
  }

  getCell(col) {
    return this.worksheet.getCell(this.number, col);
  }
}

class FakeColumn {
  constructor(number) {
    this.number = number;
    this.width = undefined;
  }
}

class FakeWorksheet {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
    this.views = options.views || [];
    this.pageSetup = { ...(options.pageSetup || {}) };
    this.headerFooter = { ...(options.headerFooter || {}) };
    this.properties = { ...(options.properties || {}) };
    this.cells = new Map();
    this.rowMap = new Map();
    this.columnMap = new Map();
    this.merges = [];
    this.images = [];
  }

  getCell(row, col) {
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 1 || col < 1) {
      throw new Error(`Adresse de cellule invalide : ${row}, ${col}`);
    }
    const key = `${row}:${col}`;
    if (!this.cells.has(key)) this.cells.set(key, new FakeCell(row, col));
    return this.cells.get(key);
  }

  getRow(row) {
    if (!this.rowMap.has(row)) this.rowMap.set(row, new FakeRow(this, row));
    return this.rowMap.get(row);
  }

  getColumn(col) {
    if (!this.columnMap.has(col)) this.columnMap.set(col, new FakeColumn(col));
    return this.columnMap.get(col);
  }

  mergeCells(top, left, bottom, right) {
    this.merges.push([top, left, bottom, right]);
  }

  addImage(imageId, range) {
    this.images.push({ imageId, range });
  }

  rowValues(row, columnCount) {
    return Array.from({ length: columnCount }, (_, index) => this.getCell(row, index + 1).value);
  }
}

class FakeWorkbook {
  constructor() {
    this.worksheets = [];
    this.media = [];
    this.xlsx = {
      writeBuffer: async () => new Uint8Array([0x50, 0x4b]).buffer,
    };
  }

  addWorksheet(name, options) {
    const worksheet = new FakeWorksheet(name, options);
    this.worksheets.push(worksheet);
    return worksheet;
  }

  addImage(media) {
    this.media.push(media);
    return this.media.length - 1;
  }
}

export function createFakeExcelJs() {
  return { Workbook: FakeWorkbook };
}
