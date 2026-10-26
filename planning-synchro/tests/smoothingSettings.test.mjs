import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getServiceSettings,
  hasAnyMax,
  serializeSmoothingCell,
  parseMaxInput,
} from "../assets/js/top/smoothingSettings.js";

const EMPTY = { maxTotal: null, maxByType: {} };
const MESSAGE = "Entrez un nombre entier supérieur ou égal à 1, ou laissez vide.";

// Espionne console.warn le temps d'un appel et renvoie le nombre d'avertissements.
function withWarnSpy(fn) {
  const original = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args);
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return calls;
}

const cell = (services) => JSON.stringify({ version: 1, services });

test("getServiceSettings : cellule vide, null, undefined -> réglages vides", () => {
  for (const raw of ["", null, undefined]) {
    assert.deepEqual(getServiceSettings(raw, "Structure"), EMPTY);
  }
});

test("getServiceSettings : lit l'entrée du service demandé et ignore les autres", () => {
  const raw = cell({
    Structure: { maxTotal: 4, maxParType: { COFFRAGE: 2, ARMATURES: 3 } },
    Autre: { maxTotal: 9, maxParType: { NDC: 1 } },
  });
  assert.deepEqual(getServiceSettings(raw, "Structure"), {
    maxTotal: 4,
    maxByType: { COFFRAGE: 2, ARMATURES: 3 },
  });
  assert.deepEqual(getServiceSettings(raw, "Inconnu"), EMPTY);
});

test("getServiceSettings : JSON cassé -> vide + un console.warn", () => {
  let result;
  const warns = withWarnSpy(() => {
    result = getServiceSettings("abc", "Structure");
  });
  assert.deepEqual(result, EMPTY);
  assert.equal(warns.length, 1);
});

test("getServiceSettings : 0, 2.5, -1 et la chaîne \"3\" sont ignorés", () => {
  const raw = cell({
    Structure: {
      maxTotal: 0,
      maxParType: { COFFRAGE: 2.5, ARMATURES: -1, NDC: "3", COUPES: 2 },
    },
  });
  let result;
  withWarnSpy(() => {
    result = getServiceSettings(raw, "Structure");
  });
  assert.deepEqual(result, { maxTotal: null, maxByType: { COUPES: 2 } });
});

test("getServiceSettings : clé de type inconnue ignorée", () => {
  const raw = cell({ Structure: { maxTotal: 2, maxParType: { BIDON: 1, COFFRAGE: 1 } } });
  let result;
  withWarnSpy(() => {
    result = getServiceSettings(raw, "Structure");
  });
  assert.deepEqual(result, { maxTotal: 2, maxByType: { COFFRAGE: 1 } });
});

test("hasAnyMax : vrai dès qu'un maximum existe", () => {
  assert.equal(hasAnyMax(EMPTY), false);
  assert.equal(hasAnyMax({ maxTotal: 3, maxByType: {} }), true);
  assert.equal(hasAnyMax({ maxTotal: null, maxByType: { NDC: 1 } }), true);
});

test("serializeSmoothingCell : ajoute l'entrée et conserve celle d'un autre service", () => {
  const raw = cell({ Autre: { maxTotal: 9, maxParType: { NDC: 1 } } });
  const out = JSON.parse(
    serializeSmoothingCell(raw, "Structure", { maxTotal: 4, maxByType: { COFFRAGE: 2 } })
  );
  assert.equal(out.version, 1);
  assert.deepEqual(out.services.Structure, { maxTotal: 4, maxParType: { COFFRAGE: 2 } });
  assert.deepEqual(out.services.Autre, { maxTotal: 9, maxParType: { NDC: 1 } });
});

test("serializeSmoothingCell : remplace l'entrée du service", () => {
  const raw = cell({ Structure: { maxTotal: 4, maxParType: { COFFRAGE: 2 } } });
  const out = JSON.parse(
    serializeSmoothingCell(raw, "Structure", { maxTotal: null, maxByType: { NDC: 1 } })
  );
  assert.deepEqual(out.services.Structure, { maxParType: { NDC: 1 } });
});

test("serializeSmoothingCell : réglage sans maximum retire l'entrée ; plus aucun service -> \"\"", () => {
  const two = cell({
    Structure: { maxTotal: 4, maxParType: {} },
    Autre: { maxTotal: 9, maxParType: {} },
  });
  const out = JSON.parse(serializeSmoothingCell(two, "Structure", EMPTY));
  assert.deepEqual(Object.keys(out.services), ["Autre"]);

  const one = cell({ Structure: { maxTotal: 4, maxParType: {} } });
  assert.equal(serializeSmoothingCell(one, "Structure", EMPTY), "");
  assert.equal(serializeSmoothingCell("", "Structure", EMPTY), "");
});

test("serializeSmoothingCell : cellule d'entrée illisible -> nouvelle cellule propre", () => {
  let text;
  withWarnSpy(() => {
    text = serializeSmoothingCell("abc", "Structure", { maxTotal: 2, maxByType: {} });
  });
  assert.deepEqual(JSON.parse(text), {
    version: 1,
    services: { Structure: { maxTotal: 2, maxParType: {} } },
  });
});

test("parseMaxInput : vide -> null ; entier >= 1 -> valeur", () => {
  assert.deepEqual(parseMaxInput(""), { ok: true, value: null });
  assert.deepEqual(parseMaxInput("  "), { ok: true, value: null });
  assert.deepEqual(parseMaxInput("3"), { ok: true, value: 3 });
  assert.deepEqual(parseMaxInput(" 12 "), { ok: true, value: 12 });
});

test("parseMaxInput : 0, 2,5, -1, x -> message exact", () => {
  for (const text of ["0", "2,5", "-1", "x"]) {
    assert.deepEqual(parseMaxInput(text), { ok: false, message: MESSAGE });
  }
});

// --- mois de départ et maximums d'un mois précis -----------------------------------

test("getServiceSettings : lit le mois de départ (« debut ») et les mois particuliers (« parMois »)", () => {
  const raw = cell({
    Structure: {
      maxTotal: 4,
      maxParType: { ARMATURES: 4 },
      debut: "2026-06",
      parMois: {
        "2027-03": { maxTotal: 6, maxParType: { ARMATURES: 6 } },
        "2027-08": { maxParType: { ARMATURES: 2 } },
      },
    },
  });
  assert.deepEqual(getServiceSettings(raw, "Structure"), {
    maxTotal: 4,
    maxByType: { ARMATURES: 4 },
    startMonth: "2026-06",
    maxByMonth: {
      "2027-03": { maxTotal: 6, maxByType: { ARMATURES: 6 } },
      "2027-08": { maxTotal: null, maxByType: { ARMATURES: 2 } },
    },
  });
});

test("getServiceSettings : mois de départ ou mois particulier invalides ignorés avec un console.warn", () => {
  const raw = cell({
    Structure: {
      maxTotal: 4,
      maxParType: {},
      debut: "juin",
      parMois: {
        "2027-13": { maxTotal: 2 },
        "2027-03": { maxTotal: 0, maxParType: { BIDON: 1, NDC: 2 } },
        "2027-04": "x",
        "2027-05": { maxTotal: 0 },
      },
    },
  });
  let result;
  const warns = withWarnSpy(() => {
    result = getServiceSettings(raw, "Structure");
  });
  assert.deepEqual(result, {
    maxTotal: 4,
    maxByType: {},
    maxByMonth: { "2027-03": { maxTotal: null, maxByType: { NDC: 2 } } },
  });
  assert.ok(warns.length >= 5, `${warns.length} avertissements`);
});

test("hasAnyMax : un maximum d'un mois précis suffit ; un mois de départ seul ne suffit pas", () => {
  assert.equal(
    hasAnyMax({ maxTotal: null, maxByType: {}, maxByMonth: { "2027-03": { maxTotal: null, maxByType: { NDC: 1 } } } }),
    true
  );
  assert.equal(hasAnyMax({ maxTotal: null, maxByType: {}, startMonth: "2026-06" }), false);
  assert.equal(
    hasAnyMax({ maxTotal: null, maxByType: {}, maxByMonth: { "2027-03": { maxTotal: null, maxByType: {} } } }),
    false
  );
});

test("serializeSmoothingCell : écrit le mois de départ et les mois particuliers, sans les mois vides", () => {
  const out = JSON.parse(
    serializeSmoothingCell("", "Structure", {
      maxTotal: 4,
      maxByType: {},
      startMonth: "2026-06",
      maxByMonth: {
        "2027-08": { maxTotal: null, maxByType: { ARMATURES: 2 } },
        "2027-03": { maxTotal: 6, maxByType: {} },
        "2027-05": { maxTotal: null, maxByType: {} },
      },
    })
  );
  assert.deepEqual(out.services.Structure, {
    maxTotal: 4,
    maxParType: {},
    debut: "2026-06",
    parMois: { "2027-03": { maxTotal: 6 }, "2027-08": { maxParType: { ARMATURES: 2 } } },
  });
});

test("serializeSmoothingCell puis getServiceSettings : aller-retour", () => {
  const settings = {
    maxTotal: null,
    maxByType: { COFFRAGE: 3 },
    startMonth: "2026-09",
    maxByMonth: { "2027-01": { maxTotal: 5, maxByType: { COFFRAGE: 1 } } },
  };
  assert.deepEqual(getServiceSettings(serializeSmoothingCell("", "Structure", settings), "Structure"), settings);
});

test("serializeSmoothingCell : sans mois de départ ni mois particulier, la cellule garde sa forme d'avant", () => {
  const out = JSON.parse(serializeSmoothingCell("", "Structure", { maxTotal: 4, maxByType: {}, maxByMonth: {} }));
  assert.deepEqual(out.services.Structure, { maxTotal: 4, maxParType: {} });
});
