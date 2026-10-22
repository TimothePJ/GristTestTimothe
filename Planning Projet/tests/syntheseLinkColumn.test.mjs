// Lien d'une tâche de la vue Synthese (un seul prédécesseur), comme dans MS Project : numéros de
// ligne (toutes les lignes, dépliées) et lien affiché par le numéro de la tâche à suivre
// (« 45FD+5 ») dans la colonne Lien, en lecture seule ; le lien se choisit dans la fenêtre ouverte par
// le clic droit sur une tâche (module pur syntheseLinkColumn.js).
// Étage SS1 de la zone « Zone 1 / BAT BC » (export de l'utilisateur), lignes numérotées :
//  1 zone, 2 SS1, 3 RECEPTION ARCH (984), 4 CYCLE 1, 5 à 11 ses tâches (986, 987, 988, 1061, 989,
//  990, 991), 12 CYCLE 2, 13 RECEPTION (993), 14 PLAN SYT CYCLE 2, 15 RESEAUX (995), 16 RESERVATIONS
//  (996), 17 TERMINAUX (997), 18 REUNION (998), 19 CYCLE 3, 20 RECEPTION (1000), 21 VISA A (1001),
//  22 PLAN SYT CYCLE 3, 23 à 25 (1003 à 1005), 26 REUNION (1006), 27 SIGNATURE (1007), 28 DEMARRAGE
//  (1008).
import test from "node:test";
import assert from "node:assert/strict";

import { buildRowModel, buildSections } from "../assets/js/services/syntheseTaskModel.js";
import {
  applyLineNumbers,
  lineNumbersOf,
  linkChoices,
  planLinkChange,
  previewLink,
} from "../assets/js/services/syntheseLinkColumn.js";
import { ERA_ZONE_KEY, eraSs1Rows } from "./helpers/eraSs1Rows.mjs";

const withRows = (rows, fieldsById) => rows.map((row) => (fieldsById[row.id] ? { ...row, ...fieldsById[row.id] } : row));
const change = (taskId, link, rows = eraSs1Rows()) => planLinkChange({ sections: buildSections({ rows }), taskId, link });
const fd = (predId, lag = 0) => ({ predId, type: "FD", lag });

test("numéros de ligne : toutes les lignes, dans l'ordre affiché, comme si tout était déplié", () => {
  const { byKey, lineAt } = lineNumbersOf(buildSections({ rows: eraSs1Rows() }));
  assert.equal(byKey.get(`zone:${ERA_ZONE_KEY}`), 1);
  assert.deepEqual(["task:984", "group:985", "task:1061", "group:992", "task:997", "task:1001", "group:1002", "task:1008"].map((key) => byKey.get(key)), [
    3, 4, 8, 12, 17, 21, 22, 28,
  ]);
  assert.equal(lineAt.get(21).taskId, 1001);
  assert.equal(lineAt.size, 28);
});

test("lignes affichées : leur numéro, même repliées, et le lien des tâches par le numéro à suivre", () => {
  const sections = buildSections({ rows: eraSs1Rows() });
  const folded = buildRowModel(sections, { collapsedGroupKeys: new Set(["group:985"]) });
  const lines = applyLineNumbers(folded, lineNumbersOf(sections));
  const at = (key) => lines.find((line) => line.key === key);
  assert.equal(at("group:992").lineNumber, 12, "CYCLE 1 replié : CYCLE 2 garde son numéro");
  assert.deepEqual(["task:1001", "task:1007", "task:996", "task:984"].map((key) => at(key).linkText), ["20FD", "21FD+5", "15FF", ""]);
  assert.equal(at("group:992").linkText, "");
});

test("choix de la fenêtre : les tâches de la zone, rangées par étage et cycle ; elle-même et ce qui dépend d'elle grisés", () => {
  const sections = buildSections({ rows: eraSs1Rows() });
  const choices = linkChoices({ sections, taskId: 1001, numbering: lineNumbersOf(sections) });
  assert.equal(choices.taskName, "VISA Indice A");
  assert.deepEqual(choices.current, { predId: 1000, type: "FD", lag: 0 });
  assert.deepEqual(choices.rows.filter((row) => row.kind === "header").map((row) => [row.label, row.level]), [
    ["SS1", 0], ["CYCLE 1", 1], ["CYCLE 2", 1], ["PLAN SYT CYCLE 2", 2], ["CYCLE 3", 1], ["PLAN SYT CYCLE 3", 2],
  ]);
  const row = (taskId) => choices.rows.find((candidate) => candidate.taskId === taskId);
  assert.deepEqual(row(1000), {
    kind: "task", taskId: 1000, lineNumber: 20, name: "RECEPTION RENDU CET RSX RESA TER", level: 2,
    dates: "Mar 23/12/25 → Mar 30/12/25", disabled: false, note: "", selected: true,
  });
  assert.deepEqual([row(1001).disabled, row(1001).note], [true, "elle-même"]);
  // SIGNATURE suit VISA A, et DEMARRAGE GO suit SIGNATURE : les choisir ferait une boucle.
  assert.deepEqual([1007, 1008].map((taskId) => [row(taskId).disabled, row(taskId).note]), [[true, "dépend d'elle"], [true, "dépend d'elle"]]);
  assert.equal(row(993).disabled, false);
  // 28 lignes, moins la zone, l'étage, 3 cycles et 2 sous-cycles : 21 tâches.
  assert.equal(choices.rows.filter((candidate) => candidate.kind === "task").length, 21);
});

test("choix de la fenêtre : un lien vers une autre zone reste proposé, sous « Autres zones »", () => {
  const other = { ...eraSs1Rows().find((row) => row.id === 1061), id: 2000, Zone: "Zone 2", Groupe: "", Parent: "", Ordre: "", Taches: "Visa zone 2", Lien: "1008 FD" };
  const sections = buildSections({ rows: [...eraSs1Rows(), other] });
  const choices = linkChoices({ sections, taskId: 2000, numbering: lineNumbersOf(sections) });
  // Zone 2 : la tâche seule (au niveau zone) ; puis DEMARRAGE GO de Zone 1, qu'elle suit.
  assert.deepEqual(choices.rows.map((row) => (row.kind === "header" ? row.label : row.taskId)), [2000, "Autres zones", 1008]);
  assert.deepEqual([choices.rows[0].disabled, choices.rows[2].selected], [true, true]);
});

test("changer le lien : la tâche prend les dates que lui donne son lien, avec sa durée", () => {
  // VISA Indice A (1001, 10 jours) après la RECEPTION de CYCLE 2 (993, finie le 15/12) : 16/12 → 30/12.
  const result = change(1001, fd(993));
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields, { Lien: "993 FD", Diff_coffrage: "2025-12-16", Diff_armature: "2025-12-30", Duree_1: 10 });
  assert.equal(result.task.link.predId, 993);
  // Début → début : même Début que la RECEPTION de CYCLE 3 (23/12) ; 10 jours → 07/01.
  assert.deepEqual(change(1001, { predId: 1000, type: "DD", lag: 0 }).fields, { Lien: "1000 DD", Diff_coffrage: "2025-12-23", Diff_armature: "2026-01-07", Duree_1: 10 });
  // Un jalon avec décalage : SIGNATURE 2 jours après la Fin de VISA A (14/01) → 16/01.
  assert.deepEqual(change(1007, fd(1001, 2)).fields, { Lien: "1001 FD+2", Diff_coffrage: "2026-01-16", Diff_armature: "2026-01-16", Duree_1: 0 });
});

test("même lien : rien ; sans lien : dates gardées ; tâche à suivre sans dates : le lien seul", () => {
  assert.deepEqual(change(1007, fd(1001, 5)).fields, {});
  const cleared = change(1001, null);
  assert.deepEqual(cleared.fields, { Lien: "" });
  assert.equal(cleared.task.link, null);
  const undated = withRows(eraSs1Rows(), { 1000: { Diff_coffrage: null, Diff_armature: null } });
  assert.deepEqual(change(1007, fd(1000), undated).fields, { Lien: "1000 FD" });
});

test("changement refusé : la tâche elle-même, une boucle, une tâche disparue, un décalage hors bornes", () => {
  const refusal = (taskId, link) => {
    const result = change(taskId, link);
    assert.equal(result.ok, false);
    return result.error;
  };
  assert.equal(refusal(1001, fd(1001)), "Une tâche ne peut pas se suivre elle-même.");
  assert.equal(refusal(1000, fd(1001)), "Ce lien ferait une boucle : « VISA Indice A » dépend déjà de « RECEPTION RENDU CET RSX RESA TER ».");
  assert.equal(refusal(1001, fd(9999)), "La tâche à suivre n'existe plus.");
  assert.equal(refusal(1001, fd(993, 10000)), "Le décalage est limité à 9999 jours ouvrés.");
  assert.equal(refusal(1001, fd(993, 2.5)), "Le décalage doit être un nombre entier de jours ouvrés.");
  assert.equal(change(1001, fd(993, 9999)).ok, true);
});

test("aperçu : les nouvelles dates, ou ce qui se passera", () => {
  const sections = buildSections({ rows: eraSs1Rows() });
  const preview = (taskId, link, rowsSections = sections) => previewLink({ sections: rowsSections, taskId, link });
  assert.equal(preview(1001, fd(993)), "Nouvelles dates : Mar 16/12/25 → Mar 30/12/25");
  assert.equal(preview(1001, fd(1000)), "Lien inchangé.");
  assert.equal(preview(1001, null), "Sans lien : la tâche garde ses dates.");
  assert.equal(preview(1001, fd(1001)), "Une tâche ne peut pas se suivre elle-même.");
  const undated = buildSections({ rows: withRows(eraSs1Rows(), { 1000: { Diff_coffrage: null, Diff_armature: null } }) });
  assert.equal(preview(1007, fd(1000), undated), "La tâche à suivre n'a pas de dates : seul le lien sera enregistré.");
});

test("même lien, mais des dates qui s'en sont écartées : Valider les recale sur le lien", () => {
  // VISA A (« 1000 FD », 10 jours) décalée à la main au 05/01 → 16/01 : son lien la remet au 31/12 → 14/01.
  const shifted = withRows(eraSs1Rows(), { 1001: { Diff_coffrage: "2026-01-05", Diff_armature: "2026-01-16" } });
  assert.deepEqual(change(1001, fd(1000), shifted).fields, { Diff_coffrage: "2025-12-31", Diff_armature: "2026-01-14", Duree_1: 10 });
  assert.equal(
    previewLink({ sections: buildSections({ rows: shifted }), taskId: 1001, link: fd(1000) }),
    "Nouvelles dates : Mer 31/12/25 → Mer 14/01/26",
  );
});
