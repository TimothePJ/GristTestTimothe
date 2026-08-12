import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainSource = fs.readFileSync(path.join(ROOT, "assets/js/main.js"), "utf8");
const tablesSource = fs.readFileSync(path.join(ROOT, "assets/js/ui/tables.js"), "utf8");
const expenseTimelineSource = fs.readFileSync(
  path.join(ROOT, "assets/js/ui/expenseTimeline.js"),
  "utf8"
);

test("Gestion - Equipe est toujours redessinee sur une mise a jour distante", () => {
  assert.match(
    tablesSource,
    /renderExpenseRateControls\(dom\.teamManagementRates, project\)/
  );
  assert.doesNotMatch(tablesSource, /skipRateControls|activeElement/);
  assert.doesNotMatch(mainSource, /teamRatesRenderPending|dailyRateInputFocused/);
});

test("un vrai brouillon de taux est restaure sans bloquer le rendu de l equipe", () => {
  assert.match(
    mainSource,
    /const rateDraft = captureDailyRateDraft\([\s\S]*?renderTables\([\s\S]*?restoreDailyRateDraft\(/
  );
  assert.match(mainSource, /activeInput\.value === persistedValue/);
  assert.match(mainSource, /activeInput\.dataset\.persistedRate/);
  assert.match(expenseTimelineSource, /data-persisted-rate=/);
});
