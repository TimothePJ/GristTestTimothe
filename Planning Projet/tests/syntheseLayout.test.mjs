import test from "node:test";
import assert from "node:assert/strict";

import {
  LAYOUT_FLOOR,
  LAYOUT_ZONE,
  LAYOUT_MODE_VALUES,
  buildLayoutModeActions,
  hasLayoutModeColumn,
  layoutForProject,
  parseLayoutMode,
  withLayoutMode,
} from "../assets/js/services/syntheseLayout.js";

test("parseLayoutMode : les écritures de « Étage » donnent floor", () => {
  for (const value of ["Étage", "Par étage", "ETAGE", " etage ", "par-étage"]) {
    assert.equal(parseLayoutMode(value), LAYOUT_FLOOR, value);
  }
});

test("parseLayoutMode : tout le reste donne zone", () => {
  for (const value of ["Zone", "", undefined, null, "Étages", "etage 2"]) {
    assert.equal(parseLayoutMode(value), LAYOUT_ZONE, String(value));
  }
});

test("layoutForProject : la première valeur non vide décide", () => {
  const configs = [
    { projectId: "7", projectNumber: "262021", modeRaw: "" },
    { projectId: "3", projectNumber: "262021", modeRaw: "Étage" },
  ];
  assert.equal(layoutForProject(configs, { number: "262021", ids: [3, 7] }), LAYOUT_FLOOR);
});

test("layoutForProject : ordre par id numérique croissant", () => {
  const configs = [
    { projectId: "9", projectNumber: "1", modeRaw: "Zone" },
    { projectId: "4", projectNumber: "1", modeRaw: "Étage" },
  ];
  assert.equal(layoutForProject(configs, { number: "1", ids: [4, 9] }), LAYOUT_FLOOR);
});

test("layoutForProject : colonne absente, projet nul ou autre projet donnent zone", () => {
  assert.equal(
    layoutForProject([{ projectId: "3", projectNumber: "262021" }], { number: "262021", ids: [3] }),
    LAYOUT_ZONE
  );
  assert.equal(layoutForProject([{ projectId: "3", projectNumber: "1", modeRaw: "Étage" }], null), LAYOUT_ZONE);
  assert.equal(
    layoutForProject([{ projectId: "5", projectNumber: "2", modeRaw: "Étage" }], { number: "1", ids: [3] }),
    LAYOUT_ZONE
  );
});

test("layoutForProject : rattachement par numéro seul, ou par id seul", () => {
  const configs = [{ projectId: "5", projectNumber: "262021", modeRaw: "Étage" }];
  assert.equal(layoutForProject(configs, { number: "262021", ids: [] }), LAYOUT_FLOOR);
  assert.equal(layoutForProject([{ projectId: "5", projectNumber: "", modeRaw: "Étage" }], { id: 5 }), LAYOUT_FLOOR);
});

// --- Bouton « Par étage » : écriture du mode ---

const TARGET = { table: "Projets2", column: "Mode" };
const cfg = (projectId, projectNumber, modeRaw) => ({ projectId, projectNumber, projectName: "P", avancementConfigRaw: "", modeRaw });
const PROJECT = { id: "3", ids: ["3", "12"], number: "N1", name: "P", names: ["P"] };

test("LAYOUT_MODE_VALUES : valeurs écrites, relues à l'identique", () => {
  assert.equal(LAYOUT_MODE_VALUES.floor, "Étage");
  assert.equal(LAYOUT_MODE_VALUES.zone, "Zone");
  assert.equal(parseLayoutMode(LAYOUT_MODE_VALUES.floor), LAYOUT_FLOOR);
  assert.equal(parseLayoutMode(LAYOUT_MODE_VALUES.zone), LAYOUT_ZONE);
});

test("hasLayoutModeColumn : vrai dès qu'une ligne du projet porte la colonne", () => {
  assert.equal(hasLayoutModeColumn([cfg("3", "N1", undefined)], PROJECT), false);
  assert.equal(hasLayoutModeColumn([cfg("3", "N1", "")], PROJECT), true);
  assert.equal(hasLayoutModeColumn([cfg("3", "N1", null)], PROJECT), true);
  assert.equal(hasLayoutModeColumn([cfg("99", "AUTRE", "Étage")], PROJECT), false);
  assert.equal(hasLayoutModeColumn([cfg("3", "N1", "Étage")], null), false);
  assert.equal(hasLayoutModeColumn(null, PROJECT), false);
});

test("buildLayoutModeActions : une ligne, une action UpdateRecord", () => {
  assert.deepEqual(
    buildLayoutModeActions([cfg("3", "N1", "")], PROJECT, LAYOUT_FLOOR, TARGET),
    [["UpdateRecord", "Projets2", 3, { Mode: "Étage" }]],
  );
});

test("buildLayoutModeActions : plusieurs lignes, une action BulkUpdateRecord aux ids croissants", () => {
  const project = { id: "12", ids: ["12"], number: "N1" };
  const configs = [cfg("12", "N1", ""), cfg("3", "N1", ""), cfg("50", "AUTRE", "")];
  assert.deepEqual(
    buildLayoutModeActions(configs, project, LAYOUT_ZONE, TARGET),
    [["BulkUpdateRecord", "Projets2", [3, 12], { Mode: ["Zone", "Zone"] }]],
  );
});

test("buildLayoutModeActions : aucune ligne, aucune action", () => {
  assert.deepEqual(buildLayoutModeActions([cfg("99", "AUTRE", "")], PROJECT, LAYOUT_FLOOR, TARGET), []);
  assert.deepEqual(buildLayoutModeActions([], null, LAYOUT_FLOOR, TARGET), []);
});

test("withLayoutMode : copie où seules les lignes du projet changent, et le mode se relit", () => {
  const other = cfg("99", "AUTRE", "Étage");
  const configs = [cfg("3", "N1", ""), cfg("12", "N1", undefined), other];
  const snapshot = JSON.stringify(configs);
  const floor = withLayoutMode(configs, PROJECT, LAYOUT_FLOOR);
  assert.equal(JSON.stringify(configs), snapshot);
  assert.notEqual(floor, configs);
  assert.equal(floor[2], other);
  assert.equal(floor[0].modeRaw, "Étage");
  assert.equal(floor[1].modeRaw, "Étage");
  assert.equal(layoutForProject(floor, PROJECT), LAYOUT_FLOOR);
  assert.equal(layoutForProject(withLayoutMode(floor, PROJECT, LAYOUT_ZONE), PROJECT), LAYOUT_ZONE);
});
