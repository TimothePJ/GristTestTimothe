# `TimeSegment` au mois — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer `TimeSegment.Start_At`/`End_At` par une colonne `Mois`, faire du clic sur un mois le geste de création, et adapter `Gestion-User` à une capacité réelle (week-ends + fériés + congés).

**Architecture:** Un module pur `monthSegments.js`, vendorisé à l'identique dans les trois widgets et verrouillé par un test de parité, porte toute l'arithmétique du mois (résolution du mois d'une ligne, bornes, jours ouvrés, disponibilité après congés, répartition mois → semaine). Les widgets éditeurs (`gestion-depenses2`, `planning-synchro`) l'utilisent pour caler les barres et écrire `Mois` ; `Gestion-User` l'utilise pour étaler l'effectif mensuel sur ses semaines ISO.

**Tech Stack:** ES modules natifs (pas de bundler, pas de `package.json`), `node --test` (Node v25.7.0), API widget Grist (`grist.docApi.fetchTable` / `applyUserActions`).

**Spec:** [`docs/superpowers/specs/2026-08-25-timesegment-mois-design.md`](../specs/2026-08-25-timesegment-mois-design.md)

## Global Constraints

- **Aucun `git commit`, aucun `git push`.** L'utilisateur relit et pousse lui-même. Les étapes « Commit » du gabarit sont remplacées par des étapes de vérification.
- **Colonne `Mois`** : Date Grist, valeur = **1er du mois**. Lecture tolérante (Date, epoch s/ms, `"YYYY-MM"`, `"YYYY-MM-DD"`, `"MM/YYYY"`), écriture en **epoch secondes**.
- **Clé métier unique** : (`NumeroProjet`, `Name`, `Mois`).
- **`Effectif`** : obligatoire, **strictement > 0**, **multiple de 0,5**. C'est la seule quantité de charge lue par le code.
- **`Allocation_Days`** : toujours écrite (= jours ouvrés du mois), **jamais lue**.
- **`Start_At` / `End_At`** : plus jamais écrites ; lues uniquement en repli quand `Mois` est vide.
- **Repli legacy** : doit devenir inerte sans erreur si les colonnes disparaissent de la table.
- **Les 3 copies de `monthSegments.js` sont identiques octet pour octet.** Idem pour `leaveAbsences.js` et `frenchHolidays.js` (déjà vrai aujourd'hui entre `gestion-depenses2` et `planning-synchro`).
- **Commandes de test** :
  - `cd <widget> && node --test "tests/**/*.test.mjs"`
  - `node --test "shared/tests/**/*.test.cjs"` (depuis la racine)
- **Style des chaînes** : suivre la convention du fichier touché (`index.html` accentué, chaînes JS majoritairement non accentuées).

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `*/monthSegments.js` (×3, identiques) | **Nouveau.** Toute l'arithmétique du mois. Pur, sans DOM ni Grist. |
| `Gestion-User/assets/js/{frenchHolidays,leaveAbsences}.js` | **Nouveaux.** Copies conformes, pour que Gestion-User connaisse fériés et congés. |
| `shared/tests/vendored-charge-modules-parity.test.cjs` | **Nouveau.** Interdit la divergence des copies. |
| `*/config.js` (×3) | Déclaration de la colonne `Mois` (+ table `Time-Out` pour Gestion-User). |
| `gestion-depenses2/services/projectService.js` | Lecture `Mois` → `provisionalDays[monthKey] = Effectif`. |
| `*/services/gristService.js` (×2) | Écriture `Mois`, plus de `Start_At`/`End_At`. |
| `gestion-depenses2/ui/chargeTimeline.js`, `planning-synchro/bottom/chargeBoard.js` | Barres calées sur le mois, surlignage du mois, plus de poignées. |
| `gestion-depenses2/main.js`, `planning-synchro/bottom/chargeEditing.js` | Clic → mois, cycle création-à-la-validation. |
| `gestion-depenses2/index.html`, `planning-synchro/{index.html,bottom/editSegmentModal.js}` | Fenêtre sans Début/Fin. |
| `Gestion-User/{dataService,utilizationService,app}.js` | Segments mensuels, capacité par collaborateur, état « Congé ». |

---

### Task 1 : Le module `monthSegments.js` et son verrou de parité

**Files:**
- Create: `gestion-depenses2/assets/js/utils/monthSegments.js`
- Create: `planning-synchro/assets/js/utils/monthSegments.js` (copie identique)
- Create: `Gestion-User/assets/js/monthSegments.js` (copie identique)
- Create: `Gestion-User/assets/js/frenchHolidays.js` (copie de `gestion-depenses2/assets/js/utils/frenchHolidays.js`)
- Create: `Gestion-User/assets/js/leaveAbsences.js` (copie de `gestion-depenses2/assets/js/utils/leaveAbsences.js`)
- Create: `shared/tests/vendored-charge-modules-parity.test.cjs`
- Test: `gestion-depenses2/tests/monthSegments.test.mjs`, `planning-synchro/tests/monthSegments.test.mjs`

**Interfaces:**
- Consumes: `availableDaysAfterLeave(startAt, endAt, absenceSet)` de `./leaveAbsences.js` — renvoie les **jours** (pas demi-journées) ouvrés hors absences ; tolère `absenceSet` `null`/vide (renvoie alors les jours ouvrés bruts).
- Produces :
  - `monthKeyFromDate(date) -> "YYYY-MM" | ""`
  - `getMonthKeyFromRawMonth(value) -> "YYYY-MM" | ""`
  - `resolveSegmentMonthKey(row, columns) -> "YYYY-MM" | ""` (`columns` = `{ mois, startDate }`)
  - `getMonthBounds(monthKey) -> { startAt: Date, endAt: Date } | null`
  - `toGristMonthValue(monthKey) -> number | null` (epoch **secondes**)
  - `getMonthBusinessDays(monthKey) -> number`
  - `getMonthAvailableDays(monthKey, absenceSet) -> number`
  - `getMonthShareForRange(monthKey, rangeStart, rangeEnd, absenceSet) -> number` (0..1)

- [ ] **Step 1 : Vendoriser fériés + congés dans Gestion-User**

```bash
cd "<repo>"
cp gestion-depenses2/assets/js/utils/frenchHolidays.js Gestion-User/assets/js/frenchHolidays.js
cp gestion-depenses2/assets/js/utils/leaveAbsences.js  Gestion-User/assets/js/leaveAbsences.js
```

`leaveAbsences.js` importe `./frenchHolidays.js` — les deux fichiers sont côte à côte dans `Gestion-User/assets/js/`, le chemin relatif fonctionne tel quel.

- [ ] **Step 2 : Écrire le test qui échoue**

Créer `planning-synchro/tests/monthSegments.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSegmentMonthKey,
  getMonthBounds,
  toGristMonthValue,
  getMonthBusinessDays,
  getMonthAvailableDays,
  getMonthShareForRange,
} from "../assets/js/utils/monthSegments.js";

const COLS = { mois: "Mois", startDate: "Start_At" };

test("resolveSegmentMonthKey lit Mois en priorite", () => {
  assert.equal(resolveSegmentMonthKey({ Mois: "2026-09-01" }, COLS), "2026-09");
  assert.equal(resolveSegmentMonthKey({ Mois: new Date(2026, 8, 1) }, COLS), "2026-09");
  // epoch secondes du 1er septembre 2026, comme ecrit par toGristMonthValue
  const epochSeconds = Math.floor(new Date(2026, 8, 1).getTime() / 1000);
  assert.equal(resolveSegmentMonthKey({ Mois: epochSeconds }, COLS), "2026-09");
});

test("resolveSegmentMonthKey retombe sur Start_At quand Mois est vide", () => {
  assert.equal(resolveSegmentMonthKey({ Mois: "", Start_At: "2026-09-17" }, COLS), "2026-09");
  assert.equal(resolveSegmentMonthKey({ Start_At: "2026-09-17" }, COLS), "2026-09");
});

test("resolveSegmentMonthKey est inerte quand les deux colonnes ont disparu", () => {
  assert.equal(resolveSegmentMonthKey({}, COLS), "");
  assert.equal(resolveSegmentMonthKey(null, COLS), "");
});

test("getMonthBounds couvre le mois entier", () => {
  const bounds = getMonthBounds("2026-09");
  assert.equal(bounds.startAt.getDate(), 1);
  assert.equal(bounds.startAt.getMonth(), 8);
  assert.equal(bounds.endAt.getDate(), 30);
  assert.equal(bounds.endAt.getHours(), 23);
  assert.equal(getMonthBounds("2026-13"), null);
  assert.equal(getMonthBounds("bidon"), null);
});

test("toGristMonthValue renvoie l'epoch du 1er du mois, en secondes", () => {
  assert.equal(toGristMonthValue("2026-09"), Math.floor(new Date(2026, 8, 1).getTime() / 1000));
  assert.equal(toGristMonthValue("bidon"), null);
});

test("getMonthBusinessDays exclut week-ends ET jours feries", () => {
  // Mai 2026 : 31 jours, 10 de week-end => 21 jours de semaine, moins QUATRE
  // feries — 1er mai (ven), 8 mai (ven), Ascension le 14 (jeu), lundi de
  // Pentecote le 25. Valeur verifiee contre frenchHolidays.js, pas estimee.
  assert.equal(getMonthBusinessDays("2026-05"), 17);
  // Septembre 2026 : aucun ferie, 30 jours, 8 de week-end.
  assert.equal(getMonthBusinessDays("2026-09"), 22);
});

test("getMonthAvailableDays soustrait les demi-journees d'absence", () => {
  const absences = new Set(["2026-09-01:am", "2026-09-01:pm", "2026-09-02:am"]);
  assert.equal(getMonthBusinessDays("2026-09"), 22);
  assert.equal(getMonthAvailableDays("2026-09", absences), 20.5);
});

test("getMonthShareForRange : la somme sur les semaines du mois vaut 1", () => {
  // Semaines ISO couvrant septembre 2026, bornes [lundi 00:00, lundi suivant 00:00[
  let total = 0;
  for (let monday = new Date(2026, 7, 31); monday < new Date(2026, 9, 5); monday.setDate(monday.getDate() + 7)) {
    const start = new Date(monday);
    const end = new Date(monday);
    end.setDate(end.getDate() + 7);
    total += getMonthShareForRange("2026-09", start, end, null);
  }
  assert.ok(Math.abs(total - 1) < 1e-9, `somme des parts = ${total}`);
});

test("getMonthShareForRange retombe sur les jours ouvres si absent tout le mois", () => {
  const allSeptember = new Set();
  for (let day = 1; day <= 30; day += 1) {
    const key = `2026-09-${String(day).padStart(2, "0")}`;
    allSeptember.add(`${key}:am`);
    allSeptember.add(`${key}:pm`);
  }
  const share = getMonthShareForRange(
    "2026-09",
    new Date(2026, 8, 1),
    new Date(2026, 8, 8),
    allSeptember
  );
  assert.ok(share > 0, "la charge ne doit pas disparaitre en silence");
});

test("getMonthShareForRange vaut 0 hors du mois", () => {
  assert.equal(getMonthShareForRange("2026-09", new Date(2026, 9, 1), new Date(2026, 9, 8), null), 0);
});
```

- [ ] **Step 3 : Vérifier que le test échoue**

```bash
cd planning-synchro && node --test tests/monthSegments.test.mjs
```

Attendu : ÉCHEC — `Cannot find module .../assets/js/utils/monthSegments.js`.

- [ ] **Step 4 : Écrire le module**

Créer `planning-synchro/assets/js/utils/monthSegments.js` :

```js
// Modele « un segment = un mois » — noyau pur du plan de charge previsionnel.
//
// COPIE IDENTIQUE OCTET POUR OCTET dans :
//   gestion-depenses2/assets/js/utils/monthSegments.js
//   planning-synchro/assets/js/utils/monthSegments.js
//   Gestion-User/assets/js/monthSegments.js
// Verrouille par shared/tests/vendored-charge-modules-parity.test.cjs : toute
// modification doit etre repercutee dans les trois fichiers.
//
// CONTRAINTE DE PORTABILITE : ce module n'importe QUE ./leaveAbsences.js, seul
// fichier present au meme chemin relatif dans les trois widgets. Il ne peut donc
// pas s'appuyer sur les utilitaires locaux (utils/format.js chez les deux
// widgets de charge, utils.js chez Gestion-User) — d'ou la duplication assumee
// de getMonthKeyFromRawMonth, qui existe deja dans
// gestion-depenses2/assets/js/utils/format.js pour TimeReal / Timesheet.
//
// Aucun DOM, aucun appel Grist : testable sous `node --test`.

import { availableDaysAfterLeave } from "./leaveAbsences.js";

const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

function toMonthKey(year, monthNumber) {
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

export function monthKeyFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return toMonthKey(date.getFullYear(), date.getMonth() + 1);
}

// Tolere Date, epoch (secondes ou millisecondes), "YYYY-MM", "YYYY-MM-DD",
// "MM/YYYY". Meme contrat que format.js pour TimeReal.Mois.
export function getMonthKeyFromRawMonth(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) return monthKeyFromDate(value);

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    const timestamp = value > 1e11 ? value : value * 1000;
    return monthKeyFromDate(new Date(timestamp));
  }

  const text = String(value).trim();
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;

  const frenchMatch = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (frenchMatch) {
    const monthNumber = Number(frenchMatch[1]);
    if (monthNumber >= 1 && monthNumber <= 12) {
      return toMonthKey(Number(frenchMatch[2]), monthNumber);
    }
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : monthKeyFromDate(date);
}

// Mois d'une ligne TimeSegment : `Mois` d'abord, repli legacy sur `Start_At`.
// Devient naturellement inerte le jour ou Start_At disparait de la table : la
// cellule vaut alors undefined et getMonthKeyFromRawMonth renvoie "".
export function resolveSegmentMonthKey(row, columns) {
  return (
    getMonthKeyFromRawMonth(row?.[columns?.mois]) ||
    getMonthKeyFromRawMonth(row?.[columns?.startDate]) ||
    ""
  );
}

// [1er du mois 00:00:00.000, dernier jour du mois 23:59:59.999], heure locale.
export function getMonthBounds(monthKey) {
  const match = MONTH_KEY_PATTERN.exec(String(monthKey ?? ""));
  if (!match) return null;

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;

  return {
    startAt: new Date(year, monthNumber - 1, 1, 0, 0, 0, 0),
    // Jour 0 du mois suivant = dernier jour du mois courant.
    endAt: new Date(year, monthNumber, 0, 23, 59, 59, 999),
  };
}

// Valeur ecrite dans la colonne Grist `Mois` (type Date) : epoch en SECONDES du
// 1er du mois, comme toGristMonthValue de format.js pour TimeReal.
export function toGristMonthValue(monthKey) {
  const bounds = getMonthBounds(monthKey);
  return bounds ? Math.floor(bounds.startAt.getTime() / 1000) : null;
}

// Jours ouvres du mois : week-ends ET jours feries exclus. absenceSet null =>
// availableDaysAfterLeave renvoie la geometrie brute (cf. son garde-fou).
export function getMonthBusinessDays(monthKey) {
  const bounds = getMonthBounds(monthKey);
  return bounds ? availableDaysAfterLeave(bounds.startAt, bounds.endAt, null) : 0;
}

// Jours reellement disponibles : jours ouvres moins les demi-journees d'absence.
export function getMonthAvailableDays(monthKey, absenceSet) {
  const bounds = getMonthBounds(monthKey);
  return bounds ? availableDaysAfterLeave(bounds.startAt, bounds.endAt, absenceSet) : 0;
}

// Part du mois couverte par [rangeStart, rangeEnd], ponderee par la
// disponibilite reelle de la personne. Gestion-User s'en sert pour etaler
// l'effectif mensuel sur ses semaines ISO : somme des parts sur toutes les
// semaines touchant le mois == 1.
//
// REPLI : si la personne est absente TOUT le mois, la ponderation par
// disponibilite vaudrait 0/0 et la charge disparaitrait sans bruit. On retombe
// alors sur une ponderation en jours ouvres (aveugle aux conges) pour que les
// jours planifies restent visibles quelque part — l'incoherence, elle, est deja
// signalee en rouge dans les widgets d'edition.
export function getMonthShareForRange(monthKey, rangeStart, rangeEnd, absenceSet) {
  const bounds = getMonthBounds(monthKey);
  if (!bounds) return 0;
  if (!(rangeStart instanceof Date) || !(rangeEnd instanceof Date)) return 0;

  const overlapStart = rangeStart > bounds.startAt ? rangeStart : bounds.startAt;
  const overlapEnd = rangeEnd < bounds.endAt ? rangeEnd : bounds.endAt;
  if (overlapEnd <= overlapStart) return 0;

  const monthAvailable = availableDaysAfterLeave(bounds.startAt, bounds.endAt, absenceSet);
  if (monthAvailable > 0) {
    return availableDaysAfterLeave(overlapStart, overlapEnd, absenceSet) / monthAvailable;
  }

  const monthBusiness = availableDaysAfterLeave(bounds.startAt, bounds.endAt, null);
  if (monthBusiness <= 0) return 0;
  return availableDaysAfterLeave(overlapStart, overlapEnd, null) / monthBusiness;
}
```

- [ ] **Step 5 : Vérifier que le test passe**

```bash
cd planning-synchro && node --test tests/monthSegments.test.mjs
```

Attendu : 9 tests PASS. Les constantes 17 (mai 2026) et 22 (septembre 2026) ont été
vérifiées contre `frenchHolidays.js` avant rédaction du plan — un échec sur l'une d'elles
signale un bug dans `monthSegments.js`, **pas** une constante à ajuster.

- [ ] **Step 6 : Propager les copies identiques**

```bash
cd "<repo>"
cp planning-synchro/assets/js/utils/monthSegments.js gestion-depenses2/assets/js/utils/monthSegments.js
cp planning-synchro/assets/js/utils/monthSegments.js Gestion-User/assets/js/monthSegments.js
cp planning-synchro/tests/monthSegments.test.mjs      gestion-depenses2/tests/monthSegments.test.mjs
```

Le test copié pointe sur `../assets/js/utils/monthSegments.js` : ce chemin est valide dans `gestion-depenses2` aussi, aucune retouche.

- [ ] **Step 7 : Écrire le test de parité**

Créer `shared/tests/vendored-charge-modules-parity.test.cjs` :

```js
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
```

- [ ] **Step 8 : Vérifier l'ensemble**

```bash
cd "<repo>"
node --test "shared/tests/**/*.test.cjs"
cd gestion-depenses2 && node --test "tests/**/*.test.mjs"
cd ../planning-synchro && node --test "tests/**/*.test.mjs"
```

Attendu : tout au vert, dont les 3 tests de parité et les 9 tests `monthSegments` × 2 widgets. **Ne rien commiter.**

---

### Task 2 : `gestion-depenses2` — lecture du mois et agrégation

**Files:**
- Modify: `gestion-depenses2/assets/js/config.js:147-158`
- Modify: `gestion-depenses2/assets/js/utils/timeSegments.js:174-267`
- Modify: `gestion-depenses2/assets/js/services/projectService.js:629-672`
- Test: `gestion-depenses2/tests/chargeAggregation.test.mjs` (nouveau)

**Interfaces:**
- Consumes: `resolveSegmentMonthKey`, `getMonthBounds`, `getMonthBusinessDays` (Task 1).
- Produces: `segment.monthKey` (`"YYYY-MM"`) porté par chaque segment prévisionnel ; `worker.provisionalDays[monthKey]` alimenté directement par `Effectif`. `getSegmentEffectiveDays(segment)` accepte désormais un segment portant `monthKey`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `gestion-depenses2/tests/chargeAggregation.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSegmentEffectiveDays } from "../assets/js/utils/timeSegments.js";

test("getSegmentEffectiveDays plafonne l'effectif aux jours ouvres du mois", () => {
  // Septembre 2026 : 22 jours ouvres.
  assert.equal(getSegmentEffectiveDays({ monthKey: "2026-09", effectifDays: 8 }), 8);
  assert.equal(getSegmentEffectiveDays({ monthKey: "2026-09", effectifDays: 30 }), 22);
});

test("getSegmentEffectiveDays vaut 0 sans effectif", () => {
  assert.equal(getSegmentEffectiveDays({ monthKey: "2026-09", effectifDays: null }), 0);
  assert.equal(getSegmentEffectiveDays({ monthKey: "2026-09", effectifDays: "" }), 0);
});

test("getSegmentEffectiveDays vaut 0 sans mois resoluble", () => {
  assert.equal(getSegmentEffectiveDays({ monthKey: "", effectifDays: 8 }), 0);
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd gestion-depenses2 && node --test tests/chargeAggregation.test.mjs
```

Attendu : ÉCHEC — le second cas renvoie `30` (l'ancien `getSegmentAllocationDays` lit `segment.allocationDays`/les dates, pas `monthKey`).

- [ ] **Step 3 : Déclarer la colonne**

Dans `gestion-depenses2/assets/js/config.js`, bloc `timeSegment` (~ligne 147), ajouter `mois` juste après `segmentType` :

```js
      timeSegment: {
        id: "id",
        projectNumber: "NumeroProjet",
        name: "Name",
        segmentType: "Segment_Type",
        // Source unique de verite depuis 2026-08 : un segment couvre un mois.
        // startDate/endDate ne sont plus ecrites, seulement lues en repli.
        mois: "Mois",
        startDate: "Start_At",
        endDate: "End_At",
        allocationDays: "Allocation_Days",
        effectif: "Effectif",
        label: "Label",
        service: "Service",
      },
```

- [ ] **Step 4 : Adapter `timeSegments.js`**

Dans `gestion-depenses2/assets/js/utils/timeSegments.js` :

1. Ajouter l'import en tête de fichier, sous les imports existants :

```js
import { getMonthBusinessDays } from "./monthSegments.js";
```

2. Remplacer `getSegmentAllocationDays` et `getSegmentEffectiveDays` (lignes 174-194) par :

```js
// Capacite d'un segment = jours ouvres de son mois (week-ends et feries exclus).
// Depuis le passage au mois, `allocationDays` stocke en base n'est plus lu : il
// reste ecrit pour la lisibilite de la grille Grist, mais la verite est le mois.
export function getSegmentAllocationDays(segment) {
  return getMonthBusinessDays(segment?.monthKey);
}

export function getSegmentEffectiveDays(segment) {
  const allocationDays = getSegmentAllocationDays(segment);
  if (allocationDays <= 0) return 0;

  const rawEffectifDays = segment?.effectifDays ?? segment?.effectif;
  if (rawEffectifDays == null || rawEffectifDays === "") return 0;

  const parsedEffectifDays = Math.max(0, toFiniteNumber(rawEffectifDays, 0));
  return Math.min(allocationDays, parsedEffectifDays);
}
```

3. **Supprimer** `buildMonthSlotCounts` (196-201) et `getSegmentAllocationByMonth` (203-267) : un segment tient dans un seul mois, la répartition multi-mois au plus grand reste n'a plus d'objet.

4. **Supprimer** `buildHalfDaySelectionDates` (269-281) : plus de sélection au demi-jour.

- [ ] **Step 5 : Adapter la lecture dans `projectService.js`**

Dans `gestion-depenses2/assets/js/services/projectService.js` :

1. Remplacer l'import (lignes 12-15) :

```js
import { parseRawDateTime } from "../utils/timeSegments.js";
import { resolveSegmentMonthKey, getMonthBounds } from "../utils/monthSegments.js";
```

2. Remplacer le corps de la boucle `timeSegmentRows` (629-672) par :

```js
  (timeSegmentRows || []).forEach((row) => {
    const rawSegmentType = normalizeLookupText(row?.[columns.timeSegment.segmentType]);
    if (rawSegmentType && rawSegmentType !== "previsionnel") {
      return;
    }

    const worker = workersByProjectPerson.get(
      buildWorkerLookupKey(
        row?.[columns.timeSegment.projectNumber],
        row?.[columns.timeSegment.name]
      )
    );
    if (!worker) return;

    // `Mois` fait foi ; repli sur Start_At pour les lignes anterieures a la
    // bascule, inerte une fois la colonne supprimee de la table.
    const monthKey = resolveSegmentMonthKey(row, columns.timeSegment);
    if (!monthKey) return;

    const bounds = getMonthBounds(monthKey);
    if (!bounds) return;

    const rawEffectifValue = row?.[columns.timeSegment.effectif];
    const hasEffectifValue = !(
      rawEffectifValue == null ||
      (typeof rawEffectifValue === "string" && rawEffectifValue.trim() === "")
    );

    const segment = {
      id: Number(row?.[columns.timeSegment.id]),
      projectTeamLink: worker.id,
      monthKey,
      // startAt/endAt restent derives du mois : toute la geometrie d'affichage
      // (barres, bornes de frise) continue de raisonner en dates.
      startAt: bounds.startAt,
      endAt: bounds.endAt,
      segmentType: "previsionnel",
      effectifDays: hasEffectifValue
        ? Math.max(0, toFiniteNumber(rawEffectifValue, 0))
        : null,
      label: toText(row?.[columns.timeSegment.label]),
    };

    worker.segments.push(segment);

    // Un segment = un mois : la ventilation se reduit a une addition.
    mergeMonthlyDays(
      worker.provisionalDays,
      monthKey,
      getSegmentEffectiveDays(segment)
    );
  });
```

3. Ajouter `getSegmentEffectiveDays` à l'import depuis `../utils/timeSegments.js`.

- [ ] **Step 6 : Vérifier que les tests passent**

```bash
cd gestion-depenses2 && node --test "tests/**/*.test.mjs"
```

Attendu : `chargeAggregation` PASS, aucune régression ailleurs. **Ne rien commiter.**

---

### Task 3 : `gestion-depenses2` — écriture Grist

**Files:**
- Modify: `gestion-depenses2/assets/js/services/gristService.js`
- Test: `gestion-depenses2/tests/gristService.test.mjs`

**Interfaces:**
- Consumes: `toGristMonthValue`, `getMonthBusinessDays` (Task 1).
- Produces: `createTimeSegment({ projectNumber, name, monthKey, effectif, segmentType, label })` et `updateTimeSegment({ segmentId, monthKey, effectif, ... })` — **`startDate`/`endDate` ne sont plus des paramètres acceptés**.

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `gestion-depenses2/tests/gristService.test.mjs` (adapter au style de mock déjà présent dans le fichier — lire les tests existants avant d'écrire) :

```js
test("createTimeSegment ecrit Mois et n'ecrit plus Start_At/End_At", async () => {
  const applied = [];
  installGristMock({
    fetchTable: () => ({
      id: [], NumeroProjet: [], Name: [], Mois: [],
      Allocation_Days: [], Effectif: [], Label: [], Service: [],
    }),
    applyUserActions: (actions) => {
      applied.push(...actions);
      return { retValues: [42] };
    },
  });

  await createTimeSegment({
    projectNumber: "25-0142",
    name: "Marie DUPONT",
    monthKey: "2026-09",
    effectif: 8,
  });

  const [, , , fields] = applied[0];
  assert.equal(fields.Mois, Math.floor(new Date(2026, 8, 1).getTime() / 1000));
  assert.equal(fields.Effectif, 8);
  assert.equal(fields.Allocation_Days, 22);
  assert.ok(!("Start_At" in fields), "Start_At ne doit plus etre ecrite");
  assert.ok(!("End_At" in fields), "End_At ne doit plus etre ecrite");
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd gestion-depenses2 && node --test tests/gristService.test.mjs
```

Attendu : ÉCHEC — `fields.Mois` vaut `undefined`.

- [ ] **Step 3 : Adapter le service**

Dans `gestion-depenses2/assets/js/services/gristService.js` :

1. Importer :

```js
import { toGristMonthValue, getMonthBusinessDays } from "../utils/monthSegments.js";
```

2. Dans `TIME_SEGMENT_COLUMN_ALIASES`, ajouter :

```js
  mois: ["Mois", "Month"],
```

3. Dans `createTimeSegment`, remplacer la construction des champs de dates par :

```js
  const monthValue = toGristMonthValue(monthKey);
  if (!normalizedProjectNumber || !normalizedName || monthValue == null) {
    throw new Error("Segment invalide : numero projet, nom ou mois manquant.");
  }

  const fields = Object.fromEntries(
    Object.entries({
      [columns.projectNumber]: normalizedProjectNumber,
      [columns.name]: normalizedName,
      [columns.mois]: monthValue,
      // Denormalise : ecrit pour la lisibilite de la grille Grist, jamais relu.
      [columns.allocationDays]: getMonthBusinessDays(monthKey),
      [columns.effectif]: toFiniteNumber(effectif, 0),
      [columns.service]: getActiveService(),
    }).filter(([, value]) => value !== undefined)
  );
```

4. Dans `updateTimeSegment`, remplacer les blocs `startDate`/`endDate` par :

```js
  if (monthKey != null) {
    const monthValue = toGristMonthValue(monthKey);
    if (monthValue == null) {
      throw new Error("Mois invalide pour la mise a jour du segment.");
    }
    fields[columns.mois] = monthValue;
    fields[columns.allocationDays] = getMonthBusinessDays(monthKey);
  }
```

5. Retirer `startDate`/`endDate` des signatures déstructurées des deux fonctions, et `allocationDays` de celle d'`updateTimeSegment` (il découle du mois).

- [ ] **Step 4 : Vérifier que les tests passent**

```bash
cd gestion-depenses2 && node --test "tests/**/*.test.mjs"
```

Attendu : tout vert. **Ne rien commiter.**

---

### Task 4 : `gestion-depenses2` — planning et fenêtre

**Files:**
- Modify: `gestion-depenses2/assets/js/ui/chargeTimeline.js:665-782`
- Modify: `gestion-depenses2/assets/js/main.js` (handlers pointeur + modale)
- Modify: `gestion-depenses2/index.html:220-284`
- Modify: `gestion-depenses2/assets/css/styles.css`

**Interfaces:**
- Consumes: `getMonthBounds`, `getMonthBusinessDays`, `getMonthAvailableDays`, `monthKeyFromDate` (Task 1) ; `createTimeSegment`/`updateTimeSegment` nouvelle signature (Task 3).
- Produces: chaque `.charge-plan-segment-bar` porte `data-month-key`. Chaque `.charge-plan-track` réagit au clic en résolvant le mois via le créneau sous le curseur.

- [ ] **Step 1 : Caler les barres sur le mois**

Dans `chargeTimeline.js`, `buildVisibleSegmentBars` : remplacer la lecture de `segment.startAt/endAt` par les bornes du mois, et retirer le calcul d'incohérence basé sur la plage :

```js
      const bounds = getMonthBounds(segment?.monthKey);
      if (!bounds) return null;

      const slotRange = getVisibleSlotRange(bounds.startAt, bounds.endAt, visibleSlots);
      if (!slotRange) return null;

      const effectiveDays = getSegmentEffectiveDays(segment);
      const label = segment?.label || `${formatDayValue(effectiveDays)} j`;
      const rawEffectif = segment?.effectifDays ?? null;
      const available = getMonthAvailableDays(segment.monthKey, absenceSet);
      const incoherent = rawEffectif != null && Number(rawEffectif) > available;
```

Ajouter `monthKey: segment.monthKey` à l'objet retourné, et `data-month-key="${escapeHtml(bar.monthKey)}"` dans `renderSegmentBars`.

- [ ] **Step 2 : Retirer les poignées**

Dans `renderSegmentBars`, supprimer les deux `<span class="charge-plan-segment-handle …">`. Dans `styles.css`, supprimer les règles `.charge-plan-segment-handle` et ajouter le surlignage de mois :

```css
/* Survol : le mois entier sous le curseur s'eclaire, puisque c'est l'unite de
   creation depuis le passage de TimeSegment au mois. */
.charge-plan-month-hover {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(0, 73, 144, 0.08);
  border-left: 1px solid rgba(0, 73, 144, 0.25);
  border-right: 1px solid rgba(0, 73, 144, 0.25);
  pointer-events: none;
}

.charge-plan-selection-preview.is-provisional {
  background-image: repeating-linear-gradient(
    45deg, rgba(0, 73, 144, 0.18) 0 6px, transparent 6px 12px
  );
}
```

- [ ] **Step 3 : Remplacer le geste dans `main.js`**

Dans `handleChargePlanPointerDown` (5330) : conserver intégralement le bloc `headerTrack` (pan) et le garde-fou `isChargePlanSegmentEditModeLocked`. Remplacer tout ce qui suit la résolution de `trackEl` par :

```js
  if (!trackEl || trackEl.classList.contains("charge-plan-track--readonly")) return;

  event.preventDefault();

  const slotIndex = getChargePlanSlotIndexAtClientX(trackEl, event.clientX);
  const selection = computeChargePlanSelectionFromSlotIndexes(trackEl, slotIndex, slotIndex);
  const monthKey = selection ? monthKeyFromDate(new Date(selection.startDate)) : "";
  if (!monthKey) return;

  const workerId = Number(trackEl.dataset.workerId);
  if (!Number.isInteger(workerId)) return;

  // Un segment = un mois : le mois deja occupe s'edite, il ne se double pas.
  const existingBar = trackEl.querySelector(
    `.charge-plan-segment-bar[data-month-key="${monthKey}"]`
  );
  if (existingBar instanceof HTMLElement) {
    openEditChargePlanModal(Number(existingBar.dataset.segmentId), boardEl);
    return;
  }

  openCreateChargePlanModal({ workerId, monthKey, boardEl, trackEl });
```

Supprimer `handleChargePlanPointerMove`'s branche `chargeTimelineDrag` (garder la branche `chargePlanPan`), supprimer `handleChargePlanPointerUp`'s branche `chargeTimelineDrag`, et supprimer `resizeChargePlanSegment`, `selectionOverlapsWorkerSegments`, `annotateChargePlanSelection`, `cancelChargePlanSegmentDrag` ainsi que la variable `chargeTimelineDrag`.

- [ ] **Step 4 : Cycle création-à-la-validation**

Ajouter dans `main.js`, à côté d'`openEditChargePlanModal` :

```js
// Creation : on affiche une barre provisoire et on n'ecrit RIEN tant que
// l'utilisateur n'a pas valide la fenetre (cf. spec §6). Annuler ne laisse
// aucune ligne derriere lui.
function openCreateChargePlanModal({ workerId, monthKey, boardEl, trackEl }) {
  const worker = getSelectedProjectWorker(workerId);
  if (!worker) return;

  editingChargePlanSegment = {
    projectId: Number(getSelectedProject()?.id),
    boardEl,
    trackEl,
    worker,
    segment: null,
    monthKey,
    segmentField: getTimelineSegmentField(boardEl),
    absenceSet: worker.absenceSet instanceof Set ? worker.absenceSet : new Set(),
  };

  showProvisionalChargePlanBar(trackEl, monthKey);
  dom.editSegmentEffectifInput.value = "";
  syncEditChargePlanDerivedValues();
  setEditChargePlanFeedback("");
  openModal(dom.editSegmentModal);
}
```

Ajouter juste au-dessus les deux helpers de la barre provisoire, qui réutilisent
l'aperçu de sélection existant (`.charge-plan-selection-preview`) plutôt que d'ajouter
un élément au DOM :

```js
// Barre provisoire : l'apercu de selection existant, cale sur le mois entier et
// hachure (classe is-provisional). Rien n'est ecrit en base tant que la fenetre
// n'est pas validee — c'est purement visuel.
function showProvisionalChargePlanBar(trackEl, monthKey) {
  const bounds = getMonthBounds(monthKey);
  if (!(trackEl instanceof HTMLElement) || !bounds) return;

  const slots = getChargePlanTrackSlots(trackEl);
  const firstSlot = slots.find((slot) => slot.startAt >= bounds.startAt);
  const lastSlot = [...slots].reverse().find((slot) => slot.endAt <= bounds.endAt);
  if (!firstSlot || !lastSlot) return;

  const previewEl = trackEl.querySelector(".charge-plan-selection-preview");
  const labelEl = previewEl?.querySelector(".charge-plan-selection-label");
  if (!(previewEl instanceof HTMLElement)) return;

  previewEl.hidden = false;
  previewEl.classList.add("is-provisional");
  previewEl.style.left = `${firstSlot.leftPx}px`;
  previewEl.style.width = `${lastSlot.leftPx + lastSlot.widthPx - firstSlot.leftPx}px`;
  if (labelEl instanceof HTMLElement) labelEl.textContent = "";
}

function clearProvisionalChargePlanBar(trackEl) {
  const previewEl = trackEl?.querySelector(".charge-plan-selection-preview");
  if (previewEl instanceof HTMLElement) previewEl.classList.remove("is-provisional");
  clearChargePlanSelectionPreview(trackEl);
}
```

`getChargePlanTrackSlots` n'existe pas encore : l'exporter depuis
`ui/chargeTimeline.js` un accesseur sur la `WeakMap` interne déjà présente
(`activeVisibleSlotsByBoard`), en réutilisant sa fonction privée `getTrackSlots` :

```js
export function getChargePlanTrackSlots(trackEl) {
  return getTrackSlots(trackEl);
}
```

`saveEditedChargePlanSegment` bascule sur `createTimeSegment({ projectNumber, name,
monthKey, effectif })` quand `editingChargePlanSegment.segment` est `null`, sur
`updateChargePlanSegmentSelection` sinon. `resetEditChargePlanForm` appelle
`clearProvisionalChargePlanBar(editingChargePlanSegment?.trackEl)` **avant** de remettre
`editingChargePlanSegment` à `null`.

Remplacer la validation d'effectif (1688-1703) par la règle stricte :

```js
  const rawEffectifInput = parseOptionalNumberInput(dom.editSegmentEffectifInput.value);
  if (rawEffectifInput == null || rawEffectifInput <= 0) {
    setEditChargePlanFeedback("Saisissez un nombre de jours effectifs superieur a 0.");
    return;
  }
  if (!isHalfDayIncrement(rawEffectifInput)) {
    setEditChargePlanFeedback(
      "Le nombre de jours effectifs doit etre un entier ou un multiple de 0,5."
    );
    return;
  }
```

`syncEditChargePlanDerivedValues` lit désormais `editingChargePlanSegment.monthKey` au lieu des quatre champs de dates, et affiche `getMonthAvailableDays(monthKey, absenceSet)`.

- [ ] **Step 5 : Simplifier la fenêtre**

Dans `index.html`, dans `#edit-segment-modal` : supprimer tout le `<div class="segment-edit-grid">` (les 4 champs Début/Période/Fin/Période), et insérer sous le titre :

```html
                    <p class="segment-edit-context">
                        <span id="edit-segment-month-label"></span>
                        <span id="edit-segment-worker-label"></span>
                    </p>
```

Renommer le libellé : `Jours disponibles dans la plage` → `Jours disponibles dans le mois`. Ajouter `min="0.5"` sur `#edit-segment-effectif`. Retirer de `dom` (`ui/dom.js`) les références `editSegmentStartDateInput`, `editSegmentStartPartInput`, `editSegmentEndDateInput`, `editSegmentEndPartInput`, et ajouter `editSegmentMonthLabel`, `editSegmentWorkerLabel`.

- [ ] **Step 6 : Vérifier**

```bash
cd gestion-depenses2 && node --test "tests/**/*.test.mjs"
```

Puis contrôle visuel : servir le repo (`python -m http.server 8790`) et ouvrir le widget. Vérifier : clic sur un mois vide → barre hachurée + fenêtre ; `Annuler` → rien en base ; `Enregistrer` avec 8 → barre « 8 j » sur tout le mois ; clic sur ce mois → fenêtre pré-remplie ; `Effectif` vide → message bloquant. **Ne rien commiter.**

---

### Task 5 : `planning-synchro` — données, bornes et écriture

**Files:**
- Modify: `planning-synchro/assets/js/config.js:40-44`
- Modify: `planning-synchro/assets/js/bottom/chargeBoard.js:104-149, 464-561`
- Modify: `planning-synchro/assets/js/top/bounds.js`
- Modify: `planning-synchro/assets/js/services/gristService.js`
- Modify: `planning-synchro/dev/fixtures.js`
- Test: `planning-synchro/tests/{chargeWorkers,segmentBounds,gristService}.test.mjs`

**Interfaces:**
- Consumes: Task 1 dans son intégralité.
- Produces: `worker.segments[]` porte `{ id, monthKey, startAt, endAt, effectif, label }` ; `computeTimeSegmentBounds(rows, cols)` calcule ses bornes depuis `Mois`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `planning-synchro/tests/chargeWorkers.test.mjs`, ajouter :

```js
test("buildWorkersFromSegments lit Mois et derive les bornes du mois", () => {
  const workers = buildWorkersFromSegments(
    [{ id: 1, NumeroProjet: "25-0142", Name: "Marie DUPONT", Mois: "2026-09-01", Effectif: 8 }],
    [{ NumeroProjet: "25-0142", Name: "Marie DUPONT", Role: "Projeteur" }],
    { timeSegment: COLS.timeSegment, projectTeam: COLS.projectTeam }
  );
  const [segment] = workers[0].segments;
  assert.equal(segment.monthKey, "2026-09");
  assert.equal(segment.startAt.getDate(), 1);
  assert.equal(segment.endAt.getDate(), 30);
  assert.equal(segment.effectif, 8);
});

test("buildWorkersFromSegments retombe sur Start_At pour les lignes legacy", () => {
  const workers = buildWorkersFromSegments(
    [{ id: 2, NumeroProjet: "25-0142", Name: "Marie DUPONT", Start_At: "2026-09-17", Effectif: 3 }],
    [], { timeSegment: COLS.timeSegment, projectTeam: COLS.projectTeam }
  );
  assert.equal(workers[0].segments[0].monthKey, "2026-09");
});
```

Dans `segmentBounds.test.mjs` :

```js
test("computeTimeSegmentBounds couvre les mois presents", () => {
  const bounds = computeTimeSegmentBounds(
    [{ Mois: "2026-09-01" }, { Mois: "2026-11-01" }],
    { mois: "Mois", startDate: "Start_At" }
  );
  assert.equal(bounds.startDate, "2026-09-01");
  assert.equal(bounds.endDate, "2026-11-30");
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
cd planning-synchro && node --test tests/chargeWorkers.test.mjs tests/segmentBounds.test.mjs
```

Attendu : ÉCHEC (`segment.monthKey` est `undefined`).

- [ ] **Step 3 : Déclarer la colonne**

Dans `planning-synchro/assets/js/config.js` :

```js
      timeSegment: {
        id: "id", projectNumber: "NumeroProjet", name: "Name",
        // Source unique de verite ; startDate/endDate lues en repli seulement.
        mois: "Mois", startDate: "Start_At", endDate: "End_At",
        allocationDays: "Allocation_Days", effectif: "Effectif", label: "Label", service: "Service",
      },
```

- [ ] **Step 4 : Adapter `chargeBoard.js`**

Importer `resolveSegmentMonthKey`, `getMonthBounds` depuis `../utils/monthSegments.js`. Dans `buildWorkersFromSegments`, remplacer le bloc de parsing des dates par :

```js
    const monthKey = resolveSegmentMonthKey(row, tsCols);
    const bounds = getMonthBounds(monthKey);
    if (!bounds) return;

    worker.segments.push({
      id: row?.[tsCols.id] ?? `s-${segmentSeq++}`,
      monthKey,
      startAt: bounds.startAt,
      endAt: bounds.endAt,
      effectif: normalizeDecimal(row?.[tsCols.effectif]),
      label: toText(row?.[tsCols.label]),
    });
```

Remplacer `computeMonthTotalDays` (507-523) et supprimer `segmentBusinessDaysInRange` (495-503) :

```js
// Un segment = un mois : le total mensuel est une somme, plus un prorata.
function computeMonthTotalDays(workers, month) {
  let total = 0;
  (workers || []).forEach((worker) => {
    (worker?.segments || []).forEach((segment) => {
      if (segment?.monthKey !== month.key) return;
      total += getSegmentEffectiveDays(segment);
    });
  });
  return Math.round(total * 100) / 100;
}
```

Dans `buildVisibleSegmentBars`, remplacer `availableDaysAfterLeave(segment.startAt, segment.endAt, absenceSet)` par `getMonthAvailableDays(segment.monthKey, absenceSet)`, et ajouter `data-month-key` à la barre. Retirer les deux `<span class="charge-plan-segment-handle …">`.

- [ ] **Step 5 : Adapter `utils/timeSegments.js`**

`chargeBoard.js` importe `getSegmentEffectiveDays` / `getSegmentAllocationDays` depuis
`../utils/timeSegments.js` — cette copie doit basculer sur le mois **exactement comme
celle de `gestion-depenses2` en Task 2**, sinon la ligne Total et le libellé des barres
resteraient calculés sur les dates. Ajouter l'import :

```js
import { getMonthBusinessDays } from "./monthSegments.js";
```

puis remplacer les deux fonctions :

```js
// Capacite d'un segment = jours ouvres de son mois (week-ends et feries exclus).
export function getSegmentAllocationDays(segment) {
  return getMonthBusinessDays(segment?.monthKey);
}

export function getSegmentEffectiveDays(segment) {
  const allocationDays = getSegmentAllocationDays(segment);
  if (allocationDays <= 0) return 0;

  const rawEffectifDays = segment?.effectifDays ?? segment?.effectif;
  if (rawEffectifDays == null || rawEffectifDays === "") return 0;

  const parsedEffectifDays = Math.max(0, toFiniteNumber(rawEffectifDays, 0));
  return Math.min(allocationDays, parsedEffectifDays);
}
```

`getBusinessHalfDaySlotsBetween` reste utilisée par `leaveAbsences.js` et la grille :
ne pas la supprimer.

- [ ] **Step 6 : Adapter `bounds.js` et `gristService.js`**

Remplacer le corps de `computeTimeSegmentBounds` dans `top/bounds.js` :

```js
import { resolveSegmentMonthKey, getMonthBounds } from "../utils/monthSegments.js";
import { formatIsoDate } from "../utils/dates.js";

// Bornes de la frise cote previsionnel : du 1er jour du plus petit mois au
// dernier jour du plus grand. Les monthKey "YYYY-MM" se comparent
// lexicographiquement, donc un simple min/max de chaines suffit.
export function computeTimeSegmentBounds(rows, columns) {
  let minMonthKey = "";
  let maxMonthKey = "";

  (rows || []).forEach((row) => {
    const monthKey = resolveSegmentMonthKey(row, columns);
    if (!monthKey) return;
    if (!minMonthKey || monthKey < minMonthKey) minMonthKey = monthKey;
    if (!maxMonthKey || monthKey > maxMonthKey) maxMonthKey = monthKey;
  });

  if (!minMonthKey || !maxMonthKey) return null;

  return {
    startDate: formatIsoDate(getMonthBounds(minMonthKey).startAt),
    endDate: formatIsoDate(getMonthBounds(maxMonthKey).endAt),
  };
}
```

`gristService.js` : mêmes modifications qu'en Task 3 (alias `mois`, `toGristMonthValue`, `getMonthBusinessDays`, suppression des paramètres `startDate`/`endDate`).

- [ ] **Step 7 : Mettre les fixtures au mois**

Dans `dev/fixtures.js`, remplacer chaque `Start_At`/`End_At` de `TimeSegment` par un `Mois` (1er du mois, epoch secondes) et garantir un `Effectif > 0` sur chaque ligne. **Conserver volontairement une ligne legacy** avec `Start_At` seul, pour que le harnais exerce le repli.

- [ ] **Step 8 : Vérifier**

```bash
cd planning-synchro && node --test "tests/**/*.test.mjs"
```

Attendu : tout vert. **Ne rien commiter.**

---

### Task 6 : `planning-synchro` — interaction et fenêtre

**Files:**
- Modify: `planning-synchro/assets/js/bottom/chargeEditing.js`
- Modify: `planning-synchro/assets/js/bottom/editSegmentModal.js`
- Modify: `planning-synchro/index.html:88-143`
- Modify: `planning-synchro/assets/css/styles.css`
- Test: `planning-synchro/tests/editSegmentModal.test.mjs`

**Interfaces:**
- Consumes: `data-month-key` sur les barres (Task 5), `createTimeSegment`/`updateTimeSegment` nouvelle signature (Task 5).
- Produces: `createEditSegmentModal(rootEl, { onSubmit })` dont `open({ segmentId, monthKey, workerName, effectif, absenceSet })` accepte `segmentId: null` pour une création ; `onSubmit({ segmentId, monthKey, workerName, selection })` où `selection = { effectifDays, effectifValueForSave }`.

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `planning-synchro/tests/editSegmentModal.test.mjs`, remplacer les tests portant sur `buildEditSegmentSelection` par :

```js
test("validateEditSegmentEffectif exige une valeur strictement positive", () => {
  assert.ok(validateEditSegmentEffectif("").error);
  assert.ok(validateEditSegmentEffectif("0").error);
  assert.ok(validateEditSegmentEffectif("-1").error);
  assert.ok(validateEditSegmentEffectif("2,3").error);
  assert.deepEqual(validateEditSegmentEffectif("3.5"), {
    effectifDays: 3.5,
    effectifValueForSave: 3.5,
  });
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd planning-synchro && node --test tests/editSegmentModal.test.mjs
```

Attendu : ÉCHEC — `validateEditSegmentEffectif("")` renvoie aujourd'hui `{ effectifDays: null, effectifValueForSave: "" }` sans `error`.

- [ ] **Step 3 : Durcir la validation**

Dans `editSegmentModal.js`, remplacer `validateEditSegmentEffectif` :

```js
// Un segment mensuel sans effectif ne represente rien : il compterait 0 jour
// partout tout en occupant une ligne. La valeur est donc obligatoire.
export function validateEditSegmentEffectif(rawEffectifValue) {
  const rawEffectifInput = parseOptionalNumberInput(rawEffectifValue);

  if (rawEffectifInput == null || rawEffectifInput <= 0) {
    return { error: "Saisissez un nombre de jours effectifs superieur a 0." };
  }
  if (!isHalfDayIncrement(rawEffectifInput)) {
    return { error: "Le nombre de jours effectifs doit etre un entier ou un multiple de 0,5." };
  }

  return { effectifDays: rawEffectifInput, effectifValueForSave: rawEffectifInput };
}
```

Supprimer `getSegmentHalfDayPart`, `buildSegmentHalfDayBoundary`, `buildEditSegmentSelection`, `toDateInputValue` et `normalizeOptionalEffectifDays`. `open()` et `syncDerived()` raisonnent sur `monthKey` : `calculatedEl.textContent = formatEditSegmentDayValue(getMonthAvailableDays(currentMonthKey, currentAbsenceSet))`.

- [ ] **Step 4 : Adapter `chargeEditing.js`**

Remplacer `handlePointerDown` par :

```js
  function handlePointerDown(event) {
    if (event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(CONTEXT_MENU_SELECTOR)) return;

    hideContextMenu(boardEl);
    if (!editModeEnabled) return; // garde-fou : rien sans le mode Editer

    const trackEl = event.target.closest(TRACK_SELECTOR);
    if (!(trackEl instanceof HTMLElement)) return;

    const workerName = trackEl.dataset.workerName || "";
    if (!workerName) return;

    event.preventDefault();

    // Un clic vaut le mois entier : on resout le mois du creneau sous le curseur.
    const slots = resolveSlots();
    const slotIndex = getSlotIndexAtClientX(trackEl, slots, event.clientX);
    const slot = slots.find((candidate) => candidate.slotIndex === slotIndex);
    const monthKey = slot ? monthKeyFromDate(slot.startAt) : "";
    if (!monthKey) return;

    // Mois deja occupe -> edition. La cle (projet, personne, mois) etant unique,
    // il n'y a plus de chevauchement possible a controler.
    const existingBar = trackEl.querySelector(
      `${SEGMENT_BAR_SELECTOR}[data-month-key="${cssEscapeValue(monthKey)}"]`
    );

    openSegmentModal({
      segmentId: existingBar instanceof HTMLElement ? existingBar.dataset.segmentId : null,
      monthKey,
      workerName,
      effectif: existingBar instanceof HTMLElement ? existingBar.dataset.effectif ?? "" : "",
    });
  }

  // Ouvre la fenetre en creation (segmentId null) ou en edition. Rien n'est
  // ecrit tant que l'utilisateur n'a pas valide.
  function openSegmentModal({ segmentId, monthKey, workerName, effectif }) {
    if (!editSegmentModal) return;
    editSegmentModal.open({
      segmentId,
      monthKey,
      workerName,
      effectif,
      absenceSet: typeof getAbsenceSet === "function" ? getAbsenceSet(workerName) : undefined,
    });
  }
```

Importer `monthKeyFromDate` depuis `../utils/monthSegments.js`. Supprimer
`handlePointerMove`, `handlePointerUp`, `handlePointerUpSafe`, `trackHasOverlap`,
`annotateOverlap`, `buildSelectionFromSlotIndexes`, `computeSelectionFromClientX`,
`updateSelectionPreview`, `clearSelectionPreview`, `cancelDrag`, la variable `dragState`,
ainsi que les écouteurs `window.addEventListener("pointermove"/"pointerup", …)` **et leurs
retraits dans `detach()`**. `handleModifySegmentPrompt` et le repli `window.prompt`
disparaissent aussi : la fenêtre est désormais le seul chemin d'édition.

Remplacer `handleEditSegmentSubmit` par :

```js
  // Plus de controle de chevauchement : l'unicite (projet, personne, mois) le
  // remplace, et le clic sur un mois occupe edite au lieu de creer.
  async function handleEditSegmentSubmit({ segmentId, monthKey, workerName, selection }) {
    if (!editModeEnabled) {
      return { ok: false, error: "Cliquez sur Editer pour modifier le planning." };
    }

    let writeError = null;
    await persistWrite(async () => {
      try {
        if (segmentId == null) {
          await createTimeSegment({
            projectNumber: typeof getProjectNumber === "function" ? getProjectNumber() : undefined,
            name: workerName,
            monthKey,
            effectif: selection.effectifValueForSave,
          });
        } else {
          await updateTimeSegment({ segmentId, effectif: selection.effectifValueForSave });
        }
      } catch (error) {
        writeError = error;
        throw error;
      }
    });

    if (writeError) return { ok: false, error: "L'enregistrement du segment a echoue." };
    return { ok: true };
  }
```

- [ ] **Step 5 : Simplifier la fenêtre**

Dans `planning-synchro/index.html`, `#ps-edit-segment-modal` : supprimer le `<div class="ps-segment-edit-grid">` des 4 champs, ajouter le rappel mois/personne, renommer le libellé en `Jours disponibles dans le mois`, ajouter `min="0.5"` sur `#ps-edit-segment-effectif`. Reporter dans `styles.css` les mêmes suppressions/ajouts qu'en Task 4 (préfixe `ps-`).

- [ ] **Step 6 : Vérifier**

```bash
cd planning-synchro && node --test "tests/**/*.test.mjs"
python -m http.server 8791
# puis http://localhost:8791/dev/harness.html
```

Dans le harnais : vérifier l'alignement des deux panes au zoom Semaine/Mois/Année, le clic → fenêtre → `AddRecord` dans `window.__appliedActions`, et que la ligne legacy (Task 5 Step 6) s'affiche toujours. **Ne rien commiter.**

---

### Task 7 : `Gestion-User` — données mensuelles et index d'absences

**Files:**
- Modify: `Gestion-User/assets/js/config.js`
- Modify: `Gestion-User/assets/js/dataService.js:78-105, 152-185`
- Create: `Gestion-User/tests/dataService.test.mjs`

**Interfaces:**
- Consumes: `resolveSegmentMonthKey` (Task 1), `buildAbsenceIndex`/`normalizeName` (`./leaveAbsences.js`, vendorisé en Task 1).
- Produces: `loadGestionUserData()` renvoie `{ employees, projects, segments, segmentsByEmployee, absencesByEmployee }` où chaque segment vaut `{ employeeName, employeeKey, absenceKey, monthKey, effectif, projectNumber }` et `absencesByEmployee` est une `Map<absenceKey, Set<slotKey>>`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `Gestion-User/tests/dataService.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSegments } from "../assets/js/dataService.js";

const TABLE = { id: [], Name: [], Mois: [], Effectif: [], NumeroProjet: [] };

test("buildSegments produit des segments mensuels", () => {
  const [segment] = buildSegments(TABLE, [
    { id: 1, Name: "Marie DUPONT", Mois: "2026-09-01", Effectif: 8, NumeroProjet: "25-0142" },
  ]);
  assert.equal(segment.monthKey, "2026-09");
  assert.equal(segment.effectif, 8);
  assert.equal(segment.projectNumber, "25-0142");
});

test("buildSegments ignore les lignes sans mois ou sans effectif", () => {
  assert.equal(buildSegments(TABLE, [{ Name: "X", Effectif: 8 }]).length, 0);
  assert.equal(buildSegments(TABLE, [{ Name: "X", Mois: "2026-09-01" }]).length, 0);
  assert.equal(buildSegments(TABLE, [{ Name: "X", Mois: "2026-09-01", Effectif: 0 }]).length, 0);
});

test("buildSegments porte une absenceKey qui preserve les traits d'union", () => {
  const [segment] = buildSegments(TABLE, [
    { Name: "Jean-Pierre DUPONT", Mois: "2026-09-01", Effectif: 4 },
  ]);
  // La cle interne ecrase la ponctuation, celle d'absence non : les deux doivent
  // coexister, sinon les conges des prenoms composes seraient ignores.
  assert.equal(segment.employeeKey, "jean pierre dupont");
  assert.equal(segment.absenceKey, "jean-pierre dupont");
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd Gestion-User && node --test tests/dataService.test.mjs
```

Attendu : ÉCHEC — `buildSegments` n'est pas exportée.

- [ ] **Step 3 : Déclarer table et colonnes**

Dans `Gestion-User/assets/js/config.js` :

```js
export const TABLES = {
  timeSegment: "TimeSegment",
  team: "Team",
  projects: "Projets2",
  timeOut: "Time-Out",
};

export const ABSENCE_TYPES = ["Congé Payé", "Congé Non Payé", "RTT", "Congé Parental"];
```

Dans `COLUMN_CANDIDATES.timeSegment`, ajouter `mois: ["Mois", "Month"]` et **conserver** `startAt` (repli legacy). Ajouter le bloc :

```js
  timeOut: {
    owner: ["Owner"],
    startDate: ["Start_Date", "StartDate"],
    startPeriod: ["Start_Period", "StartPeriod"],
    endDate: ["End_Date", "EndDate"],
    endPeriod: ["End_Period", "EndPeriod"],
    type: ["Type"],
  },
```

- [ ] **Step 4 : Adapter `dataService.js`**

Exporter `buildSegments` et la réécrire :

```js
export function buildSegments(timeSegmentTable, segmentRows) {
  const columns = resolveColumns(timeSegmentTable, COLUMN_CANDIDATES.timeSegment);

  return segmentRows
    .map((row) => {
      const employeeName = toText(getCell(row, columns.employeeName));
      if (!employeeName) return null;

      // `Mois` fait foi, repli legacy sur Start_At (cf. spec §3).
      const monthKey = resolveSegmentMonthKey(
        { mois: getCell(row, columns.mois), startDate: getCell(row, columns.startAt) },
        { mois: "mois", startDate: "startDate" }
      );
      if (!monthKey) return null;

      // `Effectif` est desormais LA charge (et non plus Allocation_Days) :
      // c'est ce que gestion-depenses2 comptait deja de son cote.
      const effectif = parseFrenchNumber(getCell(row, columns.effectif));
      if (!(effectif > 0)) return null;

      return {
        employeeName,
        employeeKey: normalizePersonName(employeeName),
        // normalizePersonName ecrase la ponctuation, normalizeName la conserve :
        // l'index d'absences est cle par la seconde. Sans cette cle dediee, les
        // conges de tous les prenoms composes seraient ignores en silence.
        absenceKey: normalizeName(employeeName),
        monthKey,
        effectif,
        projectNumber: toText(getCell(row, columns.projectNumber)) || "Sans projet",
      };
    })
    .filter(Boolean);
}
```

Dans `buildEmployees`, ajouter `absenceKey: normalizeName(fullName)` à chaque employé, à
côté de `key`.

Ajouter la lecture de `Time-Out` dans `dataService.js` :

```js
// Grist mappe `Time-Out` (avec tiret) sur un id de table `Time_Out` selon les
// documents ; certains utilisent `TimeOut`. On essaie les trois et on garde le
// premier qui repond — meme approche que planning-synchro/services/gristService.js.
async function fetchTimeOutRows() {
  for (const tableId of ["Time-Out", "Time_Out", "TimeOut"]) {
    try {
      const table = await grist.docApi.fetchTable(tableId);
      return { table, rows: tableToRows(table) };
    } catch (_error) {
      // table absente sous cet id : on tente le suivant
    }
  }
  return { table: {}, rows: [] };
}
```

puis, dans `loadGestionUserData`, après les trois `fetchTable` existants :

```js
  const { table: timeOutTable, rows: timeOutRows } = await fetchTimeOutRows();

  // Index des absences, cle par leaveAbsences.normalizeName (qui conserve la
  // ponctuation) — d'ou l'absenceKey portee separement par employes et segments.
  const absencesByEmployee = buildAbsenceIndex(
    timeOutRows,
    teamRows,
    resolveColumns(timeOutTable, COLUMN_CANDIDATES.timeOut),
    resolveColumns(teamTable, COLUMN_CANDIDATES.team),
    ABSENCE_TYPES
  );
```

et ajouter `absencesByEmployee` à l'objet retourné.

⚠️ `buildAbsenceIndex` attend un objet colonnes exposant `prenomNom`, `prenom`, `nom` et
`email`. `COLUMN_CANDIDATES.team` de Gestion-User les nomme `fullName`, `firstName`,
`lastName`, `email` : construire l'adaptateur explicitement plutôt que de passer
`resolveColumns(teamTable, …)` tel quel —

```js
  const teamCols = resolveColumns(teamTable, COLUMN_CANDIDATES.team);
  const absenceTeamCols = {
    email: teamCols.email,
    prenomNom: teamCols.fullName,
    prenom: teamCols.firstName,
    nom: teamCols.lastName,
  };
```

— et passer `absenceTeamCols` à `buildAbsenceIndex`. Sans cet adaptateur, aucun owner ne
serait résolu et **toutes les absences seraient silencieusement ignorées**.

- [ ] **Step 5 : Vérifier**

```bash
cd Gestion-User && node --test "tests/**/*.test.mjs"
```

Attendu : 3 tests PASS. **Ne rien commiter.**

---

### Task 8 : `Gestion-User` — capacité par collaborateur et état « Congé »

**Files:**
- Modify: `Gestion-User/assets/js/utilizationService.js:18-30, 90-98, 120-214`
- Modify: `Gestion-User/assets/js/app.js` (rendu de la cellule)
- Modify: `Gestion-User/assets/css/styles.css`
- Test: `Gestion-User/tests/utilization.test.mjs` (nouveau)

**Interfaces:**
- Consumes: `getMonthShareForRange`, `getMonthAvailableDays` (Task 1) ; `absencesByEmployee` (Task 7).
- Produces: `computeWeeklyUtilizationMatrix({ employees, segments, segmentsByEmployee, projects, weeks, absencesByEmployee, … })`. Chaque `weekPercents[weekValue]` reste un nombre ; un nouveau `weekStates[weekValue] === "leave"` marque les semaines à capacité nulle.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `Gestion-User/tests/utilization.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWeeklyUtilizationMatrix } from "../assets/js/utilizationService.js";
import { getWeekRange } from "../assets/js/dateRange.js";

const EMPLOYEE = { key: "marie dupont", absenceKey: "marie dupont", name: "Marie DUPONT", firstName: "Marie", lastName: "DUPONT", service: "Structure", role: "Projeteur" };
const PROJECTS = new Map([["25-0142", { number: "25-0142", name: "Tour A" }]]);

function weeksOf(...values) {
  return values.map((value) => ({ value, label: value, range: getWeekRange(value) }));
}

test("l'effectif mensuel se repartit sur les semaines du mois", () => {
  const segments = [{ employeeKey: EMPLOYEE.key, absenceKey: EMPLOYEE.absenceKey, monthKey: "2026-09", effectif: 22, projectNumber: "25-0142" }];
  const weeks = weeksOf("2026-W37", "2026-W38");
  const [row] = computeWeeklyUtilizationMatrix({
    employees: [EMPLOYEE], segments, projects: PROJECTS, weeks,
    absencesByEmployee: new Map(),
  });

  // 22 jours planifies sur les 22 jours ouvres de septembre = 100 % par semaine.
  weeks.forEach((week) => {
    assert.ok(Math.abs(row.projectRows[0].weekPercents[week.value] - 100) < 0.5);
  });
});

test("une semaine entierement en conge est marquee, pas affichee a 0 %", () => {
  const absences = new Set();
  for (const day of ["07", "08", "09", "10", "11"]) {
    absences.add(`2026-09-${day}:am`);
    absences.add(`2026-09-${day}:pm`);
  }
  const [row] = computeWeeklyUtilizationMatrix({
    employees: [EMPLOYEE],
    segments: [{ employeeKey: EMPLOYEE.key, absenceKey: EMPLOYEE.absenceKey, monthKey: "2026-09", effectif: 8, projectNumber: "25-0142" }],
    projects: PROJECTS,
    weeks: weeksOf("2026-W37"),
    absencesByEmployee: new Map([[EMPLOYEE.absenceKey, absences]]),
  });

  assert.equal(row.totalRow.weekStates["2026-W37"], "leave");
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd Gestion-User && node --test tests/utilization.test.mjs
```

Attendu : ÉCHEC — la matrice ignore `absencesByEmployee` et n'expose pas `weekStates`.

- [ ] **Step 3 : Basculer la capacité côté collaborateur**

Dans `utilizationService.js` :

0. Remplacer les imports de tête de fichier. `getIntersection`, `countWorkingHalfDayUnits`
   et `getRangeCapacityDays` ne sont plus utilisés ici — la disponibilité réelle vient de
   `leaveAbsences.js`, qui gère week-ends, fériés **et** congés en une seule fonction :

```js
import { getMonthShareForRange } from "./monthSegments.js";
import { availableDaysAfterLeave } from "./leaveAbsences.js";
import { compareText, toText } from "./utils.js";
```

1. Remplacer `getSegmentDaysInRange` :

```js
// Un segment couvre un mois : sa charge sur une semaine est la part du mois que
// cette semaine represente, ponderee par la disponibilite reelle de la personne.
function getSegmentDaysInRange(segment, range, absenceSet) {
  return segment.effectif * getMonthShareForRange(segment.monthKey, range.start, range.end, absenceSet);
}
```

2. Retirer `capacityDays` de `getPreparedWeeks` et le calculer par employé :

```js
// La capacite n'est plus une propriete de la semaine mais du couple
// (collaborateur, semaine) : deux personnes n'ont pas les memes conges.
function buildWeekCapacities(weeks, absenceSet) {
  return new Map(
    weeks.map((week) => [
      week.value,
      availableDaysAfterLeave(week.range.start, week.range.end, absenceSet),
    ])
  );
}
```

3. Dans la boucle employé, résoudre `const absenceSet = absencesByEmployee?.get(employee.absenceKey) || new Set();`, construire `weekCapacities`, et pour chaque semaine :

```js
        const capacity = weekCapacities.get(week.value) || 0;
        if (capacity > 0) {
          const days = getSegmentDaysInRange(segment, week.range, absenceSet);
          if (days > 0) row.weekPercents[week.value] += (days / capacity) * 100;
        }
```

4. Construire `weekStates` une fois par employé (identique sur toutes ses lignes, la
   capacité ne dépendant pas du projet) et le poser sur chaque `projectRow` **et** sur le
   `totalRow` :

```js
    // Capacite nulle = semaine entierement feriee ou en conge. On la marque au
    // lieu de la laisser a 0 %, qui se lirait « disponible ».
    const weekStates = Object.fromEntries(
      normalizedWeeks.map((week) => [
        week.value,
        (weekCapacities.get(week.value) || 0) > 0 ? "" : "leave",
      ])
    );
```

Ajouter `weekStates` à l'objet littéral de chaque `row` créé dans `projectRowsByNumber`,
à la ligne `type: "empty"` de repli, et au `totalRow`.

- [ ] **Step 4 : Rendre l'état dans `app.js`**

Là où la cellule affiche `formatPercent(...)`, insérer en amont :

```js
      // Capacite nulle : afficher 0 % laisserait croire que la personne est
      // disponible, alors qu'elle est en conge ou que la semaine est feriee.
      if (row.weekStates?.[week.value] === "leave") {
        return `<div class="utilization-cell is-leave" title="Semaine non travaillee">Congé</div>`;
      }
```

Ajouter dans `styles.css` :

```css
.utilization-cell.is-leave {
  color: #6b7280;
  background: repeating-linear-gradient(45deg, #f3f4f6 0 6px, #e5e7eb 6px 12px);
  font-style: italic;
}
```

- [ ] **Step 5 : Vérifier**

```bash
cd Gestion-User && node --test "tests/**/*.test.mjs"
```

Attendu : 5 tests PASS. Puis contrôle visuel du widget : une personne avec congés Time-Out doit voir ses % monter (capacité réduite) et ses semaines pleines afficher « Congé ». **Ne rien commiter.**

---

### Task 9 : Documentation et vérification d'ensemble

**Files:**
- Modify: `planning-synchro/README.md`
- Modify: `docs/superpowers/specs/2026-08-25-timesegment-mois-design.md` (nom réel du test de parité)

- [ ] **Step 1 : Mettre le README à jour**

Dans `planning-synchro/README.md`, tableau « Tables et colonnes Grist requises », remplacer la ligne `TimeSegment` :

```markdown
| `TimeSegment` | Plan de charge prévisionnel (bas, éditable), filtré par `NumeroProjet` — **un segment couvre un mois entier** | `NumeroProjet`, `Name`, `Mois`, `Effectif`, `Allocation_Days`, `Label` |
```

Puis, dans la section décrivant le mode Editer, remplacer la description de la modale (plage au demi-jour près, contrôle de chevauchement) par le nouveau geste : clic sur un mois, fenêtre « Jours effectifs travaillés », unicité (projet, personne, mois), écriture à la validation.

- [ ] **Step 2 : Aligner le nom du test de parité dans la spec**

La spec §11 annonce `shared/tests/month-segments-parity.test.cjs` ; le fichier créé couvre les trois modules vendorisés et s'appelle `vendored-charge-modules-parity.test.cjs`. Corriger la spec.

- [ ] **Step 3 : Vérification finale**

```bash
cd "<repo>"
node --test "shared/tests/**/*.test.cjs"
cd gestion-depenses2   && node --test "tests/**/*.test.mjs"
cd ../planning-synchro && node --test "tests/**/*.test.mjs"
cd ../Gestion-User     && node --test "tests/**/*.test.mjs"
cd .. && git status
```

Attendu : quatre suites vertes, et un `git status` montrant uniquement les fichiers de ce plan — **aucun commit**, l'utilisateur relit et pousse lui-même.

- [ ] **Step 4 : Recherche de résidus**

```bash
cd "<repo>"
grep -rn "Start_At\|End_At" gestion-depenses2/assets planning-synchro/assets Gestion-User/assets
```

Attendu : uniquement des occurrences de **repli en lecture** (`startDate` dans les `config.js` et `resolveSegmentMonthKey`). Toute occurrence en **écriture** est un oubli à corriger.

```bash
grep -rn "getSegmentAllocationByMonth\|buildHalfDaySelectionDates\|charge-plan-segment-handle" \
  gestion-depenses2 planning-synchro
```

Attendu : aucun résultat.
