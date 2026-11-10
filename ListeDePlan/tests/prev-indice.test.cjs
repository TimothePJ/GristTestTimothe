'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'affichage.js'), 'utf8');

// DOM minimal : uniquement ce que le rendu des tableaux et la saisie des dates utilisent.
class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.textContent = '';
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    };
  }

  get cells() {
    return this.children;
  }

  get childElementCount() {
    return this.children.length;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...items) {
    items.forEach((item) => {
      if (item instanceof FakeElement) this.appendChild(item);
      else this.textContent += String(item);
    });
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }

  // Sélecteurs « balise.classe.classe » seulement.
  matches(selector) {
    const [tagName, ...classNames] = String(selector).split('.');
    const ownClasses = this.className.split(/\s+/);
    return (!tagName || this.tagName === tagName.toUpperCase()) &&
      classNames.every((name) => this.classList.contains(name) || ownClasses.includes(name));
  }

  querySelectorAll(selector) {
    return descendants(this).filter((element) => element.matches(selector));
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, bottom: 0, width: 0, height: 0 };
  }
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function fullText(element) {
  return element.textContent + element.children.map(fullText).join('');
}

function loadAffichage() {
  const document = {
    body: new FakeElement('body'),
    createElement: (tagName) => new FakeElement(tagName),
    addEventListener() {},
    getElementById() { return null; },
    querySelectorAll() { return []; },
  };
  const context = vm.createContext({
    console,
    document,
    window: {
      GristServiceContext: { watchContextTables() {} },
      scrollX: 0,
      scrollY: 0,
      innerWidth: 1200,
    },
    grist: { docApi: { fetchTable: async () => ({ id: [], Nom_de_projet: [] }) } },
    flatpickr: () => ({ open() {}, close() {}, destroy() {} }),
  });
  vm.runInContext(source, context, { filename: 'affichage.js' });
  vm.runInContext(
    'globalThis.api = { renderPlanTableSection, buildDateCellActions, ouvrirPickerRemplirCellules };',
    context
  );
  return { api: context.api, document };
}

// Une ligne de ListePlan_NDC_COF telle que Grist la livre.
function planRow(overrides = {}) {
  return {
    id: 1,
    Nom_projet: "ERA QUAI D'ORSAY",
    Type_document: 'COFFRAGE',
    NumeroDocument: '3001',
    Designation: 'FONDATIONS - COF',
    Indice: '',
    DateDiffusion: null,
    Zone: 'Zone 1 / BAT BC',
    Service: 'Structure',
    ...overrides,
  };
}

function render(api, rows, options) {
  const container = new FakeElement('div');
  api.renderPlanTableSection(container, rows, "ERA QUAI D'ORSAY", null, options);
  const headers = container.querySelectorAll('th').map((th) => th.textContent);
  const bodyRows = container.querySelectorAll('tbody')[0].children;
  return {
    container,
    headers,
    cell(rowIndex, header) {
      const columnIndex = headers.indexOf(header);
      assert.notEqual(columnIndex, -1, `colonne « ${header} » absente : ${headers.join(' | ')}`);
      return bodyRows[rowIndex].cells[columnIndex];
    },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("la colonne 0 Prev s'affiche entre la désignation et l'indice 0, sans aucune date saisie", () => {
  const { api } = loadAffichage();
  const { headers } = render(api, [planRow()]);

  assert.deepEqual(headers, ['N° Document', 'Désignation', '0 Prev', '0']);
});

test('une date saisie en 0 Prev crée une ligne dont Indice vaut « Prev 0 »', () => {
  const { api } = loadAffichage();
  const table = render(api, [planRow()]);

  const { actionsUpsert, actionsDelete } = api.buildDateCellActions(
    table.cell(0, '0 Prev'),
    '2026-09-01T00:00:00.000Z'
  );

  assert.deepEqual(plain(actionsUpsert), [[
    'AddRecord',
    'ListePlan_NDC_COF',
    null,
    {
      NumeroDocument: '3001',
      Type_document: 'COFFRAGE',
      Designation: 'FONDATIONS - COF',
      Nom_projet: "ERA QUAI D'ORSAY",
      Zone: 'Zone 1 / BAT BC',
      Indice: 'Prev 0',
      DateDiffusion: '2026-09-01T00:00:00.000Z',
      Service: 'Structure',
    },
  ]]);
  assert.deepEqual(plain(actionsDelete), []);
});

test('une ligne « Prev 0 » existante remplit la colonne 0 Prev, à côté de l’indice 0', () => {
  const { api } = loadAffichage();
  const table = render(api, [
    planRow(),
    planRow({ id: 12, Indice: 'Prev 0', DateDiffusion: '2025-11-10' }),
    planRow({ id: 13, Indice: '0', DateDiffusion: '2025-11-27' }),
  ]);

  assert.deepEqual(table.headers, ['N° Document', 'Désignation', '0 Prev', '0', 'A']);
  assert.equal(table.cell(0, '0 Prev').textContent, '10/11/2025');
  assert.equal(String(table.cell(0, '0 Prev').dataset.recordId), '12');
  assert.equal(table.cell(0, '0').textContent, '27/11/2025');
  assert.equal(String(table.cell(0, '0').dataset.recordId), '13');
});

test('une ligne saisie à la main en « PREV 0 » reste rattachée à la colonne 0 Prev', () => {
  const { api } = loadAffichage();
  const table = render(api, [
    planRow(),
    planRow({ id: 12, Indice: 'PREV 0', DateDiffusion: '2025-11-10' }),
  ]);

  assert.equal(table.cell(0, '0 Prev').textContent, '10/11/2025');
});

test("une prévision seule n'ouvre pas la colonne de l'indice suivant", () => {
  const { api } = loadAffichage();
  const { headers } = render(api, [
    planRow(),
    planRow({ id: 12, Indice: 'Prev 0', DateDiffusion: '2025-11-10' }),
  ]);

  assert.deepEqual(headers, ['N° Document', 'Désignation', '0 Prev', '0']);
});

test("l'absence de prévision n'est pas signalée comme une date manquante", () => {
  const { api } = loadAffichage();
  const table = render(api, [
    planRow(),
    planRow({ id: 13, Indice: '0', DateDiffusion: '2025-11-27' }),
    planRow({ id: 14, Indice: 'A', DateDiffusion: '2026-02-20' }),
  ]);

  assert.equal(table.cell(0, '0 Prev').textContent, '');
  assert.equal(table.cell(0, '0 Prev').classList.contains('missing-date-error'), false);
  assert.deepEqual(table.container.querySelectorAll('div.warnings'), []);
});

test("effacer l'indice 0 quand il ne reste que la prévision libère aussi son indice", () => {
  const { api } = loadAffichage();
  const table = render(api, [
    planRow(),
    planRow({ id: 12, Indice: 'Prev 0', DateDiffusion: '2025-11-10' }),
    planRow({ id: 13, Indice: '0', DateDiffusion: '2025-11-27' }),
  ]);

  const { actionsUpsert } = api.buildDateCellActions(table.cell(0, '0'), null);

  assert.deepEqual(plain(actionsUpsert), [[
    'UpdateRecord',
    'ListePlan_NDC_COF',
    13,
    { DateDiffusion: null, Indice: null },
  ]]);
});

test("l'impression, limitée aux indices diffusés, n'affiche pas la colonne de prévision", () => {
  const { api } = loadAffichage();
  const { headers } = render(api, [
    planRow(),
    planRow({ id: 12, Indice: 'Prev 0', DateDiffusion: '2025-11-10' }),
    planRow({ id: 13, Indice: '0', DateDiffusion: '2025-11-27' }),
  ], {
    // Options passées par l'impression PDF (script.js, buildPrintContainer).
    datedIndicesOnly: true,
    includeNextIndiceColumn: false,
    maxIndiceColumns: 6,
    wrapTable: false,
  });

  assert.deepEqual(headers, ['N° Document', 'Désignation', '0']);
});

test('le remplissage groupé nomme la colonne « 0 Prev »', () => {
  const { api, document } = loadAffichage();
  const table = render(api, [
    planRow(),
    planRow({ id: 2, NumeroDocument: '3011', Designation: 'PBAS 1er SOUS-SOL - COF' }),
  ]);
  const cells = [table.cell(0, '0 Prev'), table.cell(1, '0 Prev')];

  api.ouvrirPickerRemplirCellules(cells, cells[1]);

  const popup = document.body.children.find((element) => element.id === 'date-drag-fill-popup');
  assert.ok(popup, 'la fenêtre de remplissage groupé est absente');
  assert.equal(fullText(popup.children[0]), 'Remplir 2 case(s) de la colonne 0 Prev');
});

// --- Impression : liste des indices diffusés (script.js) ---

const scriptSource = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

function extractFunction(sourceText, name) {
  const marker = `function ${name}(`;
  const start = sourceText.indexOf(marker);
  assert.notEqual(start, -1, `${name} introuvable`);
  const braceStart = sourceText.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < sourceText.length; index += 1) {
    if (sourceText[index] === '{') depth += 1;
    else if (sourceText[index] === '}') {
      depth -= 1;
      if (depth === 0) return sourceText.slice(start, index + 1);
    }
  }
  throw new Error(`fin de ${name} introuvable`);
}

test("la prévision ne compte pas parmi les indices à imprimer", () => {
  // Même page que dans le navigateur : script.js et affichage.js partagent leurs fonctions.
  const context = vm.createContext({
    console,
    document: { addEventListener() {}, getElementById() { return null; } },
    window: { GristServiceContext: { watchContextTables() {} } },
    grist: { docApi: { fetchTable: async () => ({ id: [], Nom_de_projet: [] }) } },
  });
  vm.runInContext(source, context, { filename: 'affichage.js' });
  vm.runInContext([
    'normalizeProjectName',
    'getNomProjet',
    'normalizeTypeDocumentValue',
    'normalizePrintIndexValue',
    'comparePrintIndexValues',
    'getPrintAvailableIndexValues',
  ].map((name) => extractFunction(scriptSource, name)).join('\n'), context, { filename: 'script.js' });
  context.window.records = [
    planRow(),
    planRow({ id: 12, Indice: 'Prev 0', DateDiffusion: '2025-11-10' }),
    planRow({ id: 13, Indice: '0', DateDiffusion: '2025-11-27' }),
    planRow({ id: 14, Indice: 'A', DateDiffusion: '2026-02-20' }),
  ];

  const indices = vm.runInContext(`getPrintAvailableIndexValues("ERA QUAI D'ORSAY")`, context);

  assert.deepEqual(plain(indices), ['0', 'A']);
});

// --- Tableau de bord d'avancement (avancement.js) ---

const avancementSource = fs.readFileSync(path.join(__dirname, '..', 'avancement.js'), 'utf8');

function loadAvancement() {
  const dropdown = {
    value: '',
    options: [{ value: '' }],
    remove(index) { this.options.splice(index, 1); },
    appendChild(option) { this.options.push(option); },
    addEventListener() {},
  };
  const panes = new Map();
  const pane = (id) => {
    if (!panes.has(id)) {
      panes.set(id, { innerHTML: '', style: {}, scrollTop: 0, getContext: () => ({}) });
    }
    return panes.get(id);
  };
  let deliverListePlan = null;
  class FakeChart {
    static register() {}
    destroy() {}
  }
  const context = vm.createContext({
    console,
    Chart: FakeChart,
    ChartDataLabels: {},
    grist: {
      ready() {},
      docApi: {
        fetchTable: async () => ({ id: [], gristHelper_Display: [], Type_document: [], Budget: [] }),
      },
    },
    document: {
      getElementById: (id) => (id === 'projectDropdown' ? dropdown : pane(id)),
      querySelector: (selector) => pane(selector),
      createElement: () => ({}),
      scrollingElement: { scrollTop: 0 },
    },
    window: {
      GristServiceContext: {
        watchContextTable(_tableName, callback) { deliverListePlan = callback; },
        watchContextTables() {},
        selectProject: async () => null,
      },
    },
  });
  vm.runInContext(avancementSource, context, { filename: 'avancement.js' });
  return {
    pane,
    async showProject(projectName, records) {
      deliverListePlan(records);
      dropdown.value = projectName;
      await vm.runInContext('updateDashboard()', context);
    },
  };
}

test("l'indice moyen du tableau de bord ignore la date prévisionnelle", async () => {
  const dashboard = loadAvancement();

  await dashboard.showProject("ERA QUAI D'ORSAY", [
    planRow({ Type_document: 'NDC', NumeroDocument: '3997', Designation: 'NDC GRUE', Zone: '' }),
    planRow({ id: 12, Type_document: 'NDC', NumeroDocument: '3997', Designation: 'NDC GRUE', Zone: '', Indice: 'Prev 0', DateDiffusion: '2025-11-10' }),
    planRow({ id: 13, Type_document: 'NDC', NumeroDocument: '3997', Designation: 'NDC GRUE', Zone: '', Indice: '0', DateDiffusion: '2025-11-28' }),
  ]);

  // Un seul indice diffusé (0) pour un plan arrivé à l'indice 0 : 1 / 1.
  assert.equal(
    dashboard.pane('average-indices-container').innerHTML,
    '<h3>Indice moyen</h3><p><strong>NDC:</strong> 1.00</p>'
  );
});
