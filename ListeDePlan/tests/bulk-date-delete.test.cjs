'use strict';

// Clic droit « Supprimer les dates » sur des cases sélectionnées (Ctrl ou glisser).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const affichageSource = fs.readFileSync(path.join(__dirname, '..', 'affichage.js'), 'utf8');
const contextMenuSource = fs.readFileSync(path.join(__dirname, '..', 'contextMenu.js'), 'utf8');

// DOM minimal : ce que le rendu des tableaux, la sélection des dates et le menu utilisent.
class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.listeners = {};
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

  get cellIndex() {
    return this.parentElement ? this.parentElement.children.indexOf(this) : -1;
  }

  // Rattaché au document tant qu'on remonte jusqu'au body.
  get isConnected() {
    let element = this;
    while (element.parentElement) element = element.parentElement;
    return element.isDocumentBody === true;
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

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  // Sélecteurs « balise.classe.classe », « #id » et « [data-xxx] » seulement.
  matches(selector) {
    const text = String(selector);
    if (text.startsWith('#')) return this.id === text.slice(1);
    const attribute = text.match(/^\[data-([a-z-]+)\]$/);
    if (attribute) {
      const key = attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return this.dataset[key] !== undefined;
    }
    const [tagName, ...classNames] = text.split('.');
    const ownClasses = this.className.split(/\s+/);
    return (!tagName || this.tagName === tagName.toUpperCase()) &&
      classNames.every((name) => this.classList.contains(name) || ownClasses.includes(name));
  }

  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (element.matches(selector)) return element;
    }
    return null;
  }

  querySelectorAll(selector) {
    // Pour « #plans-output td.xxx », seule la dernière partie compte ici.
    const last = String(selector).trim().split(/\s+/).pop();
    return descendants(this).filter((element) => element.matches(last));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, bottom: 0, width: 0, height: 0 };
  }
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function loadPage() {
  const body = new FakeElement('body');
  body.isDocumentBody = true;
  const documentListeners = {};
  const document = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    addEventListener(type, listener) {
      (documentListeners[type] ||= []).push(listener);
    },
    getElementById: (id) => descendants(body).find((element) => element.id === id) || null,
    querySelectorAll: (selector) => body.querySelectorAll(selector),
  };
  const appliedActions = [];
  const alerts = [];
  const window = {
    GristServiceContext: { watchContextTables() {} },
    scrollX: 0,
    scrollY: 0,
    innerWidth: 1200,
    records: [],
    // Les minuteries (anti double-clic) n'ont pas d'effet à tester ici.
    setTimeout: () => 0,
  };
  const context = vm.createContext({
    console,
    document,
    window,
    alert: (message) => alerts.push(message),
    grist: {
      docApi: {
        fetchTable: async () => ({ id: [], Nom_de_projet: [] }),
        applyUserActions: async (actions) => {
          appliedActions.push(JSON.parse(JSON.stringify(actions)));
        },
      },
    },
    flatpickr: () => ({ open() {}, close() {}, destroy() {} }),
  });
  vm.runInContext(affichageSource, context, { filename: 'affichage.js' });
  vm.runInContext(contextMenuSource, context, { filename: 'contextMenu.js' });
  // La synchro du planning relit trois tables : ici on compte seulement ses appels.
  vm.runInContext(
    'globalThis.syncCalls = 0; syncPlanningProjetIndicesFromListeDePlan = async () => { globalThis.syncCalls += 1; };',
    context
  );

  const fire = (type, event) => {
    (documentListeners[type] || []).forEach((listener) => listener({
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
      ...event,
    }));
  };

  return {
    context,
    document,
    window,
    appliedActions,
    alerts,
    fire,
    run: (code) => vm.runInContext(code, context),
    get syncCalls() {
      return context.syncCalls;
    },
  };
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

const DOC_2 = { NumeroDocument: '3011', Designation: 'PBAS 1er SOUS-SOL - COF' };
const DOC_3 = { NumeroDocument: '3021', Designation: 'VOILES R+1 - COF' };

// Doc 3001 et 3011 ont leur ligne tête ; doc 3021 n'en a pas.
function sampleRows() {
  return [
    planRow({ id: 1 }),
    planRow({ id: 11, Indice: '0', DateDiffusion: '2025-11-27' }),
    planRow({ id: 12, Indice: 'A', DateDiffusion: '2026-02-20' }),
    planRow({ id: 2, ...DOC_2 }),
    planRow({ id: 21, ...DOC_2, Indice: '0', DateDiffusion: '2025-12-04' }),
    planRow({ id: 31, ...DOC_3, Indice: '0', DateDiffusion: '2025-12-10' }),
    planRow({ id: 32, ...DOC_3, Indice: 'A', DateDiffusion: '2026-03-02' }),
  ];
}

function render(page, rows) {
  page.window.records = rows;
  const container = new FakeElement('div');
  container.id = 'plans-output';
  page.document.body.appendChild(container);
  page.run('renderPlanTableSection')(container, rows, "ERA QUAI D'ORSAY", null);
  const headers = container.querySelectorAll('th').map((th) => th.textContent);
  const bodyRows = container.querySelectorAll('tbody')[0].children;
  const byNumber = (number) => bodyRows.find((tr) => tr.cells[0].textContent === number);
  return {
    cell(number, header) {
      const columnIndex = headers.indexOf(header);
      assert.notEqual(columnIndex, -1, `colonne « ${header} » absente : ${headers.join(' | ')}`);
      const tr = byNumber(number);
      assert.ok(tr, `document ${number} absent`);
      return tr.cells[columnIndex];
    },
  };
}

function menuItems(page) {
  const menu = page.document.getElementById('customContextMenu');
  return menu ? menu.children : [];
}

// --- Les actions envoyées à Grist ---

test('supprimer plusieurs dates retire leurs lignes de ListePlan', () => {
  const page = loadPage();
  const rows = sampleRows();
  const table = render(page, rows);

  const actions = page.run('buildDateCellsDeletionActions')([
    table.cell('3001', '0'),
    table.cell('3001', 'A'),
    table.cell('3011', '0'),
  ], rows);

  assert.deepEqual(JSON.parse(JSON.stringify(actions)), [
    ['RemoveRecord', 'ListePlan_NDC_COF', 11],
    ['RemoveRecord', 'ListePlan_NDC_COF', 12],
    ['RemoveRecord', 'ListePlan_NDC_COF', 21],
  ]);
});

test('les cases vides de la sélection sont ignorées', () => {
  const page = loadPage();
  const rows = sampleRows();
  const table = render(page, rows);

  const actions = page.run('buildDateCellsDeletionActions')([
    table.cell('3001', '0 Prev'),
    table.cell('3011', 'A'),
  ], rows);

  assert.deepEqual(JSON.parse(JSON.stringify(actions)), []);
});

test('une case avec plusieurs dates pour le même indice supprime toutes ses lignes', () => {
  const page = loadPage();
  const rows = [
    planRow({ id: 1 }),
    planRow({ id: 11, Indice: '0', DateDiffusion: '2025-11-27' }),
    planRow({ id: 13, Indice: '0', DateDiffusion: '2025-11-30' }),
    planRow({ id: 2, ...DOC_2 }),
    planRow({ id: 21, ...DOC_2, Indice: '0', DateDiffusion: '2025-12-04' }),
  ];
  const table = render(page, rows);

  const actions = page.run('buildDateCellsDeletionActions')([
    table.cell('3001', '0'),
    table.cell('3011', '0'),
  ], rows);

  assert.deepEqual(JSON.parse(JSON.stringify(actions)), [
    ['RemoveRecord', 'ListePlan_NDC_COF', 11],
    ['RemoveRecord', 'ListePlan_NDC_COF', 13],
    ['RemoveRecord', 'ListePlan_NDC_COF', 21],
  ]);
});

test('un document sans ligne tête dont on supprime toutes les dates garde une ligne vide', () => {
  const page = loadPage();
  const rows = sampleRows();
  const table = render(page, rows);

  const actions = page.run('buildDateCellsDeletionActions')([
    table.cell('3021', '0'),
    table.cell('3021', 'A'),
  ], rows);

  assert.deepEqual(JSON.parse(JSON.stringify(actions)), [
    ['UpdateRecord', 'ListePlan_NDC_COF', 31, { Indice: null, DateDiffusion: null }],
    ['RemoveRecord', 'ListePlan_NDC_COF', 32],
  ]);
});

// --- Quelles cases le clic droit vise ---

test('pendant Ctrl, le clic droit sur une case sélectionnée vise toute la sélection', () => {
  const page = loadPage();
  const table = render(page, sampleRows());
  const first = table.cell('3001', '0');
  const second = table.cell('3011', '0');
  page.run('toggleDateCtrlSelection')(first);
  page.run('toggleDateCtrlSelection')(second);

  const selection = page.run('getDateBulkSelectionForCell')(first);

  assert.deepEqual([...selection], [first, second]);
});

test('le clic droit sur une case hors de la sélection ne vise pas la sélection', () => {
  const page = loadPage();
  const table = render(page, sampleRows());
  page.run('toggleDateCtrlSelection')(table.cell('3001', '0'));
  page.run('toggleDateCtrlSelection')(table.cell('3011', '0'));

  const selection = page.run('getDateBulkSelectionForCell')(table.cell('3021', '0'));

  assert.deepEqual([...selection], []);
});

test('une seule case sélectionnée ne déclenche pas la suppression groupée', () => {
  const page = loadPage();
  const table = render(page, sampleRows());
  const only = table.cell('3001', '0');
  page.run('toggleDateCtrlSelection')(only);

  assert.deepEqual([...page.run('getDateBulkSelectionForCell')(only)], []);
});

test('Ctrl relâché, les cases du calendrier « Remplir » restent visées par le clic droit', () => {
  const page = loadPage();
  const table = render(page, sampleRows());
  const cells = [table.cell('3001', '0'), table.cell('3011', '0')];
  page.run('ouvrirPickerRemplirCellules')(cells, cells[1]);

  assert.deepEqual([...page.run('getDateBulkSelectionForCell')(cells[1])], cells);
});

// --- Le menu clic droit ---

test('le clic droit sur une case sélectionnée propose « Supprimer les dates » avec le nombre de cases datées', () => {
  const page = loadPage();
  const table = render(page, sampleRows());
  const cells = [table.cell('3001', '0'), table.cell('3011', '0'), table.cell('3011', 'A')];
  cells.forEach((cell) => page.run('toggleDateCtrlSelection')(cell));

  page.fire('contextmenu', { target: cells[0], ctrlKey: true, pageX: 0, pageY: 0 });

  assert.deepEqual(menuItems(page).map((item) => item.textContent), ['Supprimer les dates (2 cases)']);
});

test('le clic droit sur une case seule garde le menu habituel', () => {
  const page = loadPage();
  const table = render(page, sampleRows());

  page.fire('contextmenu', { target: table.cell('3001', '0'), pageX: 0, pageY: 0 });

  assert.deepEqual(menuItems(page).map((item) => item.textContent), ['Supprimer']);
});

test('« Supprimer les dates » envoie une seule transaction, synchronise le planning et efface la sélection', async () => {
  const page = loadPage();
  const table = render(page, sampleRows());
  const cells = [table.cell('3001', '0'), table.cell('3011', '0')];
  page.run('ouvrirPickerRemplirCellules')(cells, cells[1]);

  page.fire('contextmenu', { target: cells[0], pageX: 0, pageY: 0 });
  const [deleteItem] = menuItems(page);
  for (const listener of deleteItem.listeners.click) await listener({ stopPropagation() {} });

  assert.deepEqual(page.appliedActions, [[
    ['RemoveRecord', 'ListePlan_NDC_COF', 11],
    ['RemoveRecord', 'ListePlan_NDC_COF', 21],
  ]]);
  assert.equal(page.syncCalls, 1);
  assert.deepEqual(page.alerts, []);
  assert.equal(page.document.getElementById('date-drag-fill-popup'), null);
  assert.equal(page.document.getElementById('customContextMenu'), null);
  assert.deepEqual(page.document.querySelectorAll('td.plan-date-drag-selected'), []);
  assert.equal(cells[0].textContent, '');
  assert.equal(cells[0].dataset.recordId, undefined);
});

test('relâcher Ctrl pendant que le menu clic droit est ouvert n’ouvre pas le calendrier', () => {
  const page = loadPage();
  const table = render(page, sampleRows());
  const cells = [table.cell('3001', '0'), table.cell('3011', '0')];
  cells.forEach((cell) => page.run('toggleDateCtrlSelection')(cell));

  page.fire('contextmenu', { target: cells[0], ctrlKey: true, pageX: 0, pageY: 0 });
  page.fire('keyup', { key: 'Control' });

  assert.equal(page.document.getElementById('date-drag-fill-popup'), null);
  assert.ok(page.document.getElementById('customContextMenu'), 'le menu clic droit a disparu');
});
