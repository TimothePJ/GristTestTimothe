# Charge de référence — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter à `planning-synchro` une ligne « Charge » sous la ligne « Total », qui affiche mois par mois les jours de travail requis par les documents du planning, et une fenêtre pour assigner ces durées par type de document, par zone, ou document par document.

**Architecture:** Trois colonnes sur `Planning_Projet` (`Duree_Projet`, `Duree_Zone`, `Duree_Force`) résolues en cascade à la lecture — jamais stockées résolues. Un module pur `bottom/documentCharge.js` porte toute l'arithmétique (cascade, plage de travail, répartition mensuelle au prorata des jours ouvrés avec report au plus grand reliquat). Le rendu s'ajoute à `bottom/chargeBoard.js` à côté de `renderTotalRow`, et la fenêtre suit le modèle de `bottom/editSegmentModal.js`.

**Tech Stack:** ES modules natifs (pas de bundler, pas de `package.json`), `node --test` (Node v25.7.0), API widget Grist (`grist.docApi.fetchTable` / `applyUserActions`).

**Spec:** [`docs/superpowers/specs/2026-08-28-charge-reference-design.md`](../specs/2026-08-28-charge-reference-design.md)

## Global Constraints

- **Aucun `git commit`, aucun `git push`, aucun `git stash`, aucun `git checkout --` / `git restore`.** L'utilisateur commite lui-même. Un agent a déjà détruit du travail non commité avec un `git checkout --` : pour annuler une mutation de test, **copier avant, restaurer par `cp`, vérifier par `cmp`**.
- **Périmètre : `planning-synchro` uniquement.** Ne pas toucher `gestion-depenses2` ni `Gestion-User`.
- **Ne modifier aucun module vendorisé** : `monthSegments.js`, `monthLoad.js`, `leaveAbsences.js`, `frenchHolidays.js` — copies identiques octet pour octet verrouillées par `shared/tests/vendored-charge-modules-parity.test.cjs`.
- **Ne modifier aucun fichier de `shared/`** hors `shared/tests/`.
- **Ne rien toucher qui influe sur la largeur de contenu ou `dayWidth`** : l'alignement pixel des deux panes est arithmétique et vrai par construction.
- `index.html` et `dev/harness.html` dupliquent le markup des fenêtres : ils doivent rester **identiques** sur ces tranches.
- **Unité** : jours, multiples de 0,5. Une valeur vide, nulle, négative ou non numérique = « non renseignée » et laisse la main au niveau suivant de la cascade.
- **Teintes** (reprises de `Gestion-User`) : `--load-balanced: #d7eccb`, `--load-partial: #edf4fb`, `--load-overload: #ffe1a8`, texte de surcharge `#6d3b00`.
- Le dépôt **mélange les fins de ligne**. Relevé au 2026-08-28 : `chargeBoard.js`, `main.js`, `config.js`, `styles.css`, `index.html`, `dev/harness.html`, `README.md` sont en **CRLF** ; `bottom/editSegmentModal.js` est en **LF**. Les préserver fichier par fichier, et **mesurer avec Node, jamais avec `grep`**.
- Style : commentaires en français, chaînes JS majoritairement sans accents, HTML accentué.
- **Commandes de test** : `cd planning-synchro && node --test "tests/**/*.test.mjs"` · `node --test "shared/tests/**/*.test.cjs"` depuis la racine.

### État de départ à ne pas dégrader

`gestion-depenses2` **138/138** · `planning-synchro` **249 tests / 248 verts / 1 échec** · `Gestion-User` **49/49** · `shared` **163/163**.

⚠️ L'échec de `planning-synchro/tests/phases.test.mjs` (« one coffrage band per task record », `3 !== 2`) est **préexistant et hors périmètre** : le builder vendorisé du pane haut scinde une phase à `new Date()` et la fixture est datée de façon dépassée par l'horloge système. **Ne pas le corriger.** Si une garde est vérifiée par mutation, **comparer toujours à la baseline de la suite concernée** et faire **échouer bruyamment** le script si le motif est introuvable — compter cet échec comme « mutant tué » a déjà fabriqué plusieurs faux verdicts dans ce dépôt.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `assets/js/bottom/documentCharge.js` | **Nouveau, pur.** Cascade, plage de travail, répartition mensuelle, agrégation projet, détection de divergence. Aucun DOM, aucun Grist. |
| `assets/js/bottom/chargeAssignModal.js` | **Nouveau.** Helpers purs (construction de l'arbre, collecte des écritures) + contrôleur DOM de la fenêtre. |
| `assets/js/bottom/chargeBoard.js` | Rendu de la ligne Charge, à côté de `renderTotalRow`. |
| `assets/js/services/gristService.js` | Écriture par lot des trois colonnes dans `Planning_Projet`. |
| `assets/js/config.js` | Déclaration de `dureeProjet` / `dureeZone` / `dureeForce`. |
| `assets/js/main.js` | Transmission de `planningRows` au board, montage de la fenêtre, rafraîchissement après écriture. |
| `index.html` + `dev/harness.html` | Markup de la fenêtre, identiques. |
| `assets/css/styles.css` | Remontée des variables de teinte, ligne Charge, fenêtre. |

---

### Task 1 : Le module pur `documentCharge.js`

**Files:**
- Create: `planning-synchro/assets/js/bottom/documentCharge.js`
- Test: `planning-synchro/tests/documentCharge.test.mjs`

**Interfaces:**
- Consumes : `buildRowPhases(row, columns)` de `../top/phases.js` — renvoie un tableau de phases `{ type, className, start: Date, end: Date, label, taskLabel }`. Une ligne de document porte **au plus une** phase de travail, plus éventuellement un marqueur `type: "demarrage"` de largeur nulle (`start === end`). `isBusinessDay(date)` de `../utils/timeSegments.js`.

⚠️ `buildRowPhases` détecte les en-têtes de zone sur `taskLabel || typeDoc` ; `isDocumentRow` ci-dessous les détecte sur `id2 || typeDoc`. **Ne pas « harmoniser » les deux** : une ligne portant un ID2 mais ni tâche ni type est bien un document (à typer), et l'absence de phase la range naturellement dans « non placé ». Aligner `isDocumentRow` sur `taskLabel` la ferait au contraire disparaître du décompte, en silence.
- Produces :
  - `isDocumentRow(row, columns) -> boolean`
  - `resolveDocumentCharge(row, columns) -> number | null`
  - `getDocumentWorkSpan(row, columns) -> { start: Date, end: Date } | null`
  - `spreadChargeOverMonths(chargeDays, start, end) -> Map<"YYYY-MM", number>`
  - `computeProjectCharge(planningRows, columns) -> { byMonth: Map<"YYYY-MM", number>, unplacedDays: number, totalDays: number, divergences: Array }`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `planning-synchro/tests/documentCharge.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isDocumentRow,
  resolveDocumentCharge,
  getDocumentWorkSpan,
  spreadChargeOverMonths,
  computeProjectCharge,
} from "../assets/js/bottom/documentCharge.js";

const COLS = {
  id: "id",
  id2: "ID2",
  typeDoc: "Type_doc",
  zone: "Zone",
  taskName: "Taches",
  dateLimite: "Date_limite",
  diffCoffrage: "Diff_coffrage",
  diffArmature: "Diff_armature",
  demarragesTravaux: "Demarrages_travaux",
  dureeProjet: "Duree_Projet",
  dureeZone: "Duree_Zone",
  dureeForce: "Duree_Force",
};

test("isDocumentRow ecarte les en-tetes de zone", () => {
  // En-tete de zone reel de l'export : ni ID2 ni Type_doc, seulement Zone.
  assert.equal(isDocumentRow({ Zone: "Zone 1 / BAT BC" }, COLS), false);
  assert.equal(isDocumentRow({ ID2: "3001", Type_doc: "COFFRAGE" }, COLS), true);
  // Un ID2 sans type reste un document (type a renseigner).
  assert.equal(isDocumentRow({ ID2: "3001" }, COLS), true);
});

test("resolveDocumentCharge applique la cascade Force > Zone > Projet", () => {
  const base = { ID2: "1", Type_doc: "COFFRAGE" };
  assert.equal(resolveDocumentCharge({ ...base, Duree_Projet: 2 }, COLS), 2);
  assert.equal(resolveDocumentCharge({ ...base, Duree_Projet: 2, Duree_Zone: 3 }, COLS), 3);
  assert.equal(
    resolveDocumentCharge({ ...base, Duree_Projet: 2, Duree_Zone: 3, Duree_Force: 4 }, COLS),
    4
  );
  assert.equal(resolveDocumentCharge(base, COLS), null);
});

test("une valeur vide, nulle ou negative ne coupe pas la cascade", () => {
  const base = { ID2: "1", Type_doc: "COFFRAGE", Duree_Projet: 2 };
  // Un 0 explicite ne veut PAS dire « zero jour » : il laisse la main au niveau
  // du dessous. Pour dire « ce document ne coute rien », on laisse tout vide.
  assert.equal(resolveDocumentCharge({ ...base, Duree_Zone: 0 }, COLS), 2);
  assert.equal(resolveDocumentCharge({ ...base, Duree_Zone: "" }, COLS), 2);
  assert.equal(resolveDocumentCharge({ ...base, Duree_Zone: null }, COLS), 2);
  assert.equal(resolveDocumentCharge({ ...base, Duree_Zone: -1 }, COLS), 2);
  assert.equal(resolveDocumentCharge({ ...base, Duree_Zone: "bidon" }, COLS), 2);
  // Virgule decimale francaise, comme ailleurs dans le depot.
  assert.equal(resolveDocumentCharge({ ...base, Duree_Zone: "1,5" }, COLS), 1.5);
});

test("getDocumentWorkSpan suit le type de document", () => {
  // COFFRAGE : Date_limite -> Diff_coffrage
  const cof = getDocumentWorkSpan(
    { ID2: "3001", Type_doc: "COFFRAGE", Date_limite: "2026-12-29", Diff_coffrage: "2027-01-12" },
    COLS
  );
  assert.equal(cof.start.getMonth(), 11);
  assert.equal(cof.end.getMonth(), 0);

  // ARMATURES : Diff_coffrage -> Diff_armature
  const arm = getDocumentWorkSpan(
    { ID2: "3201", Type_doc: "ARMATURES", Diff_coffrage: "2027-02-02", Diff_armature: "2027-02-16" },
    COLS
  );
  assert.equal(arm.start.getDate(), 2);
  assert.equal(arm.end.getDate(), 16);

  // Aucune date -> aucune plage. C'est le cas de TOUTES les lignes COFFRAGE de
  // PRD et HOTEL DIEU dans l'export reel.
  assert.equal(getDocumentWorkSpan({ ID2: "1011", Type_doc: "COFFRAGE" }, COLS), null);
});

test("spreadChargeOverMonths repartit au prorata des jours ouvres", () => {
  // 24/08/2026 (lundi) -> 04/09/2026 (vendredi) : 6 jours ouvres en aout
  // (24-28 plus le lundi 31), 4 en septembre.
  const start = new Date(2026, 7, 24);
  const end = new Date(2026, 8, 4);

  // 5 j sur un partage 6/4 -> 3 j / 2 j. C'EST l'assertion qui prouve le
  // prorata : une implementation qui repartirait a parts EGALES rendrait
  // 2,5 / 2,5 et echouerait ici.
  assert.deepEqual([...spreadChargeOverMonths(5, start, end).entries()], [["2026-08", 3], ["2026-09", 2]]);

  // 2 j sur le meme partage -> 1 j / 1 j : le report au plus grand reliquat
  // (0,4 contre 0,6) donne le demi-jour restant a septembre.
  assert.deepEqual([...spreadChargeOverMonths(2, start, end).entries()], [["2026-08", 1], ["2026-09", 1]]);
});

test("la somme des parts vaut exactement la charge", () => {
  // 3 j sur une plage a repartition inegale : le report au plus grand reliquat
  // doit conserver le total au demi-jour pres.
  const spread = spreadChargeOverMonths(3, new Date(2026, 7, 26), new Date(2026, 8, 10));
  const sum = [...spread.values()].reduce((total, value) => total + value, 0);
  assert.equal(sum, 3);
  // Toutes les parts sont des multiples de 0,5.
  [...spread.values()].forEach((value) => {
    assert.equal(Math.abs(value * 2 - Math.round(value * 2)) < 1e-9, true);
  });
});

test("spreadChargeOverMonths ne plafonne PAS a la capacite du mois", () => {
  // La charge est une exigence, pas une allocation : 40 j demandes sur un mois
  // de 22 jours ouvres restent 40 j. C'est justement ce que la couleur signale.
  const spread = spreadChargeOverMonths(40, new Date(2026, 8, 1), new Date(2026, 8, 30));
  assert.equal(spread.get("2026-09"), 40);
});

test("un document realise compte toujours dans la charge", () => {
  // La ligne Charge repond a « combien de travail ce planning represente-t-il »,
  // pas « combien reste-t-il a faire » : un document reput realise garde sa
  // charge, sinon le total du mois s'effondrerait au fil de l'avancement et la
  // couleur virerait au vert sans qu'aucun jour n'ait ete libere.
  const cols = { ...COLS, realise: "Realise" };
  const row = {
    ID2: "3001", Type_doc: "COFFRAGE",
    Date_limite: "2026-09-01", Diff_coffrage: "2026-09-30",
    Duree_Projet: 2, Realise: true,
  };
  assert.equal(computeProjectCharge([row], cols).byMonth.get("2026-09"), 2);
});

test("un document deplace reprend la duree de sa nouvelle zone", () => {
  // Rien n'est « reassigne » : la cascade est resolue A LA LECTURE, donc changer
  // Zone ou Type_doc suffit a changer la charge. C'est tout le benefice de ne
  // jamais stocker la valeur resolue — il n'y a aucun code de migration a tenir.
  const doc = { ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Zone: 2 };
  assert.equal(resolveDocumentCharge(doc, COLS), 2);

  // Deplace en Zone 2, dont le COFFRAGE vaut 5 j. La fenetre ayant ecrit
  // Duree_Zone sur chaque ligne de la zone, le deplacement se traduit par la
  // reecriture de cette colonne — et rien d'autre a synchroniser.
  const moved = { ...doc, Zone: "Zone 2", Duree_Zone: 5 };
  assert.equal(resolveDocumentCharge(moved, COLS), 5);

  // Un document NEUF, sans Duree_Zone encore ecrite, retombe sur le defaut projet.
  const fresh = { ID2: "3002", Type_doc: "COFFRAGE", Zone: "Zone 2", Duree_Projet: 1 };
  assert.equal(resolveDocumentCharge(fresh, COLS), 1);
});

test("computeProjectCharge agrege, compte le non place et detecte la divergence", () => {
  const rows = [
    // En-tete de zone : ignoree.
    { id: 1, Zone: "Zone 1" },
    // Date : reparti sur un mois.
    { id: 2, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1",
      Date_limite: "2026-09-01", Diff_coffrage: "2026-09-30", Duree_Projet: 2 },
    // Sans date : non place.
    { id: 3, ID2: "1011", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 2 },
    // Divergence sur (COFFRAGE) : 3 vs 2.
    { id: 4, ID2: "1021", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 3 },
    // Sans aucune duree : ne compte pas.
    { id: 5, ID2: "3997", Type_doc: "NDC" },
  ];

  const result = computeProjectCharge(rows, COLS);

  assert.equal(result.byMonth.get("2026-09"), 2);
  assert.equal(result.unplacedDays, 5); // 2 (id 3) + 3 (id 4)
  assert.equal(result.totalDays, 7);

  assert.equal(result.divergences.length, 1);
  assert.equal(result.divergences[0].scope, "project");
  assert.equal(result.divergences[0].typeDoc, "COFFRAGE");
  assert.equal(result.divergences[0].kept, 2); // 2 apparait 2 fois, 3 une fois
  assert.deepEqual(result.divergences[0].others.map((entry) => entry.id2), ["1021"]);
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd planning-synchro && node --test tests/documentCharge.test.mjs
```

Attendu : ÉCHEC — `Cannot find module .../bottom/documentCharge.js`.

- [ ] **Step 3 : Écrire le module**

Créer `planning-synchro/assets/js/bottom/documentCharge.js` :

```js
// Charge de reference d'un document de Planning_Projet.
//
// Trois colonnes portent la duree, de la plus generale a la plus precise :
//   Duree_Projet   defaut du type de document pour ce projet
//   Duree_Zone     ce type de document, dans cette zone
//   Duree_Force    ce document precis
// La charge RESOLUE n'est jamais stockee : elle se recalcule a chaque lecture.
// C'est ce qui fait qu'un document deplace (nouveau type, nouvelle zone) est
// reclasse tout seul, sans code de « reassignation » a maintenir.
//
// Module PUR : aucun DOM, aucun appel Grist. Testable sous `node --test`.

import { buildRowPhases } from "../top/phases.js";
import { isBusinessDay } from "../utils/timeSegments.js";

// Une duree lue en base. Vide, nulle, negative ou non numerique => null, ce qui
// laisse la main au niveau suivant de la cascade. Un 0 explicite ne veut donc
// PAS dire « zero jour » : pour cela on laisse les trois colonnes vides.
function readDuration(value) {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Les en-tetes de zone de Planning_Projet n'ont ni ID2 ni Type_doc : elles
// structurent l'affichage et ne representent aucun document.
export function isDocumentRow(row, columns) {
  return Boolean(toText(row?.[columns?.id2]) || toText(row?.[columns?.typeDoc]));
}

export function resolveDocumentCharge(row, columns) {
  return (
    readDuration(row?.[columns?.dureeForce]) ??
    readDuration(row?.[columns?.dureeZone]) ??
    readDuration(row?.[columns?.dureeProjet]) ??
    null
  );
}

// La plage de travail d'un document, telle que le pane haut la dessine deja.
// On reutilise buildRowPhases plutot que de redefinir la regle par type : une
// seconde definition divergerait tot ou tard de celle qui est affichee.
// Le marqueur `demarrage` est de largeur nulle (start === end) : on l'ecarte.
export function getDocumentWorkSpan(row, columns) {
  const phases = buildRowPhases(row, columns) || [];
  const workPhase = phases.find((phase) => phase?.type !== "demarrage" && phase?.start && phase?.end);
  if (!workPhase) return null;
  return { start: workPhase.start, end: workPhase.end };
}

function businessDaysByMonth(start, end) {
  const counts = new Map();
  if (!(start instanceof Date) || !(end instanceof Date)) return counts;

  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last) {
    if (isBusinessDay(cursor)) {
      const key = monthKeyOf(cursor);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return counts;
}

// Repartit `chargeDays` sur les mois traverses par [start, end], au prorata des
// JOURS OUVRES de chaque mois.
//
// On travaille en DEMI-JOURNEES entieres pour que l'arrondi a 0,5 soit exact,
// puis on distribue le reliquat au PLUS GRAND RESTE : sans ce report, arrondir
// chaque mois independamment ferait deriver le total du projet de plusieurs
// jours. C'est l'algorithme que portait getSegmentAllocationByMonth avant la
// bascule de TimeSegment au mois.
//
// Aucun plafonnement a la capacite du mois : la charge est une EXIGENCE, pas une
// allocation. 40 j demandes sur un mois de 22 restent 40 — c'est precisement ce
// que la couleur de la ligne Charge doit signaler.
export function spreadChargeOverMonths(chargeDays, start, end) {
  const result = new Map();
  const charge = readDuration(chargeDays);
  if (charge == null) return result;

  const counts = businessDaysByMonth(start, end);
  const totalBusinessDays = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (totalBusinessDays <= 0) return result;

  const totalHalfDays = Math.round(charge * 2);
  if (totalHalfDays <= 0) return result;

  const entries = [...counts.entries()].map(([key, count], index) => {
    const exact = (count / totalBusinessDays) * totalHalfDays;
    const floor = Math.floor(exact);
    return { key, index, halfDays: floor, remainder: exact - floor };
  });

  let left = totalHalfDays - entries.reduce((sum, entry) => sum + entry.halfDays, 0);
  entries
    .slice()
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach((entry) => {
      if (left <= 0) return;
      entry.halfDays += 1;
      left -= 1;
    });

  entries.forEach((entry) => result.set(entry.key, entry.halfDays / 2));
  return result;
}

// Valeur majoritaire d'un groupe, avec les lignes qui s'en ecartent. La fenetre
// ecrivant toujours TOUT le groupe d'un coup, une divergence ne peut venir que
// d'une edition manuelle dans la grille Grist : autant la rendre visible plutot
// que de la trancher en silence. Majorite plutot que « premiere valeur » pour
// qu'une seule ligne aberrante ne fasse pas basculer tout le groupe.
function pickMajority(entries) {
  const tally = new Map();
  entries.forEach(({ value }) => tally.set(value, (tally.get(value) || 0) + 1));
  let kept = null;
  let bestCount = -1;
  [...tally.entries()].forEach(([value, count]) => {
    if (count > bestCount || (count === bestCount && value < kept)) {
      kept = value;
      bestCount = count;
    }
  });
  return { kept, others: entries.filter((entry) => entry.value !== kept) };
}

function collectDivergences(documents, columns) {
  const groups = new Map();
  documents.forEach((doc) => {
    const projectValue = readDuration(doc.row?.[columns.dureeProjet]);
    if (projectValue != null) {
      const key = `project|${doc.typeDoc}`;
      if (!groups.has(key)) groups.set(key, { scope: "project", typeDoc: doc.typeDoc, zone: "", entries: [] });
      groups.get(key).entries.push({ id2: doc.id2, value: projectValue });
    }
    const zoneValue = readDuration(doc.row?.[columns.dureeZone]);
    if (zoneValue != null) {
      const key = `zone|${doc.typeDoc}|${doc.zone}`;
      if (!groups.has(key)) groups.set(key, { scope: "zone", typeDoc: doc.typeDoc, zone: doc.zone, entries: [] });
      groups.get(key).entries.push({ id2: doc.id2, value: zoneValue });
    }
  });

  const divergences = [];
  groups.forEach((group) => {
    const distinct = new Set(group.entries.map((entry) => entry.value));
    if (distinct.size <= 1) return;
    const { kept, others } = pickMajority(group.entries);
    divergences.push({ scope: group.scope, typeDoc: group.typeDoc, zone: group.zone, kept, others });
  });
  return divergences;
}

export function computeProjectCharge(planningRows, columns) {
  const byMonth = new Map();
  let unplacedDays = 0;
  let totalDays = 0;

  const documents = (planningRows || [])
    .filter((row) => isDocumentRow(row, columns))
    .map((row) => ({
      row,
      id2: toText(row?.[columns.id2]),
      typeDoc: toText(row?.[columns.typeDoc]),
      zone: toText(row?.[columns.zone]),
    }));

  documents.forEach((doc) => {
    const charge = resolveDocumentCharge(doc.row, columns);
    if (charge == null) return;
    totalDays += charge;

    const span = getDocumentWorkSpan(doc.row, columns);
    if (!span) {
      unplacedDays += charge;
      return;
    }

    spreadChargeOverMonths(charge, span.start, span.end).forEach((days, monthKey) => {
      byMonth.set(monthKey, Math.round(((byMonth.get(monthKey) || 0) + days) * 100) / 100);
    });
  });

  return {
    byMonth,
    unplacedDays: Math.round(unplacedDays * 100) / 100,
    totalDays: Math.round(totalDays * 100) / 100,
    divergences: collectDivergences(documents, columns),
  };
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

```bash
cd planning-synchro && node --test tests/documentCharge.test.mjs
```

Attendu : 10 tests PASS.

Si `spreadChargeOverMonths` échoue sur le cas 24/08 → 04/09, vérifier d'abord que ces dates donnent bien 5 jours ouvrés par mois (le 24/08/2026 est un lundi) avant de toucher au module : la constante du test a été posée à partir du calendrier réel, pas d'une exécution.

- [ ] **Step 5 : Vérifier l'absence de régression**

```bash
cd planning-synchro && node --test "tests/**/*.test.mjs"
```

Attendu : le compte de départ + 10, toujours **un seul** échec (le `phases.test.mjs` préexistant). **Ne rien commiter.**

---

### Task 2 : Déclaration des colonnes et remontée des variables de teinte

**Files:**
- Modify: `planning-synchro/assets/js/config.js`
- Modify: `planning-synchro/assets/css/styles.css:1499-1502`
- Test: `planning-synchro/tests/chargeTintScope.test.mjs` (nouveau)

**Interfaces:**
- Produces : `APP_CONFIG.grist.columns.planningProject.dureeProjet / dureeZone / dureeForce` ; les variables `--load-balanced` / `--load-partial` / `--load-overload` disponibles hors de `.ps-segment-edit-load`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `planning-synchro/tests/chargeTintScope.test.mjs` :

```js
// Les trois teintes de charge etaient declarees sur `.ps-segment-edit-load`,
// donc scopees a la fenetre de segment. La ligne Charge vit ailleurs dans le
// DOM et n'en heriterait pas — et une variable CSS non definie ne leve AUCUNE
// erreur, elle ne s'applique simplement pas : la ligne se serait rendue sans
// couleur, en silence. Ce test epingle le fait que les deux surfaces lisent la
// meme declaration, a une portee commune.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS = readFileSync(
  fileURLToPath(new URL("../assets/css/styles.css", import.meta.url)),
  "utf8"
);

// Rend le selecteur du bloc qui declare `name`, et la valeur declaree. La
// tolerance aux espaces evite qu'un simple reformatage du CSS fasse echouer le
// test pour une mauvaise raison.
function findDeclaration(name) {
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(CSS);
  if (!match) return null;
  const openBrace = CSS.lastIndexOf("{", match.index);
  const selector = CSS.slice(CSS.lastIndexOf("}", openBrace) + 1, openBrace);
  return {
    selector: selector.replace(/\/\*[\s\S]*?\*\//g, "").trim(),
    value: match[1].trim(),
  };
}

test("les teintes de charge sont declarees sur :root, avec les bonnes valeurs", () => {
  // --load-overload-text est NOUVELLE : #6d3b00 etait ecrite en dur.
  const expected = {
    "--load-partial": "#edf4fb",
    "--load-balanced": "#d7eccb",
    "--load-overload": "#ffe1a8",
    "--load-overload-text": "#6d3b00",
  };

  Object.entries(expected).forEach(([name, hex]) => {
    const found = findDeclaration(name);
    assert.ok(found, `${name} introuvable dans styles.css`);

    // Assertion POSITIVE, et non « different de .ps-segment-edit-load » : un
    // simple `notEqual` laisserait passer un selecteur MORT, qui ne matche
    // aucun element. Or une variable CSS qui ne resout pas ne leve aucune
    // erreur — la propriete est juste abandonnee. C'est exactement la panne
    // silencieuse que ce fichier existe pour empecher : l'assertion doit donc
    // nommer la portee attendue, pas seulement en exclure une.
    assert.equal(found.selector, ":root", `${name} n'est pas declaree sur :root`);

    // La teinte elle-meme est le contrat : elle doit se lire a l'identique dans
    // Gestion-User, gestion-depenses2 et ici. Une coquille sur un chiffre hexa
    // ne casserait rien de visible — juste la coherence entre les trois widgets.
    assert.equal(found.value, hex, `${name} n'a pas la teinte attendue`);
  });
});

test("la fenetre de segment consomme toujours les trois teintes", () => {
  // Les trois etats de la barre de la fenetre de segment, un par teinte. Le
  // deplacement vers :root ne doit rien avoir casse ici.
  assert.match(CSS, /\.ps-segment-edit-load-fill\s*\{[^}]*var\(--load-partial\)/);
  assert.match(CSS, /\.ps-segment-edit-load\.is-balanced[^{]*\{[^}]*var\(--load-balanced\)/);
  assert.match(CSS, /\.ps-segment-edit-load\.is-overload[^{]*\{[^}]*var\(--load-overload\)/);
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd planning-synchro && node --test tests/chargeTintScope.test.mjs
```

Attendu : ÉCHEC sur les trois déclarations, avec le message « est scopee a la fenetre de segment ».

- [ ] **Step 3 : Remonter les déclarations**

Dans `assets/css/styles.css`, retirer les trois lignes du bloc `.ps-segment-edit-load` (**lignes 1500-1502**, le bloc ouvre en 1499).

⚠️ **Placement** : `styles.css` ne contient **aucun bloc `:root`** — ses jetons globaux vivent dans `assets/css/variables.css`, porté depuis `gestion-depenses2`. **Ne pas déclarer les teintes dans `variables.css`** : ce fichier est un portage et l'y modifier le ferait diverger de sa source. Créer un bloc `:root` **dans `styles.css`, à l'emplacement même des lignes retirées**, pour que le commentaire reste à côté de ce qu'il explique :

```css
/* Teintes de charge, partagees par la barre de la fenetre de segment ET la ligne
   Charge du board. Reprises de Gestion-User (--color-partial / --color-balanced /
   --color-overload) et identiques a celles de gestion-depenses2 : la meme charge
   doit se lire de la meme couleur dans les trois widgets.
   Declarees ici et NON sur .ps-segment-edit-load : la ligne Charge vit hors de
   cette fenetre et n'heriterait pas d'une variable scopee — sans erreur, juste
   sans couleur. */
:root {
  --load-partial: #edf4fb;
  --load-balanced: #d7eccb;
  --load-overload: #ffe1a8;
  --load-overload-text: #6d3b00;
}
```

⚠️ `styles.css` est en **CRLF**. Mesurer avec Node avant et après, pas avec `grep`.

- [ ] **Step 4 : Déclarer les trois colonnes**

Dans `assets/js/config.js`, bloc `planningProject`, ajouter à la suite de `service` :

```js
        // Charge de reference : trois niveaux resolus en cascade a la lecture
        // (Force > Zone > Projet), jamais stockes resolus — cf. bottom/documentCharge.js.
        dureeProjet: "Duree_Projet", dureeZone: "Duree_Zone", dureeForce: "Duree_Force",
```

- [ ] **Step 5 : Vérifier**

```bash
cd planning-synchro && node --test "tests/**/*.test.mjs"
```

Attendu : les 2 nouveaux tests PASS, aucune régression, toujours un seul échec préexistant. Contrôler visuellement que la barre de charge de la fenêtre de segment garde ses couleurs (le harnais, servi **depuis la racine du dépôt** — cf. `README.md`). **Ne rien commiter.**

---

### Task 3 : La ligne « Charge » dans le board

**Files:**
- Modify: `planning-synchro/assets/js/bottom/chargeBoard.js`
- Modify: `planning-synchro/assets/js/main.js`
- Modify: `planning-synchro/assets/css/styles.css`
- Test: `planning-synchro/tests/chargeRowRender.test.mjs` (nouveau)

**Interfaces:**
- Consumes : `computeProjectCharge(planningRows, columns)` (Task 1) ; `APP_CONFIG.grist.columns.planningProject` (Task 2) ; `getWindowMonths(windowDays, dayWidth)` et `computeMonthTotalDays(workers, month)` déjà présents dans `chargeBoard.js`.
- Produces : `chargeBoard.render({ ..., planningRows })` accepte une nouvelle entrée `planningRows` ; le DOM porte `.charge-plan-row--charge`, `.charge-plan-charge-unplaced`, et une classe d'état par cellule (`is-balanced` / `is-overload` / `is-partial`).

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `planning-synchro/tests/chargeRowRender.test.mjs`. Le fichier `chargeBoard.js` n'exporte pas son rendu : suivre le motif déjà en place dans `tests/chargeMonthHover.test.mjs`, qui extrait le texte réel de la fonction et l'exécute en `vm`. Couvrir :

```js
test("une cellule ou planifie = requis est verte", () => {
  // planifie 12, requis 12 -> is-balanced
});

test("une cellule ou planifie < requis prend la teinte de surcharge", () => {
  // planifie 18, requis 22 -> is-overload
});

test("une cellule ou planifie > requis prend la teinte partielle", () => {
  // planifie 8, requis 5 -> is-partial
});

test("un mois a 0 requis ET 0 planifie reste neutre", () => {
  // aucune des trois classes
});

test("l'egalite tolere l'arithmetique flottante", () => {
  // planifie 12, requis 12.0000000001 -> is-balanced, pas is-overload
});

test("la cellule « non place » s'affiche puis se masque a zero", () => {
  // unplacedDays 240 -> presente ; 0 -> absente
});

test("la ligne se rend meme sans aucune duree renseignee", () => {
  // sinon le bouton « Charge » serait introuvable
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd planning-synchro && node --test tests/chargeRowRender.test.mjs
```

Attendu : ÉCHEC — la fonction de rendu de la ligne Charge n'existe pas encore.

- [ ] **Step 3 : Rendre la ligne**

Dans `chargeBoard.js`, importer `computeProjectCharge` depuis `./documentCharge.js`, puis ajouter après `renderTotalRow` :

```js
// Etat d'une cellule mensuelle : on compare les jours PLANIFIES — exactement le
// chiffre que la ligne Total affiche deja, via computeMonthTotalDays — aux jours
// REQUIS par le bareme. Les deux lignes doivent parler du meme nombre, d'ou la
// reutilisation de la meme fonction plutot qu'un calcul parallele.
const CHARGE_EPSILON = 1e-9;

function getChargeCellState(plannedDays, requiredDays) {
  if (requiredDays <= CHARGE_EPSILON && plannedDays <= CHARGE_EPSILON) return "";
  if (Math.abs(plannedDays - requiredDays) < CHARGE_EPSILON) return "is-balanced";
  return plannedDays < requiredDays ? "is-overload" : "is-partial";
}

function renderChargeMonthTrack(workers, months, chargeByMonth) {
  return months
    .map((month) => {
      const requiredDays = chargeByMonth.get(month.key) || 0;
      const plannedDays = computeMonthTotalDays(workers, month);
      const state = getChargeCellState(plannedDays, requiredDays);
      const fillRatio =
        requiredDays > 0
          ? Math.min(1, Math.max(0.08, requiredDays / Math.max(1, month.businessDayCount)))
          : 0;
      const fill =
        requiredDays > 0
          ? `<span class="charge-plan-month-fill" style="width:calc((100% - 12px) * ${fillRatio})">
               <span class="charge-plan-month-label">${formatDayValue(requiredDays)} j</span>
             </span>`
          : "";
      return `<span class="charge-plan-month-segment ${state}" style="width:${month.widthPx}px">${fill}</span>`;
    })
    .join("");
}

// La ligne se rend TOUJOURS des qu'un projet est charge, meme sans aucune duree
// saisie : sinon le bouton « Charge » — seul point d'entree de la fenetre —
// serait introuvable.
function renderChargeRow(workers, months, timelineWidth, charge) {
  const unplaced =
    charge.unplacedDays > 0
      ? `<span class="charge-plan-charge-unplaced" title="Documents sans dates de planning : leur charge n'est encore rattachee a aucun mois.">
           non place : ${formatDayValue(charge.unplacedDays)} j
         </span>`
      : "";
  return `
    <div class="charge-plan-row charge-plan-row--charge" style="--timeline-width:${timelineWidth}px; --row-height:72px">
      <div class="charge-plan-cell charge-plan-cell--name">
        <button type="button" class="charge-plan-charge-btn" data-charge-assign-open>Charge</button>
        ${unplaced}
      </div>
      <div class="charge-plan-cell charge-plan-cell--timeline">
        <div class="charge-plan-track charge-plan-track--readonly">
          ${renderChargeMonthTrack(workers, months, charge.byMonth)}
        </div>
      </div>
    </div>
  `;
}
```

Dans `render()`, à côté de `lastPlanningTasks`, mémoriser `lastPlanningRows` (les rafraîchissements de fenêtre — `setWindow` — ne le transmettent pas, il faut le conserver), calculer la charge et insérer la ligne **après** `totalRowHtml` :

```js
    if (planningRows !== undefined) lastPlanningRows = Array.isArray(planningRows) ? planningRows : [];
    const charge = computeProjectCharge(lastPlanningRows, APP_CONFIG.grist.columns.planningProject);
    const chargeRowHtml = renderChargeRow(lastWorkers, windowMonths, timelineWidth, charge);
```

- [ ] **Step 4 : Styler la ligne**

⚠️ **Teinter la pastille, PAS le segment.** Relevé du CSS existant :

- `.charge-plan-month-segment` ne porte qu'un `background-image` — la trame verticale qui matérialise la grille. Poser un `background:` dessus est une **propriété raccourcie** : elle réinitialise `background-image` et **efface la trame**.
- `.charge-plan-month-fill` est une pastille **`position: absolute`**, haute de 30 px, `border-radius: 999px`, avec un dégradé bleu opaque. Elle **recouvre** le milieu du segment : une teinte posée sur le segment ne se verrait qu'en liseré autour de la pastille.
- `.charge-plan-month-label` est en **`color: #fff`** — illisible sur `--load-partial` (#edf4fb).

C'est donc la pastille qu'on teinte, exactement comme la fenêtre de segment le fait déjà (`.ps-segment-edit-load.is-balanced .ps-segment-edit-load-fill`). La classe d'état reste posée sur le **segment** (le JS et ses tests ci-dessus sont inchangés), et le sélecteur descend jusqu'à la pastille. À la suite des règles de `.charge-plan-row--total` :

```css
/* La classe d'etat est sur le SEGMENT, mais c'est la PASTILLE qu'on teinte :
   poser un `background` raccourci sur le segment effacerait sa trame de grille,
   et la pastille opaque recouvrirait la teinte de toute facon. Meme decoupage
   que la barre de la fenetre de segment. */
.charge-plan-row--charge .charge-plan-month-segment.is-balanced .charge-plan-month-fill {
  background: var(--load-balanced);
  box-shadow: inset 0 0 0 1px rgba(56, 106, 30, 0.32);
}

.charge-plan-row--charge .charge-plan-month-segment.is-partial .charge-plan-month-fill {
  background: var(--load-partial);
  /* Liseré obligatoire : #edf4fb ne fait que 1,11:1 contre le fond. Meme
     traitement que .ps-segment-edit-load-fill, qui a le meme probleme. */
  box-shadow: inset 0 0 0 1px rgba(0, 73, 144, 0.55);
}

.charge-plan-row--charge .charge-plan-month-segment.is-overload .charge-plan-month-fill {
  background: var(--load-overload);
  box-shadow: inset 0 0 0 1px rgba(109, 59, 0, 0.32);
}

/* Le label est blanc par defaut, pour le degrade bleu de la ligne Total. Sur les
   trois teintes pales de la ligne Charge il disparaitrait : on le repasse en
   sombre. #6d3b00 sur #ffe1a8 est exactement le couple de Gestion-User. */
.charge-plan-row--charge .charge-plan-month-segment.is-balanced .charge-plan-month-label { color: #386a1e; }
.charge-plan-row--charge .charge-plan-month-segment.is-partial  .charge-plan-month-label { color: var(--color-primary); }
.charge-plan-row--charge .charge-plan-month-segment.is-overload .charge-plan-month-label { color: var(--load-overload-text); }
```

Le cas neutre (aucune des trois classes) garde la pastille bleue et le label blanc de la ligne Total — c'est le rendu voulu : un mois sans charge requise ne se distingue pas.

- [ ] **Step 5 : Alimenter depuis `main.js`**

Aux **trois** appels à `chargeBoard.render(...)` (`main.js:449`, `:462`, `:589`), ajouter `planningRows`. Le troisième est le chemin post-écriture : sans lui, la ligne Charge afficherait des chiffres périmés après chaque enregistrement.

- [ ] **Step 6 : Vérifier**

```bash
cd planning-synchro && node --test "tests/**/*.test.mjs"
```

Puis, dans le harnais : la ligne Charge apparaît sous Total, alignée sur les mêmes mois, et les couleurs s'appliquent. **Ne rien commiter.**

---

### Task 4 : La fenêtre d'assignation

**Files:**
- Create: `planning-synchro/assets/js/bottom/chargeAssignModal.js`
- Modify: `planning-synchro/index.html`, `planning-synchro/dev/harness.html`
- Modify: `planning-synchro/assets/css/styles.css`
- Modify: `planning-synchro/assets/js/main.js`
- Test: `planning-synchro/tests/chargeAssignModal.test.mjs` (nouveau)

**Interfaces:**
- Consumes : `computeProjectCharge` et `resolveDocumentCharge` (Task 1) ; le bouton `[data-charge-assign-open]` rendu en Task 3.
- Produces :
  - `buildChargeTree(planningRows, columns) -> [{ typeDoc, value, divergent, zones: [{ zone, value, divergent, documents: [{ id, id2, label, value }] }] }]`
  - `collectChargeWrites(tree, planningRows, columns) -> [{ recordId, fields }]`
  - `createChargeAssignModal(rootEl, { onSubmit }) -> { open, close, isOpen, destroy }`

- [ ] **Step 1 : Écrire les tests des helpers purs**

Dans `tests/chargeAssignModal.test.mjs`, couvrir :

```js
test("buildChargeTree groupe par type puis par zone du projet courant", () => {
  // Types dans l'ordre d'apparition, zones du seul projet charge.
});

test("un niveau vide herite du niveau au-dessus", () => {
  // Duree_Zone absente -> la zone affiche la valeur du type, marquee heritee.
});

test("buildChargeTree signale un groupe divergent", () => {
  // 2 lignes a 2 j, 1 a 3 j -> value 2, divergent true, ID2 de l'ecart liste.
});

test("collectChargeWrites ecrit Duree_Projet sur TOUTES les lignes du type", () => {
  // 3 lignes COFFRAGE -> 3 UpdateRecord portant la meme valeur.
});

test("collectChargeWrites ne touche que la ligne visee au niveau document", () => {
  // Duree_Force -> un seul recordId.
});

test("vider un champ efface la colonne", () => {
  // fields.Duree_Zone === "" pour rendre la main au niveau du dessus.
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
cd planning-synchro && node --test tests/chargeAssignModal.test.mjs
```

Attendu : ÉCHEC — `Cannot find module .../bottom/chargeAssignModal.js`.

- [ ] **Step 3 : Écrire les helpers purs et le contrôleur**

Le contrôleur DOM suit le modèle de `bottom/editSegmentModal.js` : helpers purs exportés et testés, contrôleur browser-only vérifié par sonde. Reprendre de ce fichier le verrou de soumission (`createSubmitLock` / délai de garde 30 s / jeton de session) — la fenêtre écrit jusqu'à 112 lignes en un lot, un double-clic ou une promesse Grist bloquée y sont exactement aussi nuisibles que dans la fenêtre de segment.

Dépliage : un bloc par type, une case « par zone » qui déplie les zones, une case « par document » par zone qui déplie ses documents. Un champ vide hérite du niveau au-dessus et l'affiche en grisé.

Les divergences remontées par `computeProjectCharge` s'affichent en tête de bloc : « 4 lignes divergent sur COFFRAGE (1021, 1031, …) ».

- [ ] **Step 4 : Ajouter le markup**

Dans `index.html` **et** `dev/harness.html`, à côté de `#ps-edit-segment-modal`, ajouter `#ps-charge-assign-modal` avec la même charpente de fenêtre (en-tête, corps, pied, zone de message). Les deux fichiers doivent rester **identiques** sur cette tranche — un test le vérifie déjà pour la fenêtre de segment, l'étendre à celle-ci.

- [ ] **Step 5 : Câbler dans `main.js`**

Monter la fenêtre à côté de `attachChargeEditing`, et brancher le bouton `[data-charge-assign-open]` par délégation sur le board (il est reconstruit à chaque rendu, un écouteur direct ne survivrait pas).

- [ ] **Step 6 : Vérifier**

```bash
cd planning-synchro && node --test "tests/**/*.test.mjs"
```

**Ne rien commiter.**

---

### Task 5 : L'écriture dans `Planning_Projet`

**Files:**
- Modify: `planning-synchro/assets/js/services/gristService.js`
- Modify: `planning-synchro/assets/js/main.js`
- Test: `planning-synchro/tests/gristService.test.mjs`

**Interfaces:**
- Consumes : `collectChargeWrites(...)` (Task 4).
- Produces : `updatePlanningDurations(writes) -> Promise<void>` où `writes = [{ recordId, fields }]`.

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `tests/gristService.test.mjs`, suivre le style de mock déjà présent :

```js
test("updatePlanningDurations ecrit toutes les lignes en UN SEUL lot", async () => {
  // 3 writes -> applyUserActions appele UNE fois, avec 3 UpdateRecord.
  // Un lot unique evite que le relais de synchronisation se declenche 3 fois.
});

test("updatePlanningDurations ne fait rien sans ecriture", async () => {
  // [] -> applyUserActions jamais appele.
});

test("updatePlanningDurations rejette un recordId invalide", async () => {
  // toReferenceId renvoie null -> throw, aucune ecriture partielle.
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
cd planning-synchro && node --test tests/gristService.test.mjs
```

Attendu : ÉCHEC — `updatePlanningDurations` n'est pas exportée.

- [ ] **Step 3 : Écrire la fonction**

Dans `services/gristService.js` :

```js
// Ecriture des trois colonnes de duree sur Planning_Projet.
//
// Premiere ecriture de ce widget hors TimeSegment. La couche partagee valide
// chaque ligne mutee (shared/grist-service-context.js -> rowMatchesContext) :
// pour Planning_Projet elle exige que le Service de la ligne corresponde au
// service courant, que NomProjet figure parmi les noms du projet selectionne, et
// qu'un numero de projet soit selectionne. Les trois sont vraies ici — mais un
// refus ne se verrait qu'a l'enregistrement, en production, d'ou le test.
//
// UN SEUL applyUserActions : assigner Duree_Projet au COFFRAGE de PRD touche 112
// lignes, et un lot par ligne declencherait 112 rafraichissements.
export async function updatePlanningDurations(writes) {
  const actions = (Array.isArray(writes) ? writes : []).map((write) => {
    const recordId = toReferenceId(write?.recordId);
    if (!recordId) {
      throw new Error("Ligne de planning invalide : id manquant.");
    }
    return ["UpdateRecord", APP_CONFIG.grist.tables.planningProject, recordId, write.fields];
  });

  if (!actions.length) return;
  await applyActions(actions);
}
```

- [ ] **Step 4 : Brancher l'enregistrement**

Dans `main.js`, `onSubmit` de la fenêtre : `collectChargeWrites(...)` → `updatePlanningDurations(...)` → mise à jour locale de `planningRows` → re-rendu. Ne **pas** refetch : le routage post-écriture posé récemment traite déjà les signaux, et un refetch complet ramènerait le rechargement visible qu'on vient de supprimer.

- [ ] **Step 5 : Vérifier**

```bash
cd planning-synchro && node --test "tests/**/*.test.mjs"
node --test "shared/tests/**/*.test.cjs"
```

**Ne rien commiter.**

---

### Task 6 : Documentation et vérification d'ensemble

**Files:**
- Modify: `planning-synchro/README.md`

- [ ] **Step 1 : Documenter**

Ajouter au tableau « Tables et colonnes Grist requises » les trois colonnes de `Planning_Projet`, et une section décrivant la cascade, la répartition au prorata des jours ouvrés, la cellule « non placé » et le code couleur.

- [ ] **Step 2 : Vérification finale**

```bash
cd "<racine>"
node --test "shared/tests/**/*.test.cjs"
cd planning-synchro   && node --test "tests/**/*.test.mjs"
cd ../gestion-depenses2 && node --test "tests/**/*.test.mjs"
cd ../Gestion-User      && node --test "tests/**/*.test.mjs"
cd .. && git status
```

Attendu : `planning-synchro` au compte de départ + les nouveaux tests, toujours **un seul** échec (le `phases.test.mjs` préexistant) ; les trois autres suites **inchangées** ; `git status` ne montrant que les fichiers de ce plan, **aucun commit**.

- [ ] **Step 3 : Contrôle navigateur**

Servir la racine du dépôt, ouvrir `/planning-synchro/dev/harness.html`, et vérifier : la ligne Charge sous Total, alignée sur les mêmes mois ; les trois couleurs ; la cellule « non placé » ; le dépliage à trois niveaux ; l'enregistrement sans rechargement visible ; l'alignement des deux panes aux trois zooms (`window.__PS_ALIGN_DEBUG = true`, aucun `console.warn`).
