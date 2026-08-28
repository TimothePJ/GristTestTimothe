"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Modules vendorises du plan de charge : chaque groupe doit rester identique
// octet pour octet. La duplication est volontaire (chaque widget est servi seul
// par URL dans Grist et doit rester auto-suffisant) ; ce test est le prix a
// payer pour qu'elle reste sure.
const VENDORED_GROUPS = {
  "monthSegments.js": [
    "gestion-depenses2/assets/js/utils/monthSegments.js",
    "planning-synchro/assets/js/utils/monthSegments.js",
    "Gestion-User/assets/js/monthSegments.js",
  ],
  "leaveAbsences.js": [
    "gestion-depenses2/assets/js/utils/leaveAbsences.js",
    "planning-synchro/assets/js/utils/leaveAbsences.js",
    "Gestion-User/assets/js/leaveAbsences.js",
  ],
  "frenchHolidays.js": [
    "gestion-depenses2/assets/js/utils/frenchHolidays.js",
    "planning-synchro/assets/js/utils/frenchHolidays.js",
    "Gestion-User/assets/js/frenchHolidays.js",
  ],
  // Charge mensuelle totale d'une personne : seuls les deux widgets qui editent
  // un segment via la fenetre modale en ont besoin. Gestion-User ne l'embarque
  // pas — il n'ouvre aucune fenetre d'edition.
  "monthLoad.js": [
    "gestion-depenses2/assets/js/utils/monthLoad.js",
    "planning-synchro/assets/js/utils/monthLoad.js",
  ],
  // Le test du module est duplique lui aussi : sans cette garde, une copie
  // pourrait rester verte sur une version perimee des regles metier.
  "monthLoad.test.mjs": [
    "gestion-depenses2/tests/monthLoad.test.mjs",
    "planning-synchro/tests/monthLoad.test.mjs",
  ],
};

for (const [moduleName, copies] of Object.entries(VENDORED_GROUPS)) {
  test(`${moduleName} : les copies vendorisees sont identiques`, () => {
    const [referencePath, ...otherPaths] = copies;
    const reference = fs.readFileSync(path.join(REPO_ROOT, referencePath));

    for (const copyPath of otherPaths) {
      const copy = fs.readFileSync(path.join(REPO_ROOT, copyPath));
      assert.ok(
        copy.equals(reference),
        `${copyPath} a diverge de ${referencePath} — repercute la modification dans les ${copies.length} fichiers.`
      );
    }
  });
}
