// Contrôles de cohérence de la vue Global : retards de la Synthèse par rapport à Structure,
// fond de plan à mettre à jour, coffrage introuvable, retard des documents Structure.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addCounts,
  checkDocument,
  checkFloor,
  countAlerts,
  daysBetween,
  describeCounts,
  emptyCounts,
  floorAlerts,
  floorState,
  formworkState,
  hasAlerts,
  levelState,
  summaryState,
  taskState,
} from "../assets/js/services/globalChecks.js";

const day = (year, month, date) => new Date(year, month - 1, date);
const TODAY = day(2026, 10, 9);

// Étage RDC lié au coffrage 3032, dont le plan commence le mercredi 19/08/26.
const LIMIT = day(2026, 8, 19);
const linked = (state = "current", extra = {}) => ({
  state,
  formworkNumber: "3032",
  formwork: { number: "3032", issueDate: day(2025, 11, 27) },
  ...extra,
});
const controlTask = (end) => ({ id: 1, name: "PLAN DE SYNTHESE RESEAUX NIV RDC", natureKey: "", start: day(2026, 2, 13), end });
const kickoff = (start) => ({ id: 9, name: "DEMARRAGE GO RDC", natureKey: "demarrage", start, end: start });
const controls = new Map([[1, { chosen: true }]]);
const limits = new Map([[1, { limit: LIMIT, formworkNumber: "3032" }]]);
const texts = (state) => state.parts.map((part) => part.text);

test("jours calendaires entre deux dates, changement d'heure compris", () => {
  assert.equal(daysBetween(LIMIT, day(2026, 11, 30)), 103);
  assert.equal(daysBetween(day(2026, 10, 24), day(2026, 10, 26)), 2, "nuit du passage à l'heure d'hiver");
  assert.equal(daysBetween(day(2026, 3, 28), day(2026, 3, 30)), 2, "nuit du passage à l'heure d'été");
  assert.equal(daysBetween(day(2026, 8, 20), LIMIT), -1);
  assert.equal(daysBetween(null, LIMIT), 0);
});

test("document Structure non terminé : retard compté depuis sa Fin jusqu'à aujourd'hui", () => {
  const late = checkDocument({ realise: 67, end: day(2026, 9, 16), storedRetard: 5, remarque: "" }, TODAY);
  assert.deepEqual(late.part, { text: "retard 23 j", tone: "error" });
  assert.equal(late.alert.family, "structure");
  assert.equal(late.alert.days, 23);
  assert.equal(late.title, "Fin prévue le Mer 16/09/26 : 23 j de retard.");
  assert.equal(checkDocument({ realise: 0, end: TODAY }, TODAY).alert, null, "Fin aujourd'hui : pas de retard");
  assert.equal(checkDocument({ realise: 0, end: day(2026, 12, 1) }, TODAY).part, null);
  assert.equal(checkDocument({ realise: 0, end: null, storedRetard: 12 }, TODAY).part, null, "sans Fin : rien");
});

test("retard justifié : orange, la justification au survol, et il compte toujours", () => {
  const result = checkDocument({ realise: 33, end: day(2026, 9, 16), remarque: " Attente plans archi " }, TODAY);
  assert.deepEqual(result.part, { text: "retard 23 j (justifié)", tone: "warn" });
  assert.equal(result.title, "Retard justifié : Attente plans archi");
  assert.equal(result.alert.family, "structure");
});

test("document terminé : le retard stocké reste lisible, sans alerte", () => {
  const done = checkDocument({ realise: 100, end: day(2026, 6, 10), storedRetard: 8 }, TODAY);
  assert.deepEqual(done, { alert: null, part: { text: "terminé (retard 8 j)", tone: "muted" }, title: "" });
  assert.equal(checkDocument({ realise: 100, end: day(2026, 6, 10), storedRetard: 0 }, TODAY).part.text, "terminé");
});

test("étage non lié ou au coffrage introuvable : aucun des trois contrôles", () => {
  const none = checkFloor({ tasks: [controlTask(day(2026, 11, 30))], link: { state: "none" }, controls, limits });
  assert.deepEqual([none.linked, none.alerts.length, none.taskAlerts.size, none.passed], [false, 0, 0, 0]);
  assert.equal(checkFloor().linked, false);
  const missing = checkFloor({ tasks: [controlTask(day(2026, 11, 30))], link: linked("missing", { formwork: null }), controls, limits });
  assert.equal(missing.linked, false);
  assert.deepEqual(missing.alerts.map((alert) => [alert.code, alert.tone, alert.text]), [
    ["missing", "error", "coffrage 3032 introuvable"],
  ]);
  assert.equal(missing.taskAlerts.size, 0);
});

test("tâche contrôlée qui finit après le début du plan de coffrage : retard Synthèse", () => {
  const check = checkFloor({ tasks: [controlTask(day(2026, 11, 30))], link: linked(), controls, limits, worksStart: null });
  const [alert] = check.taskAlerts.get(1);
  assert.deepEqual(alert, {
    code: "late",
    family: "synthese",
    tone: "late",
    days: 103,
    text: "retard 103 j",
    title: "Fin trop tardive : à finir au plus tard le Mer 19/08/26 (début du plan de coffrage 3032 dans le planning Structure).",
  }, "pas de clignotement porté par l'alerte : seule la Fin de la tâche clignote");
  assert.equal(check.linked, true);
});

test("tâche contrôlée qui finit le jour du début du plan : contrôle passé", () => {
  const check = checkFloor({ tasks: [controlTask(LIMIT)], link: linked(), controls, limits, worksStart: null });
  assert.equal(check.taskAlerts.size, 0);
  assert.equal(check.passed, 2, "tâche contrôlée et fond de plan");
});

test("plusieurs tâches contrôlées : une seule en retard suffit à faire échouer le contrôle", () => {
  const second = { id: 2, name: "VISA Indice A", natureKey: "", start: day(2026, 2, 1), end: day(2026, 3, 1) };
  const check = checkFloor({
    tasks: [controlTask(day(2026, 8, 20)), second],
    link: linked(),
    controls: new Map([[1, {}], [2, {}]]),
    limits: new Map([[1, { limit: LIMIT, formworkNumber: "3032" }], [2, { limit: LIMIT, formworkNumber: "3032" }]]),
  });
  assert.deepEqual([...check.taskAlerts.keys()], [1]);
  assert.equal(check.taskAlerts.get(1)[0].days, 1);
  assert.equal(check.passed, 1, "seul le fond de plan passe");
});

test("tâche contrôlée non vérifiable : aucune, sans Fin, coffrage sans début", () => {
  const reasons = (options) => checkFloor({ link: linked(), worksStart: null, ...options }).unverifiable;
  assert.ok(reasons({ tasks: [] }).includes("pas de tâche contrôlée dans l'étage"));
  assert.ok(reasons({ tasks: [controlTask(null)], controls, limits })
    .includes("la tâche contrôlée « PLAN DE SYNTHESE RESEAUX NIV RDC » n'a pas de date de fin"));
  assert.ok(reasons({ tasks: [controlTask(day(2026, 11, 30))], controls, limits: new Map() })
    .includes("le coffrage 3032 n'a pas de date de début"));
});

test("jalon de démarrage après le démarrage des travaux de Structure : retard Synthèse", () => {
  const works = day(2026, 10, 14);
  const late = checkFloor({ tasks: [kickoff(day(2026, 10, 26))], link: linked(), worksStart: works });
  const [alert] = late.taskAlerts.get(9);
  assert.deepEqual([alert.code, alert.family, alert.tone, alert.days, alert.text], ["goLate", "synthese", "late", 12, "retard 12 j"]);
  assert.equal(alert.title, "Démarrage prévu après le démarrage des travaux de Structure (Mer 14/10/26).");
  const onTime = checkFloor({ tasks: [kickoff(works)], link: linked(), worksStart: works });
  assert.equal(onTime.taskAlerts.size, 0);
  assert.equal(onTime.passed, 2, "démarrage et fond de plan");
});

test("démarrage non vérifiable : pas de jalon daté, ou pas de démarrage des travaux", () => {
  const noKickoff = checkFloor({ tasks: [kickoff(null)], link: linked(), worksStart: day(2026, 10, 14) });
  assert.ok(noKickoff.unverifiable.includes("pas de jalon de démarrage daté dans l'étage"));
  const noWorks = checkFloor({ tasks: [kickoff(day(2026, 10, 26))], link: linked(), worksStart: null });
  assert.ok(noWorks.unverifiable.includes("aucun démarrage des travaux pour le coffrage 3032"));
  assert.equal(noWorks.taskAlerts.size, 0);
});

test("fond de plan : à mettre à jour, sans fond de plan, sans 0 Prev, à jour", () => {
  const stale = checkFloor({ link: linked("stale") });
  assert.deepEqual(stale.alerts.map((alert) => [alert.code, alert.family, alert.tone, alert.text]), [
    ["stale", "stale", "warn", "à mettre à jour : 0 Prev le Jeu 27/11/25"],
  ]);
  assert.equal(
    stale.alerts[0].title,
    "Le fond de plan de synthèse ne démarre pas à la date 0 Prev du coffrage 3032 (Jeu 27/11/25).",
  );
  assert.ok(checkFloor({ link: linked("noPlan") }).unverifiable.includes("pas de tâche « FOND DE PLAN DE SYNTHESE » dans l'étage"));
  assert.ok(checkFloor({ link: linked("waiting") }).unverifiable.includes("le coffrage 3032 n'a pas de date 0 Prev"));
  const current = checkFloor({ link: linked("current") });
  assert.equal(current.alerts.length, 0);
  assert.equal(current.passed, 1);
});

test("compteurs : par famille, cumulables", () => {
  const check = checkFloor({
    tasks: [controlTask(day(2026, 11, 30)), kickoff(day(2026, 10, 26))],
    link: linked("stale"),
    controls,
    limits,
    worksStart: day(2026, 10, 14),
  });
  const counts = countAlerts(floorAlerts(check));
  assert.deepEqual(counts, { synthese: 2, missing: 0, stale: 1, structure: 0 });
  assert.deepEqual(addCounts(emptyCounts(), counts), counts);
  assert.equal(hasAlerts(counts), true);
  assert.equal(hasAlerts(emptyCounts()), false);
});

test("état d'une tâche en retard : son plus grand retard, les explications au survol", () => {
  assert.equal(taskState([]), null);
  const state = taskState([
    { days: 12, title: "Démarrage tardif." },
    { days: 103, title: "Fin trop tardive." },
  ]);
  assert.deepEqual(state.parts, [{ text: "retard 103 j", tone: "late" }]);
  assert.equal(state.title, "Démarrage tardif.\nFin trop tardive.");
});

test("résumé d'un contenu : une part par famille, la plus grave d'abord, accordée", () => {
  assert.equal(summaryState(emptyCounts()), null);
  const state = summaryState({ synthese: 1, missing: 2, stale: 1, structure: 3 });
  assert.deepEqual(state.parts, [
    { text: "1 retard Synthèse", tone: "late" },
    { text: "2 coffrages introuvables", tone: "error" },
    { text: "1 à mettre à jour", tone: "warn" },
    { text: "3 retards Structure", tone: "error" },
  ]);
  assert.deepEqual(texts(summaryState({ synthese: 2, missing: 1, stale: 0, structure: 1 })), [
    "2 retards Synthèse", "1 coffrage introuvable", "1 retard Structure",
  ]);
});

test("état d'un étage : non lié, introuvable, à mettre à jour, retards de son contenu", () => {
  assert.deepEqual(floorState({ link: { state: "none" } }).parts, [
    { text: "non lié à un coffrage", tone: "muted" },
  ]);
  const missing = checkFloor({ link: linked("missing", { formwork: null }) });
  assert.deepEqual(texts(floorState({ check: missing, link: linked("missing"), counts: emptyCounts() })), ["coffrage 3032 introuvable"]);
  const check = checkFloor({ tasks: [controlTask(day(2026, 11, 30))], link: linked("stale"), controls, limits });
  const state = floorState({ check, link: linked("stale"), counts: countAlerts(floorAlerts(check)) });
  assert.deepEqual(state.parts, [
    { text: "1 retard Synthèse", tone: "late" },
    { text: "à mettre à jour : 0 Prev le Jeu 27/11/25", tone: "warn" },
  ]);
  assert.match(state.title, /Fin trop tardive/);
  assert.match(state.title, /Non vérifiable : pas de jalon de démarrage daté dans l'étage\./);
  const fine = checkFloor({ tasks: [controlTask(LIMIT)], link: linked(), controls, limits });
  assert.equal(floorState({ check: fine, link: linked(), counts: emptyCounts() }), null, "étage lié sans alerte : rien");
});

test("étage lié à un coffrage d'une autre zone : son état le dit", () => {
  const check = checkFloor({ tasks: [controlTask(LIMIT)], link: linked(), controls, limits });
  const state = floorState({ check, link: linked(), counts: emptyCounts(), otherZoneLabel: "Zone 2 / BAT B" });
  assert.deepEqual(state.parts, [{ text: "lié au coffrage 3032 (Zone 2 / BAT B)", tone: "muted" }]);
});

test("état d'un niveau lié : cohérent, partiel, non vérifiable, en défaut", () => {
  const works = day(2026, 10, 14);
  const all = checkFloor({ tasks: [controlTask(LIMIT), kickoff(works)], link: linked(), controls, limits, worksStart: works });
  assert.deepEqual(levelState({ checks: [all] }).parts, [{ text: "✓ cohérent", tone: "ok" }]);

  const partial = checkFloor({ tasks: [controlTask(LIMIT)], link: linked("waiting"), controls, limits });
  const partialState = levelState({ checks: [partial] });
  assert.deepEqual(partialState.parts, [{ text: "✓ cohérent (2 contrôles non vérifiables)", tone: "muted" }]);
  assert.match(partialState.title, /Non vérifiable : le coffrage 3032 n'a pas de date 0 Prev\./);

  const nothing = checkFloor({ tasks: [], link: linked("waiting") });
  assert.deepEqual(texts(levelState({ checks: [nothing] })), ["non vérifiable"]);

  const late = checkFloor({ tasks: [controlTask(day(2026, 11, 30))], link: linked("stale"), controls, limits });
  const lateState = levelState({ checks: [late, all], counts: { synthese: 1, missing: 0, stale: 1, structure: 2 } });
  assert.deepEqual(lateState.parts, [
    { text: "Synthèse en retard de 103 j", tone: "late" },
    { text: "à mettre à jour", tone: "warn" },
    { text: "2 retards Structure", tone: "error" },
  ]);
  assert.deepEqual(texts(levelState({ checks: [all], counts: { synthese: 0, missing: 0, stale: 0, structure: 1 } })), [
    "✓ cohérent", "1 retard Structure",
  ]);
});

test("état d'un coffrage : le sien, puis ses armatures en retard", () => {
  assert.equal(formworkState({ own: checkDocument({ realise: 0, end: null }, TODAY), lateRebars: 0 }), null);
  const own = checkDocument({ realise: 67, end: day(2026, 9, 2) }, TODAY);
  assert.deepEqual(texts(formworkState({ own, lateRebars: 2 })), ["retard 37 j", "2 armatures en retard"]);
  assert.deepEqual(texts(formworkState({ own: null, lateRebars: 1 })), ["1 armature en retard"]);
});

test("barre d'état : compteurs accordés, coffrage introuvable seulement s'il y en a", () => {
  assert.equal(
    describeCounts({ linkedFloors: 3, unlinkedFloors: 2, synthese: 1, stale: 0, structure: 12, missing: 0 }),
    "3 étages liés · 2 non liés · 1 retard Synthèse · 0 à mettre à jour · 12 retards Structure"
  );
  assert.equal(
    describeCounts({ linkedFloors: 1, unlinkedFloors: 1, synthese: 2, stale: 1, structure: 1, missing: 1 }),
    "1 étage lié · 1 non lié · 2 retards Synthèse · 1 à mettre à jour · 1 retard Structure · 1 coffrage introuvable"
  );
  assert.equal(describeCounts(), "0 étage lié · 0 non lié · 0 retard Synthèse · 0 à mettre à jour · 0 retard Structure");
});
