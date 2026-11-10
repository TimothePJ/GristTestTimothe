// Alertes « N jour(s) de retard » de gestion-depenses2 : même décompte que la colonne
// Retards de Planning Projet (jours ouvrés, module partagé planningRetard.js), sinon le
// nombre calendaire, plus grand, l'emportait toujours sur le retard enregistré.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { countPlanningLateWorkingDays } from "../assets/js/utils/planningRetard.js";

const mainSource = fs.readFileSync(new URL("../assets/js/main.js", import.meta.url), "utf8");

function extractFunction(name) {
  const start = mainSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} introuvable dans main.js`);
  // Le corps commence après la liste des paramètres (qui peut contenir « = {} »).
  let depth = 0;
  for (let index = mainSource.indexOf(") {", start) + 2; index < mainSource.length; index += 1) {
    if (mainSource[index] === "{") depth += 1;
    else if (mainSource[index] === "}" && --depth === 0) return mainSource.slice(start, index + 1);
  }
  throw new Error(`fin de ${name} introuvable`);
}

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const buildPlanningDelayAlerts = new Function(
  "toFiniteNumber",
  "countPlanningLateWorkingDays",
  [
    extractFunction("formatPlanningAlertDate"),
    extractFunction("getPlanningAlertEndDate"),
    extractFunction("buildPlanningDelayAlerts"),
    "return buildPlanningDelayAlerts;",
  ].join("\n")
)(toFiniteNumber, countPlanningLateWorkingDays);

test("main.js prend le décompte du retard dans le module partagé", () => {
  assert.match(
    mainSource,
    /import\s*\{[^}]*\bcountPlanningLateWorkingDays\b[^}]*\}\s*from\s*"\.\/utils\/planningRetard\.js"/
  );
});

test("alerte de retard : jours ouvrés depuis la fin prévue, pas jours calendaires", () => {
  const endAt = new Date(2020, 0, 3); // vendredi 03/01/2020
  const [alert] = buildPlanningDelayAlerts({
    planningTasks: [{ name: "Voile R+1", realisationPct: 50, retardsDays: 0, endAt }],
  });
  const calendarDays = Math.round((new Date().setHours(0, 0, 0, 0) - endAt.getTime()) / 86400000);
  assert.equal(alert.days, countPlanningLateWorkingDays(endAt, new Date()));
  assert.ok(alert.days < calendarDays, "week-ends et jours fériés exclus");
});

test("alerte de retard : un document réalisé n'en a pas", () => {
  const alerts = buildPlanningDelayAlerts({
    planningTasks: [{ name: "Voile R+1", realisationPct: 100, retardsDays: 4, endAt: new Date(2020, 0, 3) }],
  });
  assert.deepEqual(alerts, []);
});
