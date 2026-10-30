// Tableau de la vue Global : rendu des lignes et de leur état, Fin en retard, replis, barre
// d'état, séparateur — et rien qui permette de modifier.
import test from "node:test";
import assert from "node:assert/strict";

import {
  COLUMNS,
  DEFAULT_LEFT_WIDTH,
  MIN_LEFT_WIDTH,
  buildLineElement,
  buildStateCell,
  createGlobalPlanningTable,
} from "../assets/js/ui/globalPlanningTable.js";
import { FakeElement, createFakeEnvironment, dispatch } from "./helpers/fakeDom.mjs";

const day = (year, month, date) => new Date(year, month - 1, date);

// Descendants portant une classe, dans l'ordre du document.
function all(node, className) {
  const found = [];
  const visit = (element) => {
    if (element.classes?.has(className)) found.push(element);
    element.children.forEach(visit);
  };
  visit(node);
  return found;
}
const one = (node, className) => all(node, className)[0];
const cellText = (element, field) => one(element, `stt-cell--${field}`).textContent;

function line(fields = {}) {
  return {
    key: "task:420", kind: "task", role: "task", service: "synthese", level: 5, name: "PLAN DE SYNTHESE RESEAUX NIV RDC",
    id2: "", indice: "", durationLabel: "198 jours", start: day(2026, 2, 17), end: day(2026, 11, 30), isMilestone: false,
    nature: "", variant: "", countLabel: "", expandable: false, collapsed: false, state: null, lateEnd: false, tone: "",
    ...fields,
  };
}
const LATE = { parts: [{ text: "retard 103 j", tone: "late" }], title: "Fin trop tardive : à finir au plus tard le Mer 19/08/26." };
const LINES = [
  line({ key: "zone:z2", kind: "zone", role: "zone", service: "", level: 0, name: "Zone 2 / BAT B", durationLabel: "", expandable: true,
    state: { parts: [{ text: "1 retard Synthèse", tone: "late" }, { text: "2 retards Structure", tone: "error" }], title: "" } }),
  line({ key: "level:113", kind: "level", role: "level", service: "", level: 1, name: "RDC ⇄ 3032 — PH REZ DE CHAUSSEE - COF", durationLabel: "",
    expandable: true, collapsed: true, tone: "late" }),
  line({ state: LATE, lateEnd: true, tone: "late", endLimitNote: "Fin trop tardive : à finir au plus tard le Mer 19/08/26." }),
  line({ key: "doc:113", kind: "doc", role: "formwork", service: "structure", level: 2, name: "PH REZ DE CHAUSSEE - COF", id2: "3032",
    indice: "A", durationLabel: "2 sem.", start: day(2026, 8, 19), end: day(2026, 9, 2), variant: "coffrage", countLabel: "1 armature",
    expandable: true, collapsed: true }),
  line({ key: "doc:141", kind: "doc", role: "doc", service: "structure", level: 1, name: "Note d'hypothèses générales", id2: "3999",
    indice: "0", durationLabel: "", start: null, end: null, variant: "ndc",
    state: { parts: [{ text: "terminé", tone: "muted" }], title: "" } }),
];
const TOTALS = { linkedFloors: 3, unlinkedFloors: 1, synthese: 1, missing: 0, stale: 1, structure: 2 };

function setup({ stored = null, clientWidth = 0 } = {}) {
  const { doc, win } = createFakeEnvironment();
  const host = new FakeElement("section");
  const calls = { toggles: [], alerts: 0, ganttRenders: [], ganttResizes: 0, ganttHosts: null, stored: [] };
  const storage = {
    getItem: () => stored,
    setItem: (key, value) => calls.stored.push([key, value]),
  };
  const table = createGlobalPlanningTable(host, {
    onToggle: (key) => calls.toggles.push(key),
    onToggleAlertsOnly: () => { calls.alerts += 1; },
  }, {
    doc,
    win,
    storage,
    createGantt: (hosts) => {
      calls.ganttHosts = hosts;
      return { render: (lines) => calls.ganttRenders.push(lines), resize: () => { calls.ganttResizes += 1; } };
    },
  });
  const root = host.children[0];
  root.clientWidth = clientWidth;
  return { host, root, table, calls, body: one(root, "stt-body") };
}

test("largeur minimale du tableau : au moins la somme des colonnes minimales", () => {
  assert.equal(MIN_LEFT_WIDTH, 660);
  assert.ok(MIN_LEFT_WIDTH >= 180 + 56 + 56 + 60 + 92 + 92 + 120);
});

test("colonnes : celles du tableau Synthese, plus « État »", () => {
  assert.deepEqual(COLUMNS.map((column) => column.label), ["Nom", "N°", "Indice", "Durée", "Début", "Fin", "État"]);
  const { root } = setup();
  const head = one(root, "stt-line--head");
  assert.deepEqual(all(head, "stt-cell").map((cell) => cell.textContent), ["Nom", "N°", "Indice", "Durée", "Début", "Fin", "État"]);
  assert.ok(root.classes.has("stt") && root.classes.has("gpl"));
  assert.equal(one(root, "stt-scroll").getAttribute("aria-readonly"), "true");
});

test("une ligne : ses cellules, ses classes de rôle et de type, son retrait par niveau", () => {
  const element = buildLineElement(LINES[3], createFakeEnvironment().doc);
  assert.deepEqual(["stt-line", "gpl-line", "gpl-line--formwork", "is-type-coffrage"].every((name) => element.classes.has(name)), true);
  assert.deepEqual([element.dataset.lineKey, element.getAttribute("aria-level"), element.getAttribute("aria-expanded")], ["doc:113", "3", "false"]);
  assert.deepEqual(
    ["id2", "indice", "duration", "start", "end"].map((field) => cellText(element, field)),
    ["3032", "A", "2 sem.", "Mer 19/08/26", "Mer 02/09/26"]
  );
  const name = one(element, "stt-cell--name");
  assert.equal(one(name, "stt-text").textContent, "PH REZ DE CHAUSSEE - COF");
  assert.equal(one(name, "gpl-count").textContent, "1 armature");
  assert.equal(name.style.paddingLeft, "36px", "4 + 2 niveaux de 16 px, triangle compris dans la cellule");
  assert.ok(one(element, "stt-right"), "emplacement de la ligne dans le Gantt");
});

test("triangle de repli : seulement sur une ligne qui a un contenu, jamais grisé par le contexte partagé", () => {
  const { doc } = createFakeEnvironment();
  const folded = one(buildLineElement(LINES[1], doc), "stt-toggle");
  assert.deepEqual([folded.textContent, folded.getAttribute("aria-label"), folded.type], [
    "▸", "Déplier RDC ⇄ 3032 — PH REZ DE CHAUSSEE - COF", "button",
  ]);
  assert.equal(folded.dataset.serviceContextNavigation, "");
  const open = one(buildLineElement(LINES[0], doc), "stt-toggle");
  assert.deepEqual([open.textContent, open.getAttribute("aria-label")], ["▾", "Replier Zone 2 / BAT B"]);
  const leaf = buildLineElement(LINES[2], doc);
  assert.equal(one(leaf, "stt-toggle"), undefined);
  assert.equal(leaf.getAttribute("aria-expanded"), null);
  assert.equal(one(leaf, "stt-cell--name").style.paddingLeft, "106px", "4 + 5 × 16 + 22 à la place du triangle");
});

test("retard de la Synthèse : la Fin en rouge, sans clignoter, la limite au survol", () => {
  const { doc } = createFakeEnvironment();
  const end = one(buildLineElement(LINES[2], doc), "stt-cell--end");
  assert.ok(end.classes.has("is-late"));
  assert.equal(end.classes.has("is-blink"), false);
  assert.equal(end.title, "Fin trop tardive : à finir au plus tard le Mer 19/08/26.");
  const calm = one(buildLineElement(LINES[3], doc), "stt-cell--end");
  assert.equal(calm.classes.has("is-blink"), false);
  assert.equal(calm.title, undefined);
});

test("cellule État : une part par alerte, son ton en couleur fixe, l'explication au survol", () => {
  const { doc } = createFakeEnvironment();
  const zone = buildStateCell(LINES[0], doc);
  const parts = all(zone, "gpl-state__part");
  assert.deepEqual(parts.map((part) => part.textContent), ["1 retard Synthèse", "2 retards Structure"]);
  assert.deepEqual(parts.map((part) => [part.classes.has("is-tone-late"), part.classes.has("is-tone-error"), part.classes.has("is-blink")]), [
    [true, false, false],
    [false, true, false],
  ]);
  // Rien ne clignote sur la ligne d'une tâche en retard.
  assert.equal(all(buildLineElement(LINES[2], doc), "is-blink").length, 0);
  assert.equal(all(zone, "gpl-state__sep").length, 1);
  assert.equal(zone.title, "1 retard Synthèse · 2 retards Structure", "sans explication : le texte lui-même");
  assert.equal(buildStateCell(LINES[2], doc).title, "Fin trop tardive : à finir au plus tard le Mer 19/08/26.");
  const empty = buildStateCell(LINES[1], doc);
  assert.deepEqual([empty.children.length, empty.title], [0, undefined]);
});

test("dates absentes : cellules vides ; nature et jalon : classes de couleur de la vue Synthese", () => {
  const { doc } = createFakeEnvironment();
  const ndc = buildLineElement(LINES[4], doc);
  assert.deepEqual([cellText(ndc, "start"), cellText(ndc, "end"), cellText(ndc, "duration")], ["", "", ""]);
  const kickoff = buildLineElement(line({ nature: "demarrage", isMilestone: true }), doc);
  assert.ok(kickoff.classes.has("is-nature-demarrage") && kickoff.classes.has("is-milestone"));
});

test("rendu : une ligne du tableau par ligne du modèle, les mêmes au Gantt", () => {
  const { table, calls, body, root } = setup();
  table.render(LINES, { totals: TOTALS });
  assert.deepEqual(body.children.map((element) => element.dataset.lineKey), ["zone:z2", "level:113", "task:420", "doc:113", "doc:141"]);
  assert.equal(calls.ganttRenders.at(-1), LINES);
  assert.deepEqual(Object.keys(calls.ganttHosts).sort(), ["headHost", "interactionHost", "layerHost", "rowHeight"]);
  assert.equal(calls.ganttHosts.rowHeight, 26);
  assert.ok(calls.ganttHosts.interactionHost.classes.has("stt-scroll"));
  assert.equal(one(root, "stt-empty").hidden, true);
  assert.equal(body.hidden, false);
});

test("lecture seule : aucune cellule modifiable, aucune poignée, aucun menu", () => {
  const { table, root } = setup();
  table.render(LINES, { totals: TOTALS });
  assert.equal(all(root, "is-editable").length, 0);
  assert.equal(all(root, "stt-grip").length, 0);
  assert.equal(all(root, "stt-menu").length, 0);
  assert.equal(all(root, "stt-input").length, 0);
  assert.equal(all(root, "stt-cell").some((cell) => cell.tabIndex != null), false);
});

test("clic sur un triangle : repli demandé pour sa ligne ; clic ailleurs : rien", () => {
  const { table, calls, body } = setup();
  table.render(LINES, { totals: TOTALS });
  dispatch(one(body.children[1], "stt-toggle"), "click");
  assert.deepEqual(calls.toggles, ["level:113"]);
  dispatch(one(body.children[2], "stt-cell--end"), "click");
  dispatch(one(body.children[1], "stt-text"), "click");
  assert.deepEqual(calls.toggles, ["level:113"]);
});

test("barre d'état : compteurs, « Alertes seulement », relecture en échec ; pas de bouton « Actualiser »", () => {
  const { table, calls, root } = setup();
  table.render(LINES, { totals: TOTALS });
  assert.equal(one(root, "gpl-bar__counts").textContent, "3 étages liés · 1 non lié · 1 retard Synthèse · 1 à mettre à jour · 2 retards Structure");
  const buttons = all(root, "gpl-bar__button");
  assert.deepEqual(buttons.map((button) => button.textContent), ["Alertes seulement"]);
  const [alerts] = buttons;
  assert.deepEqual([alerts.getAttribute("aria-pressed"), alerts.classes.has("is-active")], ["false", false]);
  assert.equal(alerts.dataset.serviceContextNavigation, "");
  assert.equal(one(root, "gpl-bar__notice").hidden, true);
  dispatch(alerts, "click");
  assert.equal(calls.alerts, 1);

  table.render(LINES, { totals: TOTALS, alertsOnly: true, notice: "La dernière relecture a échoué." });
  assert.deepEqual([alerts.getAttribute("aria-pressed"), alerts.classes.has("is-active")], ["true", true]);
  const notice = one(root, "gpl-bar__notice");
  assert.deepEqual([notice.textContent, notice.hidden], ["La dernière relecture a échoué.", false]);
  table.render(LINES, { totals: TOTALS });
  assert.deepEqual([alerts.classes.has("is-active"), notice.hidden], [false, true]);
});

test("message à la place des lignes : tableau vide, Gantt vide, compteurs effacés", () => {
  const { table, calls, body, root } = setup();
  table.render(LINES, { totals: TOTALS });
  table.render(LINES, { emptyMessage: "Chargement du planning global…" });
  const empty = one(root, "stt-empty");
  assert.deepEqual([empty.textContent, empty.hidden, body.hidden, body.children.length], ["Chargement du planning global…", false, true, 0]);
  assert.deepEqual(calls.ganttRenders.at(-1), []);
  assert.equal(one(root, "gpl-bar__counts").textContent, "");
  table.render(null, {});
  assert.deepEqual([body.children.length, body.hidden], [0, false]);
});

test("séparateur : glisser change la largeur du tableau et la mémorise", () => {
  const { root, calls } = setup();
  const splitter = one(root, "stt-splitter");
  assert.equal(splitter.getAttribute("aria-valuenow"), String(DEFAULT_LEFT_WIDTH));
  const resizes = calls.ganttResizes;
  dispatch(splitter, "pointerdown", { button: 0, clientX: 500, pointerId: 1 });
  assert.ok(root.classes.has("is-resizing"));
  dispatch(splitter, "pointermove", { clientX: 440, pointerId: 1 });
  assert.equal(splitter.getAttribute("aria-valuenow"), String(DEFAULT_LEFT_WIDTH - 60));
  assert.deepEqual(calls.stored, [], "rien n'est mémorisé avant le relâchement");
  dispatch(splitter, "pointerup", { pointerId: 1 });
  assert.equal(root.classes.has("is-resizing"), false);
  assert.deepEqual(calls.stored, [["planning-projet.global-planning.left-width", String(DEFAULT_LEFT_WIDTH - 60)]]);
  assert.ok(calls.ganttResizes > resizes, "le Gantt suit la largeur");
  dispatch(splitter, "pointermove", { clientX: 100, pointerId: 1 });
  assert.equal(splitter.getAttribute("aria-valuenow"), String(DEFAULT_LEFT_WIDTH - 60), "glisser terminé : plus d'effet");
});

test("séparateur : bornes, clavier, largeur mémorisée reprise", () => {
  const { root, calls } = setup({ stored: "700" });
  const splitter = one(root, "stt-splitter");
  assert.equal(splitter.getAttribute("aria-valuenow"), "700");
  dispatch(splitter, "keydown", { key: "ArrowRight" });
  assert.equal(splitter.getAttribute("aria-valuenow"), "724");
  dispatch(splitter, "keydown", { key: "Enter" });
  assert.deepEqual(calls.stored, [["planning-projet.global-planning.left-width", "724"]]);
  dispatch(splitter, "pointerdown", { button: 0, clientX: 800, pointerId: 2 });
  dispatch(splitter, "pointermove", { clientX: 0, pointerId: 2 });
  assert.equal(splitter.getAttribute("aria-valuenow"), String(MIN_LEFT_WIDTH), "jamais plus étroit que le minimum");
  dispatch(splitter, "pointerup", { pointerId: 2 });
  dispatch(splitter, "pointerdown", { button: 2, clientX: 0, pointerId: 3 });
  assert.equal(root.classes.has("is-resizing"), false, "bouton droit : pas de glisser");

  const wide = setup({ clientWidth: 1000 });
  wide.table.render([], {});
  assert.equal(DEFAULT_LEFT_WIDTH, 980);
  assert.equal(one(wide.root, "stt-splitter").getAttribute("aria-valuenow"), "840", "le Gantt garde au moins 160 px");
  assert.equal(one(setup({ stored: "abc" }).root, "stt-splitter").getAttribute("aria-valuenow"), String(DEFAULT_LEFT_WIDTH));
});
