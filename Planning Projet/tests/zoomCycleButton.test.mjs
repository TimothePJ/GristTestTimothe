// Bandeau : un seul bouton d'échelle, qui affiche l'échelle du planning et passe à la suivante au
// clic (Semaine → Mois → Année → Semaine…), placé juste à gauche des dates du planning.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { ZOOM_MODES, zoomModeLabel, nextZoomMode } from "../assets/js/services/zoomCycle.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const timelineJs = await readFile(new URL("../assets/js/ui/timeline.js", import.meta.url), "utf8");

test("cycle des échelles : Semaine → Mois → Année → Semaine", () => {
  assert.deepEqual([...ZOOM_MODES], ["week", "month", "year"]);
  assert.equal(nextZoomMode("week"), "month");
  assert.equal(nextZoomMode("month"), "year");
  assert.equal(nextZoomMode("year"), "week");
  assert.equal(nextZoomMode("inconnu"), "week", "échelle inconnue : on repart de la semaine");
  assert.deepEqual(ZOOM_MODES.map(zoomModeLabel), ["Semaine", "Mois", "Année"]);
  assert.equal(zoomModeLabel("inconnu"), "Semaine");
});

test("un seul bouton d'échelle dans le bandeau, juste à gauche des dates du planning", () => {
  const toolbar = html.slice(html.indexOf('<div id="toolbar">'), html.indexOf("<!-- Header tableau"));
  const buttons = [...toolbar.matchAll(/<button[^>]*data-zoom=/g)];
  assert.equal(buttons.length, 1, "un seul bouton porte data-zoom");
  const button = /<button\s+id="zoomCycleButton"[\s\S]*?<\/button>/.exec(toolbar)?.[0];
  assert.ok(button, "bouton #zoomCycleButton absent");
  assert.match(button, /type="button"/);
  assert.match(button, /data-zoom="week"/);
  assert.match(button, />Semaine<\/button>$/);
  // Changer d'échelle n'écrit rien : le bouton reste actif en lecture seule.
  assert.match(button, /data-service-context-navigation/);
  const afterButton = toolbar.slice(toolbar.indexOf(button) + button.length);
  assert.match(afterButton, /^\s*<\/div>\s*<div id="current-date-range"/, "les dates suivent immédiatement le bouton");
});

test("timeline.js : le clic passe à l'échelle suivante, le bouton affiche l'échelle courante", () => {
  assert.equal(timelineJs.includes('querySelectorAll(".zoom-buttons button")'), false, "plus de liste de boutons");
  assert.equal(timelineJs.includes(".zoom-buttons button.active"), false);
  assert.match(timelineJs, /import \{[^}]*nextZoomMode[^}]*\} from "\.\.\/services\/zoomCycle\.js";/);
  const bind = timelineJs.slice(timelineJs.indexOf("export function bindTimelineToolbar("), timelineJs.indexOf("export function clearPlanningTimeline("));
  assert.match(bind, /nextZoomMode\(getCurrentZoomMode\(\)\)/);
  const setActive = timelineJs.slice(timelineJs.indexOf("function setActiveZoomButton("), timelineJs.indexOf("function setWindowForMode("));
  assert.match(setActive, /zoomModeLabel\(/);
  assert.match(setActive, /dataset\.zoom = /);
});

const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

// Le bouton et les dates forment un groupe calé à droite : la place libre passe à gauche du
// bouton, jamais entre le bouton et les dates.
test("bouton d'échelle et dates groupés à droite du bandeau, l'espace libre à gauche du bouton", () => {
  const period = /<div class="planning-period">\s*<div class="zoom-buttons"[\s\S]*?<div id="current-date-range"[^>]*><\/div>\s*<\/div>/.exec(html);
  assert.ok(period, "le groupe .planning-period contient le bouton puis les dates");
  const rule = /\.planning-period\s*\{([^}]*)\}/.exec(css)?.[1] || "";
  assert.match(rule, /display:\s*flex/);
  assert.match(rule, /justify-content:\s*flex-end/);
  assert.equal(/>\s*#current-date-range\s*\{/.test(css), false, "les tailles du bandeau visent le groupe, plus les dates seules");
  // Le texte des dates se choisit d'après la place que le bouton lui laisse dans le groupe.
  const update = timelineJs.slice(timelineJs.indexOf("function updateDateRangeDisplay("), timelineJs.indexOf("function getCurrentZoomMode("));
  assert.match(update, /dateRangeAvailableWidth\(el\)/);
  assert.match(timelineJs, /function dateRangeAvailableWidth\(el\) \{[\s\S]*?closest\("\.planning-period"\)/);
});
