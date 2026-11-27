// Mémoire des sections repliées : propre à chaque planning, gardée dans le navigateur.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(
  path.join(__dirname, "..", "assets", "js", "outlineState.js")
).href;

async function createStore(storage) {
  const { createOutlineStateStore } = await import(moduleUrl);
  return createOutlineStateStore(storage);
}

// Même contrat que localStorage, en mémoire.
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function brokenStorage() {
  const refuse = () => { throw new Error("stockage refusé"); };
  return { getItem: refuse, setItem: refuse };
}

test("un planning jamais touché n'a aucune section repliée", async () => {
  const store = await createStore(memoryStorage());

  assert.deepEqual(store.getCollapsedIds("Planning A"), []);
});

test("un premier clic replie la section, un second la déplie", async () => {
  const store = await createStore(memoryStorage());

  store.toggle("Planning A", "12");
  assert.deepEqual(store.getCollapsedIds("Planning A"), ["12"]);

  store.toggle("Planning A", "12");
  assert.deepEqual(store.getCollapsedIds("Planning A"), []);
});

test("chaque planning garde ses propres sections repliées", async () => {
  const store = await createStore(memoryStorage());

  store.toggle("Planning A", "12");
  store.toggle("Planning B", "7");

  assert.deepEqual(store.getCollapsedIds("Planning A"), ["12"]);
  assert.deepEqual(store.getCollapsedIds("Planning B"), ["7"]);
});

test("les sections repliées sont retrouvées après rechargement de la page", async () => {
  const storage = memoryStorage();
  const beforeReload = await createStore(storage);
  beforeReload.toggle("Planning A", "12");
  beforeReload.toggle("Planning A", "30");

  const afterReload = await createStore(storage);

  assert.deepEqual(afterReload.getCollapsedIds("Planning A"), ["12", "30"]);
});

test("sans stockage utilisable, le repli fonctionne le temps de la session", async () => {
  for (const storage of [brokenStorage(), null]) {
    const store = await createStore(storage);

    store.toggle("Planning A", "12");

    assert.deepEqual(store.getCollapsedIds("Planning A"), ["12"]);
  }
});

// Un affichage qui oublierait les sections repliées les rouvrirait toutes : après une
// édition de date ou un rechargement des données, par exemple.
test("chaque affichage du planning tient compte des sections repliées", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "assets", "js", "main.js"),
    "utf8"
  );
  const directCalls = source.match(/buildTimelineDataFromMsProjectRows\(/g) || [];

  assert.equal(directCalls.length, 1, "un seul appel direct, celui qui passe les sections repliées");
  assert.match(
    source,
    /buildTimelineDataFromMsProjectRows\([^;]*collapsedIds:\s*outlineState\.getCollapsedIds\(/
  );
});

test("une valeur enregistrée illisible revient à tout déplié", async () => {
  const { OUTLINE_STORAGE_KEY_PREFIX } = await import(moduleUrl);

  for (const stored of ["pas du JSON", "{\"12\":true}", "null"]) {
    const store = await createStore(
      memoryStorage({ [`${OUTLINE_STORAGE_KEY_PREFIX}Planning A`]: stored })
    );

    assert.deepEqual(store.getCollapsedIds("Planning A"), [], stored);
  }
});
