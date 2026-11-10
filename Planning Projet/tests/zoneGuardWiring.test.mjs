import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, `bornes introuvables : ${startToken} → ${endToken}`);
  return source.slice(start, end);
}

const deleteHandler = sliceBetween(mainJs, "els.deleteBtn.addEventListener(\"click\"", "function parseIsoDate(");
const renameHandler = sliceBetween(mainJs, "els.renameBtn.addEventListener(\"click\"", "els.deleteBtn instanceof HTMLElement");
const holdersFn = sliceBetween(mainJs, "async function findZoneHoldersElsewhere(", "async function checkZoneHolders(");
const checkFn = sliceBetween(mainJs, "async function checkZoneHolders(", "function bindManageZoneModal(");
const manageableFn = sliceBetween(mainJs, "function getCurrentManageableZoneOptions(", "function populateManageZoneSelect(");

test("main.js importe le garde-fou depuis zoneGuard.js", () => {
  const match = mainJs.match(/import \{([^}]*)\} from "\.\/services\/zoneGuard\.js";/);
  assert.ok(match, "import de zoneGuard.js introuvable");
  for (const name of [
    "ZONE_DATA_READ_FAILED",
    "ZONE_DATA_TABLES",
    "ZONE_RENAME_READ_FAILED",
    "buildZoneLeftoverNotice",
    "buildZoneNotHereMessage",
    "buildZoneRefusal",
    "findZoneHolders",
  ]) {
    assert.match(match[1], new RegExp(String.raw`\b${name}\b`), name);
  }
  assert.doesNotMatch(mainJs, /zoneDeletionGuard/);
});

test("« Modifier Zone » liste toutes les zones du projet, partagées comprises", () => {
  assert.doesNotMatch(manageableFn, /includeSharedZones/);
  assert.match(manageableFn, /buildZoneOptionsForSelectedProject\(/);
});

test("la suppression vérifie les autres services avant confirm et clearProjectZone", () => {
  const check = deleteHandler.indexOf("checkZoneHolders(sourceZone");
  assert.ok(check >= 0);
  assert.ok(check < deleteHandler.indexOf("window.confirm("));
  assert.ok(check < deleteHandler.indexOf("clearProjectZone("));
  assert.ok(check > deleteHandler.indexOf("normalizeManageZoneKey(sourceZone)"));
  assert.match(deleteHandler, /ZONE_DATA_READ_FAILED/);
  assert.match(deleteHandler, /action: "supprimer"/);
});

test("le renommage vérifie les autres services après le doublon et avant renameProjectZone", () => {
  const check = renameHandler.indexOf("checkZoneHolders(sourceZone");
  assert.ok(check >= 0);
  assert.ok(check > renameHandler.indexOf("if (duplicate)"));
  assert.ok(check < renameHandler.indexOf("renameProjectZone("));
  assert.match(renameHandler, /ZONE_RENAME_READ_FAILED/);
  assert.match(renameHandler, /action: "renommer"/);
});

test("le helper partagé refuse sur holders.data et signale la lecture impossible", () => {
  assert.match(checkFn, /holders\.data\.length/);
  assert.match(checkFn, /buildZoneRefusal\(zone, holders\.data, \{ action \}\)/);
  assert.match(checkFn, /setManageZoneModalHint\(readFailedMessage\)/);
  assert.match(checkFn, /return null/);
  assert.match(checkFn, /Vérification des données des autres services/);
});

test("findZoneHoldersElsewhere est le seul lecteur : fetchProjectRows, tables, service courant", () => {
  assert.match(holdersFn, /typeof context\?\.fetchProjectRows !== "function"/);
  assert.match(holdersFn, /throw /);
  assert.match(holdersFn, /ZONE_DATA_TABLES\.map\(/);
  assert.match(holdersFn, /context\.fetchProjectRows\(/);
  assert.match(holdersFn, /Promise\.all\(/);
  assert.ok(mainJs.includes("getState?.()?.selectedService"));
  assert.match(holdersFn, /currentServiceName\(\)/);
  assert.equal([...mainJs.matchAll(/Promise\.all\(ZONE_DATA_TABLES/g)].length, 1, "tables de zones lues une seule fois");
  assert.equal([...mainJs.matchAll(/findZoneHoldersElsewhere\(/g)].length, 2, "définition + un seul appelant (le helper)");
});

for (const [name, handler, action] of [
  ["suppression", deleteHandler, "supprimer"],
  ["renommage", renameHandler, "renommer"],
]) {
  test(`${name} : zone absente de ce service`, () => {
    assert.match(handler, /result\?\.updated === false/);
    assert.match(handler, new RegExp(String.raw`buildZoneNotHereMessage\(\{\s*action: "` + action + `"`));
  });

  test(`${name} : un autre service garde la zone vide → fenêtre ouverte et avis`, () => {
    assert.match(handler, /holders\.empty\.length/);
    assert.match(handler, new RegExp(String.raw`buildZoneLeftoverNotice\(\{\s*action: "` + action + `"`));
    assert.match(handler, /populateManageZoneSelect\(getCurrentManageableZoneOptions\(\)/);
  });
}
