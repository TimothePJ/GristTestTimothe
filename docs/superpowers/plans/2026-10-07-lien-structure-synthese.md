# Lien Structure ↔ Synthese (coffrage d'un étage, date d'indice 0) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dans la fenêtre « Lien Structure », glisser un coffrage sur un étage de la même zone mémorise le lien (N° du coffrage sur la ligne-étage) et pose la date de diffusion d'indice 0 du coffrage sur le début de l'étage ; un bouton « Mettre à jour » réapplique la date à la demande.

**Architecture:** Le modèle pur `structureLinkModel.js` apprend les dates d'indice 0 (table `ListePlan_NDC_COF`), le lien de chaque étage (colonne `Lien_Structure`), la tâche visée et l'état de chaque étage. Le contrôleur du tableau de tâches reste le seul à écrire : il expose une source (lignes affichées, droits) et une écriture `applyStructureLink` qui passe par sa file, avec la cascade existante. La fenêtre dessine les états, gère le glisser-déposer natif et délègue toute écriture.

**Tech Stack:** JavaScript ES modules sans dépendance, widgets Grist, tests `node:test` (Node 25).

**Spec:** `docs/superpowers/specs/2026-10-07-lien-structure-synthese-design.md`

## Global Constraints

- **Aucun commit, aucun push.** L'utilisateur teste sur localhost et commite lui-même : chaque tâche finit par un point de contrôle (tests verts), jamais par `git commit`.
- Textes de l'interface en français, **mot pour mot** comme dans ce plan.
- Nouvelle colonne de `Planning_Projet` : `Lien_Structure` (**Texte**), remplie seulement sur une ligne-étage, avec le **N° du coffrage** (`ID2`). Créée par l'utilisateur, jamais par le code.
- Table lue : `ListePlan_NDC_COF`, colonnes `Type_document`, `NumeroDocument`, `Indice`, `DateDiffusion`, `Service`.
- Dates affichées avec `formatDate` de `syntheseTaskModel.js` (« Jeu 27/11/25 ») ; jours ouvrés avec `nextWorkingDay` / `endAfterWorkingDays` existants.
- `shared/` n'est pas modifié ; `buildSections` non plus.
- N'écrivez jamais de séquence `\uXXXX` dans un fichier avec Write/Edit : elles deviennent des caractères bruts. Pour retirer les accents : `.normalize("NFD").replace(/\p{M}/gu, "")`.
- Tests de Planning Projet : depuis `Planning Projet/`, `node --test tests/*.test.mjs` (351 tests verts au départ).

## Review Focus

1. **Zone filtrée dans le bandeau** : un dépôt dans une autre zone que celle du filtre écrit quand même. Test : tâche 3.
2. **N° écrit différemment dans les deux tables** (nombre au lieu de texte, espaces, casse) : la date d'indice 0 est trouvée ; « 0110 » ne se confond pas avec « 110 ». Test : tâche 2.
3. **Fond de plan retouché à la main après le lien**, RECEPTION inchangée : « Mettre à jour » le recale quand même. Test : tâche 3.
4. **Écriture refusée par Grist** (colonne absente en production, droits) : rien à moitié, l'affichage revient, la fenêtre affiche l'erreur. Tests : tâches 3 et 4.
5. **Fenêtre fermée pendant une écriture** : la réponse tardive ne provoque ni erreur ni message. Test : tâche 4.

## Fichiers

| Fichier | Rôle | Tâche |
|---|---|---|
| `Planning Projet/assets/js/services/syntheseTaskModel.js` | `TASK_COLUMNS.structureLink`, `moveTaskStart`, `detectStructureLinkColumn`. | 1 |
| `Planning Projet/assets/js/services/structureLinkModel.js` | Dates d'indice 0, liens des étages, tâche visée, états, `buildStructureLink`. | 2 |
| `Planning Projet/assets/js/ui/syntheseTasksController.js` | `getStructureLinkSource`, `applyStructureLink`. | 3 |
| `Planning Projet/assets/js/ui/structureLinkDialog.js` | États, glisser-déposer, boutons, messages. | 2 (appel adapté), 4 |
| `Planning Projet/assets/js/main.js`, `index.html`, `assets/css/styles.css` | Branchement, styles, versions. | 5 |

Dépendances entre modules (pas de cycle) : `structureLinkModel.js` → `syntheseTaskModel.js`, `syntheseTasks.js` ; `syntheseTasksController.js` → `structureLinkModel.js` ; `structureLinkDialog.js` → `structureLinkModel.js`, `syntheseTaskModel.js`.

Repères du modèle d'étage dans les tests (`tests/helpers/templateRows.mjs`, `templateRows({ zoneName: "Zone Z2A" })`) : ligne de zone 10 ; ligne-étage SS1 **201** ; RECEPTION ARCH/TOPO/STR **202** ; CYCLE 1 203 ; FOND DE PLAN DE SYNTHESE NIV SS1 **204** (lien `202 DD`) ; DIFFUSION FDS 205 ; … ; DEMARRAGE GO 226. `datedRows(...)` donne les mêmes lignes avec les durées de la capture, RECEPTION au 02/01/26.

---

### Task 1: Décaler une tâche et reconnaître la colonne (`syntheseTaskModel.js`)

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseTaskModel.js`
- Test: `Planning Projet/tests/syntheseMoveStart.test.mjs` (nouveau)

**Interfaces:**
- Consumes: `nextWorkingDay`, `endAfterWorkingDays`, `withDates`, `refuse`, `MIN_TASK_YEAR`, `MAX_TASK_YEAR` (déjà dans le fichier).
- Produces :
  - `TASK_COLUMNS.structureLink` = `"Lien_Structure"`
  - `moveTaskStart(task, date: Date) → { ok: true, task, fields } | { ok: false, error }` (même forme qu'`applyTaskEdit`)
  - `detectStructureLinkColumn(rows) → true | false | null`

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseMoveStart.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  TASK_COLUMNS,
  detectStructureLinkColumn,
  moveTaskStart,
  readTask,
} from "../assets/js/services/syntheseTaskModel.js";

const day = (year, month, date) => new Date(year, month - 1, date);
const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);

function task(fields) {
  return readTask({ Type_doc: "", ID2: "", Zone: "Zone Z2A", ...fields });
}
// Visa MOE : Ven 09/10/26 → Ven 23/10/26, 11 jours.
const visa = () => task({ id: 5, Taches: "Visa MOE", Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-23", Duree_1: 11 });
// Jalon du jeudi 12/11/26.
const milestone = () => task({ id: 6, Taches: "RECEPTION ARCH/TOPO/STR", Diff_coffrage: "2026-11-12", Diff_armature: "2026-11-12", Duree_1: 0 });
const planned = (days) => task({ id: 7, Taches: "FOND DE PLAN", Diff_coffrage: null, Diff_armature: null, Duree_1: days });

test("colonne du lien : Lien_Structure", () => {
  assert.equal(TASK_COLUMNS.structureLink, "Lien_Structure");
});

test("tâche datée : elle se décale et garde sa durée", () => {
  const result = moveTaskStart(visa(), day(2025, 11, 27)); // jeudi
  assert.equal(result.ok, true);
  assert.equal(result.task.durationDays, 11);
  assert.deepEqual(result.fields, { Diff_coffrage: "2025-11-27", Diff_armature: "2025-12-11", Duree_1: 11 });
});

test("jalon : il se déplace et reste un jalon", () => {
  const result = moveTaskStart(milestone(), day(2025, 11, 27));
  assert.equal(result.task.isMilestone, true);
  assert.deepEqual(result.fields, { Diff_coffrage: "2025-11-27", Diff_armature: "2025-11-27", Duree_1: 0 });
});

test("tâche sans dates : sa durée prévue donne la Fin (0 : jalon ; inconnue : un jour)", () => {
  assert.deepEqual(
    moveTaskStart(planned(2), day(2025, 11, 27)).fields,
    { Diff_coffrage: "2025-11-27", Diff_armature: "2025-11-28", Duree_1: 2 }
  );
  const asMilestone = moveTaskStart(planned(0), day(2025, 11, 27));
  assert.equal(asMilestone.task.isMilestone, true);
  assert.deepEqual(asMilestone.fields, { Diff_coffrage: "2025-11-27", Diff_armature: "2025-11-27", Duree_1: 0 });
  assert.deepEqual(
    moveTaskStart(planned(""), day(2025, 11, 27)).fields,
    { Diff_coffrage: "2025-11-27", Diff_armature: "2025-11-27", Duree_1: 1 }
  );
});

test("week-end ou férié : le Début passe au jour ouvré suivant", () => {
  assert.equal(iso(moveTaskStart(milestone(), day(2026, 11, 28)).task.start), "2026-11-30", "samedi → lundi");
  assert.equal(iso(moveTaskStart(milestone(), day(2026, 5, 1)).task.start), "2026-05-04", "vendredi 1er mai → lundi");
});

test("déjà à la bonne date : rien à écrire", () => {
  const result = moveTaskStart(milestone(), day(2026, 11, 12));
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields, {});
});

test("date illisible ou hors bornes : refus", () => {
  assert.deepEqual(moveTaskStart(visa(), null), { ok: false, error: "Date invalide." });
  assert.deepEqual(moveTaskStart(visa(), new Date(NaN)), { ok: false, error: "Date invalide." });
  assert.match(moveTaskStart(visa(), day(1999, 12, 31)).error, /entre 2000 et 2100/);
  assert.match(moveTaskStart(visa(), day(2101, 1, 1)).error, /entre 2000 et 2100/);
});

test("colonne Lien_Structure : présente, absente, inconnue sans ligne", () => {
  assert.equal(detectStructureLinkColumn([{ id: 1, Lien_Structure: "" }]), true);
  assert.equal(detectStructureLinkColumn([{ id: 1, Lien: "" }]), false);
  assert.equal(detectStructureLinkColumn([]), null);
  assert.equal(detectStructureLinkColumn(null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (depuis `Planning Projet/`) : `node --test tests/syntheseMoveStart.test.mjs`
Expected: FAIL — `moveTaskStart` et `detectStructureLinkColumn` ne sont pas exportés (SyntaxError d'import).

- [ ] **Step 3: Write minimal implementation**

Dans `Planning Projet/assets/js/services/syntheseTaskModel.js` :

1. Dans `TASK_COLUMNS`, après `link: "Lien",` :

```js
  structureLink: "Lien_Structure",
```

2. Juste après la fonction `applyTaskEdit` (avant le commentaire « Une nouvelle tâche démarre… ») :

```js
// Décale une tâche pour qu'elle commence à `date` (le jour ouvré suivant si ce n'en est pas
// un) en gardant sa durée — 0 : jalon ; inconnue : un jour. Sert au lien Structure : la tâche
// suit la date d'un coffrage comme une tâche liée suit son prédécesseur, là où une saisie dans
// « Début » allonge ou raccourcit la tâche. Même réponse qu'applyTaskEdit.
export function moveTaskStart(task, date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return refuse("Date invalide.");
  if (date.getFullYear() < MIN_TASK_YEAR || date.getFullYear() > MAX_TASK_YEAR) {
    return refuse(`Date invalide : choisissez une date entre ${MIN_TASK_YEAR} et ${MAX_TASK_YEAR}.`);
  }
  const start = nextWorkingDay(date);
  const days = Number.isInteger(task.durationDays) ? task.durationDays : 1;
  if (task.isMilestone || days === 0) return withDates(task, start, start, true);
  return withDates(task, start, endAfterWorkingDays(start, days), false);
}
```

3. Juste après la fonction `detectTemplateColumns` :

```js
// La colonne Lien_Structure existe-t-elle ? Comme pour Etage : null si aucune ligne ne permet
// de le savoir.
export function detectStructureLinkColumn(rows = []) {
  if (!rows?.length) return null;
  return rows.some((row) => row != null && Object.prototype.hasOwnProperty.call(row, TASK_COLUMNS.structureLink));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run : `node --test tests/syntheseMoveStart.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Point de contrôle**

Run : `node --test tests/*.test.mjs`
Expected: 359 tests, 0 échec. Pas de commit.

---

### Task 2: Modèle du lien (`structureLinkModel.js`)

**Files:**
- Modify: `Planning Projet/assets/js/services/structureLinkModel.js` (réécrit)
- Modify: `Planning Projet/assets/js/ui/structureLinkDialog.js` (un appel adapté ; la fenêtre est réécrite à la tâche 4)
- Test: `Planning Projet/tests/structureLinkModel.test.mjs` (réécrit)

**Interfaces:**
- Consumes: de `syntheseTaskModel.js` : `NO_ZONE_KEY`, `NO_ZONE_LABEL`, `TASK_COLUMNS` (dont `structureLink`, tâche 1), `buildSections`, `floorKeyOf`, `isFloorRow`, `nextWorkingDay`, `zoneKeyOf` ; de `syntheseTasks.js` : `parseGristDate`.
- Produces :
  - `LINK_STATES` = `{ none, missing, noPlan, waiting, current, stale }` (valeurs = mêmes mots)
  - `numberKeyOf(value) → string`
  - `isFormworkRow(row) → boolean`, `formworkLabel({ number, name }) → string` (inchangés)
  - `formworkIssueDates(planRows) → Map<numberKey, Date>`
  - `readFloorLinks(syntheseRows) → Map<"zoneKey/floorKey", string>`
  - `findFloorStart(tasks) → { plan: Task|null, anchor: Task|null }`
  - `buildStructureLink({ syntheseRows, projectRows, planRows }) → { zones: Zone[] }` avec
    - `Zone` = `{ zoneKey, zoneName, label, floors: Floor[], formworks: Formwork[] }`
    - `Floor` = `{ key, name, formworkNumber: string, formwork: Formwork|null, plan: { id, name, start: Date|null }|null, expectedStart: Date|null, state }`
    - `Formwork` = `{ id, number, name, label, zoneKey, issueDate: Date|null, floorNames: string[] }`

- [ ] **Step 1: Write the failing test**

Remplacer tout `Planning Projet/tests/structureLinkModel.test.mjs` par :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  LINK_STATES,
  buildStructureLink,
  findFloorStart,
  formworkIssueDates,
  formworkLabel,
  isFormworkRow,
  numberKeyOf,
  readFloorLinks,
} from "../assets/js/services/structureLinkModel.js";
import { readTask, zoneKeyOf } from "../assets/js/services/syntheseTaskModel.js";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);

function row(id, fields = {}) {
  return {
    id,
    NomProjet: "HOTEL DIEU",
    Taches: "",
    Type_doc: "",
    ID2: "",
    Zone: "",
    Groupe: "",
    Etage: false,
    Service: "",
    Nature: "",
    Parent: "",
    Lien: "",
    Lien_Structure: "",
    Diff_coffrage: null,
    Diff_armature: null,
    Duree_1: 0,
    ...fields,
  };
}

const structure = (id, fields) => row(id, { Service: "Structure", ...fields });
const synthese = (id, fields) => row(id, { Service: "Synthese", ...fields });
const coffrage = (id, zone, number, name) => structure(id, { Type_doc: "COFFRAGE", Zone: zone, ID2: number, Taches: name });
const floor = (id, zone, name, link = "") => synthese(id, { Zone: zone, Taches: name, Etage: true, Lien_Structure: link });
const floorTask = (id, zone, floorName, name, fields = {}) => synthese(id, { Zone: zone, Groupe: floorName, Taches: name, ...fields });
// Une ligne de la liste de plans (ListePlan_NDC_COF).
const plan = (number, indice, date, fields = {}) => ({
  Nom_projet: "HOTEL DIEU",
  Type_document: "COFFRAGE",
  NumeroDocument: number,
  Indice: indice,
  DateDiffusion: date,
  Service: "Structure",
  ...fields,
});

test("coffrage de Structure : service Structure, type COFFRAGE, nommé", () => {
  assert.equal(isFormworkRow(coffrage(1, "Zone 1", "3001", "PH SS1")), true);
  assert.equal(isFormworkRow(structure(2, { Type_doc: " Coffrage ", Taches: "PH SS1" })), true, "casse et espaces ignorés");
  assert.equal(isFormworkRow(structure(3, { Type_doc: "ARMATURES", Taches: "PH SS1" })), false, "autre type");
  assert.equal(isFormworkRow(synthese(4, { Type_doc: "COFFRAGE", Taches: "PH SS1" })), false, "autre service");
  assert.equal(isFormworkRow(structure(5, { Type_doc: "COFFRAGE", Taches: "  " })), false, "ligne de zone");
  assert.equal(isFormworkRow(structure(0, { Type_doc: "COFFRAGE", Taches: "PH SS1" })), false, "id invalide");
  assert.equal(isFormworkRow(null), false);
});

test("libellé d'un coffrage : « N° — nom », le nom seul sans N°", () => {
  assert.equal(formworkLabel({ number: "3001", name: "PH SS1" }), "3001 — PH SS1");
  assert.equal(formworkLabel({ number: "", name: "PH SS1" }), "PH SS1");
});

test("clé d'un N° : espaces resserrés, casse ignorée, zéros gardés", () => {
  assert.equal(numberKeyOf(" 30  21 "), "30 21");
  assert.equal(numberKeyOf(3021), "3021");
  assert.equal(numberKeyOf("COF-A"), "cof-a");
  assert.notEqual(numberKeyOf("0110"), numberKeyOf("110"));
  assert.equal(numberKeyOf(null), "");
});

test("date d'indice 0 : la plus ancienne date lisible des lignes COFFRAGE à l'indice 0", () => {
  const dates = formworkIssueDates([
    plan("3021", "0", "2025-11-27"),
    plan("3021", "A", "2026-03-06"),
    plan("3021", "0", "2025-12-02"), // doublon plus tardif
    plan("3031", "0", ""),
    plan("3031", "0", "pas une date"),
    plan("3041", "0", "2025-11-27", { Type_document: "ARMATURES" }),
    plan("3051", "0", "2025-11-27", { Service: "Synthese" }),
    plan("3061", 0, 1764201600, { Service: "" }), // indice et date en nombres (secondes Grist), service vide
    plan(" 3071 ", "0", "27/11/2025", { Type_document: " Coffrage " }),
    null,
  ]);
  assert.deepEqual([...dates.keys()].sort(), ["3021", "3061", "3071"]);
  assert.equal(iso(dates.get("3021")), "2025-11-27");
  assert.equal(iso(dates.get("3061")), "2025-11-27");
  assert.equal(iso(dates.get("3071")), "2025-11-27");
  assert.equal(formworkIssueDates(null).size, 0);
});

test("lien d'un étage : lu sur sa ligne-étage, la plus ancienne d'abord", () => {
  const links = readFloorLinks([
    floor(11, "Zone 1", "SS1", " 3021 "),
    floor(12, "Zone 1", "SS2"),
    floor(13, "Zone 2", "SS1", "3022"),
    floorTask(14, "Zone 1", "SS1", "FOND DE PLAN", { Lien_Structure: "9999" }), // pas une ligne-étage
    floor(15, "Zone 1", "ss1", "4000"), // doublon de l'étage SS1
  ]);
  assert.deepEqual([...links.entries()], [
    [`${zoneKeyOf("Zone 1")}/ss1`, "3021"],
    [`${zoneKeyOf("Zone 2")}/ss1`, "3022"],
  ]);
  assert.equal(readFloorLinks(null).size, 0);
});

test("tâche visée : le fond de plan, et son prédécesseur s'il lui est lié « même début » sans décalage", () => {
  const taskOf = (fields) => readTask({ Type_doc: "", ID2: "", Zone: "Zone 1", Groupe: "SS1", ...fields });
  const reception = taskOf({ id: 30, Taches: "RECEPTION ARCH/TOPO/STR" });
  const other = taskOf({ id: 31, Taches: "PLAN DE SYNTHESE RESEAUX NIV SS1" });
  const fond = (lien) => taskOf({ id: 32, Taches: "Fond de plan de synthèse  niv SS1", Lien: lien });
  const ids = ({ plan: found, anchor }) => ({ plan: found?.id ?? null, anchor: anchor?.id ?? null });
  assert.deepEqual(ids(findFloorStart([other, fond("30 DD"), reception])), { plan: 32, anchor: 30 });
  assert.deepEqual(ids(findFloorStart([reception, fond("30 DD+2")])), { plan: 32, anchor: 32 }, "décalage : le fond de plan lui-même");
  assert.deepEqual(ids(findFloorStart([reception, fond("30 FD")])), { plan: 32, anchor: 32 });
  assert.deepEqual(ids(findFloorStart([reception, fond("")])), { plan: 32, anchor: 32 });
  assert.deepEqual(ids(findFloorStart([fond("99 DD")])), { plan: 32, anchor: 32 }, "prédécesseur hors de l'étage");
  assert.deepEqual(findFloorStart([reception, other]), { plan: null, anchor: null });
  assert.deepEqual(findFloorStart(null), { plan: null, anchor: null });
  const second = taskOf({ id: 40, Taches: "FOND DE PLAN DE SYNTHESE NIV SS1 bis" });
  assert.equal(findFloorStart([second, fond("")]).plan.id, 32, "deux fonds de plan : le plus ancien");
});

test("les zones du projet, étages de Synthese à gauche et coffrages de Structure à droite", () => {
  const syntheseRows = [
    synthese(10, { Zone: "Zone 2" }),
    floor(11, "Zone 1", "SS2"),
    floor(12, "Zone 1", "SS1"),
    floorTask(13, "Zone 1", "SS1", "FOND DE PLAN"),
    floorTask(14, "Zone 1", "SS1", "CYCLE 1", { Nature: "Cycle" }),
  ];
  const projectRows = [
    ...syntheseRows,
    coffrage(20, "Zone 1", "3002", "PH SS2"),
    coffrage(21, "Zone 1", "3001", "PH SS1"),
    coffrage(22, "Zone 3", "3010", "RDC"),
    structure(23, { Type_doc: "ARMATURES", Zone: "Zone 1", ID2: "4001", Taches: "PH SS1" }),
    structure(24, { Zone: "Zone 4" }),
    row(25, { Service: "Topographie", Zone: "Zone 5", Taches: "Relevé", Type_doc: "COFFRAGE" }),
  ];
  const model = buildStructureLink({ syntheseRows, projectRows });
  assert.deepEqual(model.zones.map((zone) => zone.label), ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"]);
  const [zone1, zone2, zone3] = model.zones;
  assert.deepEqual(zone1.floors.map((item) => item.name), ["SS1", "SS2"]);
  assert.deepEqual(zone1.formworks.map(({ id, number, name, label }) => ({ id, number, name, label })), [
    { id: 21, number: "3001", name: "PH SS1", label: "3001 — PH SS1" },
    { id: 20, number: "3002", name: "PH SS2", label: "3002 — PH SS2" },
  ]);
  assert.deepEqual([zone2.floors, zone2.formworks], [[], []], "zone sans étage ni coffrage : affichée quand même");
  assert.deepEqual(zone3.floors, []);
  assert.deepEqual(zone3.formworks.map((item) => item.label), ["3010 — RDC"]);
});

test("une même zone écrite différemment dans les deux services n'apparaît qu'une fois", () => {
  const syntheseRows = [floor(11, "Zone 1", "SS1")];
  const model = buildStructureLink({
    syntheseRows,
    projectRows: [...syntheseRows, coffrage(20, "ZONE-1", "3001", "PH SS1")],
  });
  assert.equal(model.zones.length, 1);
  assert.deepEqual(model.zones[0].floors.map((item) => item.name), ["SS1"]);
  assert.deepEqual(model.zones[0].formworks.map((item) => item.label), ["3001 — PH SS1"]);
});

test("coffrages triés par N° (ordre naturel) puis par nom ; coffrage sans zone dans « Sans zone », à la fin", () => {
  const model = buildStructureLink({
    projectRows: [
      coffrage(1, "Zone 1", "3010", "B"),
      coffrage(2, "Zone 1", "302", "A"),
      coffrage(3, "Zone 1", "", "Sans numéro"),
      coffrage(4, "Zone 1", "302", "0 avant A"),
      coffrage(5, "", "3099", "Hors zone"),
    ],
  });
  assert.deepEqual(model.zones.map((zone) => zone.label), ["Zone 1", "Sans zone"]);
  assert.deepEqual(model.zones[0].formworks.map((item) => item.label), [
    "302 — 0 avant A",
    "302 — A",
    "3010 — B",
    "Sans numéro",
  ]);
  assert.deepEqual(model.zones[1].formworks.map((item) => item.label), ["3099 — Hors zone"]);
  assert.deepEqual(model.zones[1].floors, []);
});

test("projet sans ligne : aucune zone", () => {
  assert.deepEqual(buildStructureLink({}), { zones: [] });
  assert.deepEqual(buildStructureLink(), { zones: [] });
  assert.deepEqual(buildStructureLink({ syntheseRows: null, projectRows: null, planRows: null }), { zones: [] });
});

test("état du lien de chaque étage, date d'indice 0 et étages servis de chaque coffrage", () => {
  const zone = "Zone 1";
  const fondDePlan = (id, floorName, start) => floorTask(id, zone, floorName, `FOND DE PLAN DE SYNTHESE NIV ${floorName}`, {
    Diff_coffrage: start,
    Diff_armature: start,
    Duree_1: 1,
  });
  const syntheseRows = [
    floor(1, zone, "A"), // pas de lien
    floor(2, zone, "B", "9999"), // coffrage introuvable
    floor(3, zone, "C", "3001"), // pas de fond de plan
    floor(4, zone, "D", "3002"), fondDePlan(40, "D", null), // pas d'indice 0
    floor(5, zone, "E", "3001"), fondDePlan(50, "E", "2025-11-27"), // à jour
    floor(6, zone, "F", "3001"), fondDePlan(60, "F", "2026-01-02"), // autre date
    floor(7, zone, "G", "3001"), fondDePlan(70, "G", null), // pas encore daté
    floor(8, zone, "H", "3003"), fondDePlan(80, "H", "2025-12-01"), // indice 0 un samedi : à jour le lundi
  ];
  const projectRows = [
    coffrage(20, zone, "3001", "PH A"),
    coffrage(21, zone, "3002", "PH B"),
    coffrage(22, zone, "3003", "PH C"),
  ];
  const planRows = [plan("3001", "0", "2025-11-27"), plan("3003", "0", "2025-11-29")];
  const [section] = buildStructureLink({ syntheseRows, projectRows, planRows }).zones;
  const byName = Object.fromEntries(section.floors.map((item) => [item.name, item]));
  assert.deepEqual(Object.fromEntries(section.floors.map((item) => [item.name, item.state])), {
    A: LINK_STATES.none,
    B: LINK_STATES.missing,
    C: LINK_STATES.noPlan,
    D: LINK_STATES.waiting,
    E: LINK_STATES.current,
    F: LINK_STATES.stale,
    G: LINK_STATES.stale,
    H: LINK_STATES.current,
  });
  assert.equal(byName.A.formworkNumber, "");
  assert.deepEqual([byName.B.formworkNumber, byName.B.formwork], ["9999", null]);
  assert.equal(byName.C.plan, null);
  assert.equal(byName.D.expectedStart, null);
  assert.equal(byName.E.formwork.label, "3001 — PH A");
  assert.deepEqual([byName.E.plan.id, byName.E.plan.name, iso(byName.E.plan.start)], [50, "FOND DE PLAN DE SYNTHESE NIV E", "2025-11-27"]);
  assert.equal(iso(byName.H.expectedStart), "2025-12-01");
  const formworks = Object.fromEntries(section.formworks.map((item) => [item.number, item]));
  assert.equal(iso(formworks["3001"].issueDate), "2025-11-27");
  assert.equal(formworks["3002"].issueDate, null);
  assert.deepEqual(formworks["3001"].floorNames.slice().sort(), ["C", "E", "F", "G"]);
  assert.deepEqual(formworks["3002"].floorNames, ["D"]);
  assert.equal(formworks["3001"].zoneKey, zoneKeyOf(zone));
});

test("deux coffrages de même N° : celui de la zone de l'étage ; sinon le premier du projet", () => {
  const syntheseRows = [
    floor(1, "Zone 1", "SS1", "3001"),
    floor(2, "Zone 2", "SS1", "3001"),
    floor(3, "Zone 3", "SS1", "3001"),
  ];
  const projectRows = [coffrage(20, "Zone 1", "3001", "Zone 1 COF"), coffrage(21, "Zone 2", "3001", "Zone 2 COF")];
  const zones = buildStructureLink({ syntheseRows, projectRows }).zones;
  assert.deepEqual(zones.map((zone) => zone.floors[0].formwork?.id), [20, 21, 20]);
});

// Review Focus 2.
test("N° écrit différemment dans les deux tables (nombre, espaces, casse) : la date est trouvée", () => {
  const projectRows = [
    coffrage(20, "Zone 1", 3021, "PH SS1"),
    coffrage(21, "Zone 1", "cof-A", "PH SS2"),
    coffrage(22, "Zone 1", "0110", "PB"),
  ];
  const planRows = [plan(" 3021 ", "0", "2025-11-27"), plan("COF-A", "0", "2025-11-28"), plan("110", "0", "2025-11-27")];
  const [zone] = buildStructureLink({ projectRows, planRows }).zones;
  assert.deepEqual(zone.formworks.map((item) => [item.number, iso(item.issueDate)]), [
    ["0110", null],
    ["3021", "2025-11-27"],
    ["cof-A", "2025-11-28"],
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run : `node --test tests/structureLinkModel.test.mjs`
Expected: FAIL — `LINK_STATES`, `findFloorStart`, `formworkIssueDates`, `numberKeyOf`, `readFloorLinks` ne sont pas exportés.

- [ ] **Step 3: Write minimal implementation**

Remplacer tout `Planning Projet/assets/js/services/structureLinkModel.js` par :

```js
// Fenêtre « Lien Structure » de la vue Synthese : zone par zone, les étages de Synthese en
// face des coffrages de Structure (documents de type COFFRAGE), le coffrage lié à chaque
// étage (colonne Lien_Structure de sa ligne-étage) et la date de diffusion à l'indice 0 de
// chaque coffrage (table ListePlan_NDC_COF). Module pur, sans DOM ni Grist.
import {
  NO_ZONE_KEY,
  NO_ZONE_LABEL,
  TASK_COLUMNS,
  buildSections,
  floorKeyOf,
  isFloorRow,
  nextWorkingDay,
  zoneKeyOf,
} from "./syntheseTaskModel.js";
import { parseGristDate } from "./syntheseTasks.js";

const STRUCTURE_SERVICE_KEY = "structure";
const FORMWORK_TYPE = "COFFRAGE";
const FIRST_INDICE = "0";
const PLAN_NAME_START = "fond de plan de synthese";

// Colonnes lues dans ListePlan_NDC_COF.
const PLAN_COLUMNS = Object.freeze({
  type: "Type_document",
  number: "NumeroDocument",
  indice: "Indice",
  date: "DateDiffusion",
  service: "Service",
});

// État du lien d'un étage : pas de lien ; coffrage introuvable ; étage sans fond de plan ;
// coffrage sans indice 0 ; fond de plan à la date d'indice 0 ; fond de plan à une autre date.
export const LINK_STATES = Object.freeze({
  none: "none",
  missing: "missing",
  noPlan: "noPlan",
  waiting: "waiting",
  current: "current",
  stale: "stale",
});

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function plain(value) {
  return toText(value).normalize("NFD").replace(/\p{M}/gu, "");
}

// Sans accents, sans casse, espaces resserrés.
function plainKey(value) {
  return plain(value).replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

function compareNatural(left, right) {
  return left.localeCompare(right, "fr", { sensitivity: "base", numeric: true });
}

function isSameDay(left, right) {
  return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
}

function floorId(zoneKey, floorKey) {
  return `${zoneKey}/${floorKey}`;
}

// Clé de comparaison d'un N° de document : espaces resserrés, casse ignorée. Les zéros
// comptent : « 0110 » n'est pas « 110 ».
export function numberKeyOf(value) {
  return toText(value).replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

// Coffrage de Structure : une ligne nommée du service Structure dont le type de document
// contient « COFFRAGE » (même règle que le planning Structure).
export function isFormworkRow(row) {
  const id = Number(row?.[TASK_COLUMNS.id]);
  return Number.isInteger(id) && id > 0 &&
    plainKey(row?.[TASK_COLUMNS.service]) === STRUCTURE_SERVICE_KEY &&
    plain(row?.[TASK_COLUMNS.typeDoc]).toLocaleUpperCase("fr").includes(FORMWORK_TYPE) &&
    Boolean(toText(row?.[TASK_COLUMNS.name]));
}

export function formworkLabel({ number = "", name = "" } = {}) {
  return number ? `${number} — ${name}` : name;
}

// Date de diffusion à l'indice 0 de chaque coffrage, par clé de N° : la plus ancienne des
// dates lisibles des lignes COFFRAGE (service Structure, ou sans service) à l'indice « 0 ».
export function formworkIssueDates(planRows) {
  const dates = new Map();
  (Array.isArray(planRows) ? planRows : []).forEach((row) => {
    const service = plainKey(row?.[PLAN_COLUMNS.service]);
    if (service && service !== STRUCTURE_SERVICE_KEY) return;
    if (!plain(row?.[PLAN_COLUMNS.type]).toLocaleUpperCase("fr").includes(FORMWORK_TYPE)) return;
    if (toText(row?.[PLAN_COLUMNS.indice]) !== FIRST_INDICE) return;
    const key = numberKeyOf(row?.[PLAN_COLUMNS.number]);
    const date = parseGristDate(row?.[PLAN_COLUMNS.date]);
    if (!key || !date) return;
    const known = dates.get(key);
    if (!known || date < known) dates.set(key, date);
  });
  return dates;
}

// N° du coffrage lié à chaque étage (clé « zone/étage »), lu sur ses lignes-étages : la
// première valeur non vide, de la plus ancienne ligne à la plus récente.
export function readFloorLinks(syntheseRows) {
  const links = new Map();
  (Array.isArray(syntheseRows) ? syntheseRows : [])
    .filter(isFloorRow)
    .sort((left, right) => Number(left[TASK_COLUMNS.id]) - Number(right[TASK_COLUMNS.id]))
    .forEach((row) => {
      const number = toText(row[TASK_COLUMNS.structureLink]);
      const key = floorId(zoneKeyOf(row[TASK_COLUMNS.zone]), floorKeyOf(row[TASK_COLUMNS.name]));
      if (number && !links.has(key)) links.set(key, number);
    });
  return links;
}

// Le fond de plan d'un étage (sa plus ancienne tâche « FOND DE PLAN DE SYNTHESE … ») et son
// ancre, la tâche qui reçoit la date : le prédécesseur du fond de plan quand il lui est lié
// « même début » sans décalage (RECEPTION ARCH/TOPO/STR dans le modèle), sinon le fond de plan.
export function findFloorStart(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const plan = list
    .filter((task) => plainKey(task?.name).startsWith(PLAN_NAME_START))
    .sort((left, right) => left.id - right.id)[0] || null;
  if (!plan) return { plan: null, anchor: null };
  const link = plan.link;
  const pred = link?.type === "DD" && !link.lag ? list.find((task) => task.id === link.predId) : null;
  return { plan, anchor: pred || plan };
}

function readFormwork(row) {
  const number = toText(row?.[TASK_COLUMNS.id2]);
  const name = toText(row?.[TASK_COLUMNS.name]);
  return { id: Number(row?.[TASK_COLUMNS.id]), number, name, label: formworkLabel({ number, name }) };
}

// Par N° (ordre naturel), les coffrages sans N° à la fin, puis par nom.
function compareFormworks(left, right) {
  if (Boolean(left.number) !== Boolean(right.number)) return left.number ? -1 : 1;
  return compareNatural(left.number, right.number) || compareNatural(left.name, right.name) || left.id - right.id;
}

// Conditions lues de haut en bas (voir LINK_STATES).
function linkStateOf({ number, formwork, plan, expectedStart }) {
  if (!number) return LINK_STATES.none;
  if (!formwork) return LINK_STATES.missing;
  if (!plan) return LINK_STATES.noPlan;
  if (!expectedStart) return LINK_STATES.waiting;
  return isSameDay(plan.start, expectedStart) ? LINK_STATES.current : LINK_STATES.stale;
}

// Les zones du projet (celles de tous les services, une seule par graphie, triées), chacune
// avec ses étages de Synthese — leur coffrage lié, leur fond de plan, l'état du lien — et ses
// coffrages de Structure — leur date d'indice 0, les étages qu'ils servent ; « Sans zone » à
// la fin pour les coffrages qui n'en ont pas. `syntheseRows` : les lignes du tableau de tâches
// (service Synthese) ; `projectRows` : Planning_Projet du projet, tous services ; `planRows` :
// ListePlan_NDC_COF du projet.
export function buildStructureLink({ syntheseRows = [], projectRows = [], planRows = [] } = {}) {
  const synthese = Array.isArray(syntheseRows) ? syntheseRows : [];
  const project = Array.isArray(projectRows) ? projectRows : [];
  const issueDates = formworkIssueDates(planRows);
  const links = readFloorLinks(synthese);

  const allFormworks = project.filter(isFormworkRow).map((row) => {
    const formwork = readFormwork(row);
    return {
      ...formwork,
      zoneKey: zoneKeyOf(row?.[TASK_COLUMNS.zone]),
      issueDate: (formwork.number && issueDates.get(numberKeyOf(formwork.number))) || null,
      floorNames: [],
    };
  }).sort(compareFormworks);
  const formworksByZone = new Map();
  allFormworks.forEach((formwork) => {
    if (!formworksByZone.has(formwork.zoneKey)) formworksByZone.set(formwork.zoneKey, []);
    formworksByZone.get(formwork.zoneKey).push(formwork);
  });
  // Coffrage d'un N° : celui de la zone de l'étage d'abord, sinon le premier du projet.
  const findFormwork = (number, zoneKey) => {
    const key = numberKeyOf(number);
    const sameNumber = (formwork) => numberKeyOf(formwork.number) === key;
    return (formworksByZone.get(zoneKey) || []).find(sameNumber) || allFormworks.find(sameNumber) || null;
  };

  const sections = buildSections({
    rows: synthese,
    sharedZones: project.map((row) => row?.[TASK_COLUMNS.zone]),
  });
  const zones = sections.map((section) => ({
    zoneKey: section.zoneKey,
    zoneName: section.zoneName,
    label: section.label,
    floors: section.floors.map((floor) => {
      const number = links.get(floorId(section.zoneKey, floor.key)) || "";
      const formwork = number ? findFormwork(number, section.zoneKey) : null;
      const { plan } = findFloorStart(floor.tasks);
      const expectedStart = formwork?.issueDate ? nextWorkingDay(formwork.issueDate) : null;
      if (formwork) formwork.floorNames.push(floor.name);
      return {
        key: floor.key,
        name: floor.name,
        formworkNumber: number,
        formwork,
        plan: plan ? { id: plan.id, name: plan.name, start: plan.start } : null,
        expectedStart,
        state: linkStateOf({ number, formwork, plan, expectedStart }),
      };
    }),
    formworks: formworksByZone.get(section.zoneKey) || [],
  }));
  if (formworksByZone.has(NO_ZONE_KEY) && !zones.some((zone) => zone.zoneKey === NO_ZONE_KEY)) {
    zones.push({
      zoneKey: NO_ZONE_KEY,
      zoneName: "",
      label: NO_ZONE_LABEL,
      floors: [],
      formworks: formworksByZone.get(NO_ZONE_KEY),
    });
  }
  return { zones };
}
```

Puis, dans `Planning Projet/assets/js/ui/structureLinkDialog.js` (appel provisoire, pour que la fenêtre de l'étape 1 continue de marcher jusqu'à la tâche 4) :

1. Après l'import de `buildStructureLink`, ajouter :

```js
import { isSyntheseServiceRow } from "../services/syntheseTaskModel.js";
```

2. Remplacer `const model = buildStructureLink(rows);` par :

```js
    const projectRows = Array.isArray(rows) ? rows : [];
    const model = buildStructureLink({ syntheseRows: projectRows.filter(isSyntheseServiceRow), projectRows });
```

- [ ] **Step 4: Run test to verify it passes**

Run : `node --test tests/structureLinkModel.test.mjs tests/structureLinkDialog.test.mjs`
Expected: PASS (13 tests du modèle, 8 tests de la fenêtre inchangés).

- [ ] **Step 5: Point de contrôle**

Run : `node --test tests/*.test.mjs`
Expected: 366 tests, 0 échec. Pas de commit.

---

### Task 3: Contrôleur — source et écriture du lien (`syntheseTasksController.js`)

**Files:**
- Modify: `Planning Projet/assets/js/ui/syntheseTasksController.js`
- Test: `Planning Projet/tests/syntheseTasksController.test.mjs` (ajouts en fin de fichier, un import élargi)

**Interfaces:**
- Consumes: `moveTaskStart`, `detectStructureLinkColumn`, `TASK_COLUMNS.structureLink` (tâche 1) ; `findFloorStart` (tâche 2) ; dans le contrôleur : `isEditable`, `lockedMessage`, `displayedRows`, `getProject`, `getSharedZones`, `findFloor`, `createOp`, `submit`, `clearStatus`, `fail`, `toColumns`, `describeWriteError`, `cascadeFrom`, `dateFieldsOf`, `buildSections`.
- Produces (méthodes de l'objet renvoyé par `createSyntheseTasksController`) :
  - `getStructureLinkSource() → { ready: boolean, rows: object[], editable: boolean, lockedMessage: string, linkColumn: true|false|null }`
  - `applyStructureLink({ zoneKey, floorKey, formworkNumber?, date? }) → Promise<{ ok: true } | { ok: false, error: string }>` — `formworkNumber` : N° à mémoriser (`""` : délier ; absent : inchangé) ; `date` : `Date` d'indice 0 à poser (absente : aucune).

- [ ] **Step 1: Write the failing test**

Dans `Planning Projet/tests/syntheseTasksController.test.mjs` :

1. Remplacer la ligne d'import des lignes du modèle par :

```js
import { datedRows, templateRows } from "./helpers/templateRows.mjs";
```

2. Ajouter à la fin du fichier :

```js
// ---------- Lien Structure : coffrage d'un étage et date d'indice 0 ----------

const SS1 = { zoneKey: Z2A, floorKey: "ss1" };
const NOV_27 = new Date(2025, 10, 27); // jeudi
const NO_LINK_COLUMN = "La colonne « Lien_Structure » (Texte) manque dans Planning_Projet : ajoutez-la pour lier les étages aux coffrages.";

// Zone Z2A, étage SS1 du modèle (ligne-étage 201, RECEPTION 202, FOND DE PLAN 204), colonne
// Lien_Structure présente. `dated` : durées de la capture, RECEPTION au 02/01/26.
function linkFloorRows({ dated = false, link = "" } = {}) {
  const rows = dated ? datedRows({ zoneName: "Zone Z2A" }) : templateRows({ zoneName: "Zone Z2A" });
  return rows.map((row) => ({ ...row, Lien_Structure: row.id === 201 ? link : "" }));
}

const linkOf = (env, rowId) => env.controller.getStructureLinkSource().rows.find((row) => row.id === rowId).Lien_Structure;

test("lien Structure : le N° sur la ligne-étage, la date sur RECEPTION, la suite en cascade — une seule écriture", async () => {
  const env = setup({ rows: linkFloorRows() });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: " 3021 ", date: NOV_27 });
  assert.deepEqual(result, { ok: true });
  assert.equal(env.writes.length, 1);
  const [link, anchor, cascade] = env.writes[0];
  assert.deepEqual(link, ["BulkUpdateRecord", "Planning_Projet", [201], { Lien_Structure: ["3021"] }]);
  assert.deepEqual(anchor, ["UpdateRecord", "Planning_Projet", 202, {
    Diff_coffrage: "2025-11-27",
    Diff_armature: "2025-11-27",
    Duree_1: 0,
  }]);
  assert.equal(cascade[0], "BulkUpdateRecord");
  assert.deepEqual(cascade[2], [204, 205, 206, 207, 208, 209, 211, 213, 214, 215, 216, 218, 219, 221, 222, 223, 224, 225, 226]);
  assert.equal(cascade[3].Diff_coffrage[0], "2025-11-27", "FOND DE PLAN démarre le même jour");
  assert.equal(cascade[3].Diff_coffrage.at(-1), "2025-12-04", "DEMARRAGE GO : 5 jours ouvrés après le visa");
  assert.equal(isoOf(env.taskLine(204).start), "2025-11-27");
  assert.equal(linkOf(env, 201), "3021");
});

test("lien Structure : étage déjà daté, les tâches se décalent en gardant leur durée", async () => {
  const env = setup({ rows: linkFloorRows({ dated: true }) });
  await activate(env);
  await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021", date: NOV_27 });
  assert.equal(isoOf(env.taskLine(202).start), "2025-11-27");
  assert.deepEqual(
    [isoOf(env.taskLine(204).start), isoOf(env.taskLine(204).end), env.taskLine(204).durationDays],
    ["2025-11-27", "2025-11-28", 2]
  );
  assert.equal(isoOf(env.taskLine(206).start), "2025-12-01");
});

// Review Focus 3.
test("lien Structure : « Mettre à jour » recale un fond de plan retouché à la main, sans toucher au lien", async () => {
  const rows = linkFloorRows({ dated: true, link: "3021" })
    .map((row) => (row.id === 204 ? { ...row, Diff_coffrage: "2026-01-06", Diff_armature: "2026-01-07" } : row));
  const env = setup({ rows });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, date: new Date(2026, 0, 2) });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(env.writes, [[
    ["BulkUpdateRecord", "Planning_Projet", [204], {
      Diff_coffrage: ["2026-01-02"],
      Diff_armature: ["2026-01-05"],
      Duree_1: [2],
    }],
  ]]);
});

test("lien Structure : délier vide la colonne et laisse les dates", async () => {
  const env = setup({ rows: linkFloorRows({ dated: true, link: "3021" }) });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: "" });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(env.writes, [[["BulkUpdateRecord", "Planning_Projet", [201], { Lien_Structure: [""] }]]]);
  assert.equal(isoOf(env.taskLine(202).start), "2026-01-02");
});

test("lien Structure : un autre coffrage remplace le premier", async () => {
  const env = setup({ rows: linkFloorRows({ dated: true, link: "3021" }) });
  await activate(env);
  await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3031", date: NOV_27 });
  assert.deepEqual(env.writes[0][0], ["BulkUpdateRecord", "Planning_Projet", [201], { Lien_Structure: ["3031"] }]);
  assert.equal(linkOf(env, 201), "3031");
  assert.equal(isoOf(env.taskLine(204).start), "2025-11-27");
});

test("lien Structure : rien ne change, rien n'est écrit", async () => {
  const env = setup({ rows: linkFloorRows({ dated: true, link: "3021" }) });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021", date: new Date(2026, 0, 2) });
  assert.deepEqual(result, { ok: true });
  assert.equal(env.writes.length, 0);
});

// Review Focus 1.
test("lien Structure : une zone filtrée dans le bandeau n'empêche pas d'écrire ailleurs", async () => {
  const env = setup({ rows: linkFloorRows() });
  await activate(env);
  env.controller.setZoneFilter("Zone Autre");
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021", date: NOV_27 });
  assert.deepEqual(result, { ok: true });
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0].length, 3);
});

test("lien Structure : refus sans écriture", async () => {
  const locked = setup({ rows: linkFloorRows() });
  await activate(locked, { editing: false });
  const lockedResult = await locked.controller.applyStructureLink({ ...SS1, formworkNumber: "3021" });
  assert.equal(lockedResult.ok, false);
  assert.match(lockedResult.error, /Activez « Editer »/);

  const readOnly = setup({ rows: linkFloorRows(), accessMode: "readonly" });
  await activate(readOnly);
  assert.match((await readOnly.controller.applyStructureLink({ ...SS1, formworkNumber: "3021" })).error, /lecture seule/);

  const noColumn = setup({ rows: templateRows({ zoneName: "Zone Z2A" }) });
  await activate(noColumn);
  assert.deepEqual(
    await noColumn.controller.applyStructureLink({ ...SS1, formworkNumber: "3021" }),
    { ok: false, error: NO_LINK_COLUMN }
  );

  const env = setup({ rows: linkFloorRows() });
  await activate(env);
  assert.deepEqual(
    await env.controller.applyStructureLink({ zoneKey: Z2A, floorKey: "inconnu", formworkNumber: "3021" }),
    { ok: false, error: "Cet étage n'existe plus : fermez la fenêtre puis rouvrez-la." }
  );

  // Étage connu par le Groupe de ses tâches, sans ligne-étage.
  const loose = setup({ rows: floorRows().filter((row) => row.id !== 20).map((row) => ({ ...row, Lien_Structure: "" })) });
  await activate(loose);
  assert.deepEqual(
    await loose.controller.applyStructureLink({ zoneKey: Z2A, floorKey: "phrdb", formworkNumber: "3001" }),
    { ok: false, error: "Cet étage n'a pas de ligne « étage » dans Planning_Projet : le lien ne peut pas être mémorisé." }
  );

  // Étage sans tâche « FOND DE PLAN DE SYNTHESE ».
  const noPlan = setup({ rows: floorRows().map((row) => ({ ...row, Lien_Structure: "" })) });
  await activate(noPlan);
  assert.deepEqual(
    await noPlan.controller.applyStructureLink({ zoneKey: Z2A, floorKey: "phrdb", date: NOV_27 }),
    { ok: false, error: "Cet étage n'a pas de tâche « FOND DE PLAN DE SYNTHESE » : aucune date ne peut être posée." }
  );

  [locked, readOnly, noColumn, env, loose, noPlan].forEach((each) => assert.equal(each.writes.length, 0));
});

// Review Focus 4.
test("lien Structure : écriture refusée par Grist — l'affichage revient et l'erreur est rendue", async () => {
  const env = setup({ rows: linkFloorRows(), applyUserActions: () => { throw new Error("réseau"); } });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021", date: NOV_27 });
  assert.deepEqual(result, { ok: false, error: "L'enregistrement dans Grist a échoué. Réessayez." });
  assert.equal(linkOf(env, 201), "");
  assert.equal(env.taskLine(202).start, null);
  assert.equal(env.taskLine(204).start, null);
  assert.equal(env.table.statuses.at(-1).tone, "error");
});

// Review Focus 4 : colonne absente du document (production) alors que rien ne le laissait voir.
test("lien Structure : Grist ne connaît pas la colonne — message précis, colonne notée absente", async () => {
  const env = setup({
    rows: linkFloorRows(),
    applyUserActions: () => { throw new Error("Invalid column 'Lien_Structure'"); },
  });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021" });
  assert.deepEqual(result, { ok: false, error: NO_LINK_COLUMN });
  assert.equal(env.controller.getStructureLinkSource().linkColumn, false);
});

test("source de la fenêtre : lignes affichées (écriture en attente comprise), droits, colonne", async () => {
  const pending = manualWrites();
  const env = setup({ rows: linkFloorRows(), applyUserActions: pending.applyUserActions });
  assert.equal(env.controller.getStructureLinkSource().ready, false, "rien n'est chargé avant l'activation");
  await activate(env);
  const before = env.controller.getStructureLinkSource();
  assert.deepEqual([before.ready, before.editable, before.lockedMessage, before.linkColumn], [true, true, "", true]);
  const writing = env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021" });
  assert.equal(linkOf(env, 201), "3021", "visible avant la réponse de Grist");
  pending.calls[0].resolve({ retValues: [] });
  assert.deepEqual(await writing, { ok: true });
  env.controller.setEditingEnabled(false);
  const locked = env.controller.getStructureLinkSource();
  assert.equal(locked.editable, false);
  assert.match(locked.lockedMessage, /Activez « Editer »/);
});

test("source de la fenêtre : colonne Lien_Structure absente des lignes lues", async () => {
  const env = setup({ rows: templateRows({ zoneName: "Zone Z2A" }) });
  await activate(env);
  assert.equal(env.controller.getStructureLinkSource().linkColumn, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run : `node --test tests/syntheseTasksController.test.mjs`
Expected: FAIL — `env.controller.applyStructureLink is not a function` / `getStructureLinkSource is not a function` sur les 12 nouveaux tests ; les anciens passent.

- [ ] **Step 3: Write minimal implementation**

Dans `Planning Projet/assets/js/ui/syntheseTasksController.js` :

1. Imports. Dans la liste importée de `../services/syntheseTaskModel.js`, ajouter `detectStructureLinkColumn` (après `detectFloorColumn`) et `moveTaskStart` (après `groupRemovalIds`). Après l'import de `cascadeFrom`, ajouter :

```js
import { findFloorStart } from "../services/structureLinkModel.js";
```

2. `MESSAGES` : ajouter après `templateFailed` :

```js
  noLinkColumn: "La colonne « Lien_Structure » (Texte) manque dans Planning_Projet : ajoutez-la pour lier les étages aux coffrages.",
  floorGone: "Cet étage n'existe plus : fermez la fenêtre puis rouvrez-la.",
  noFloorRow: "Cet étage n'a pas de ligne « étage » dans Planning_Projet : le lien ne peut pas être mémorisé.",
  noPlanTask: "Cet étage n'a pas de tâche « FOND DE PLAN DE SYNTHESE » : aucune date ne peut être posée.",
```

3. `describeWriteError` : juste avant la ligne `// Grist refuse une colonne inconnue : seule l'écriture d'un étage utilise Etage.`, ajouter :

```js
  // Colonne du lien Structure inconnue de Grist.
  if (/\bLien_Structure\b/.test(message)) return MESSAGES.noLinkColumn;
```

4. État du contrôleur : après `let templateColumns = null;`, ajouter :

```js
  // Colonne Lien_Structure (lien vers un coffrage de Structure) : même principe que Etage.
  let structureLinkColumn = null;
```

5. `load` : dans le bloc du changement de projet, après `templateColumns = null;`, ajouter `structureLinkColumn = null;` ; après `templateColumns = detectTemplateColumns(rows);`, ajouter :

```js
    structureLinkColumn = detectStructureLinkColumn(rows);
```

6. Juste avant `function toggleZone(zoneKey) {`, ajouter :

```js
  // Toutes les zones du projet, sans le filtre du bandeau : la fenêtre « Lien Structure » les
  // montre toutes.
  function allSections() {
    const project = getProject();
    return project ? buildSections({ rows: displayedRows(), sharedZones: getSharedZones(project) }) : [];
  }

  // Fenêtre « Lien Structure » : mémorise le coffrage d'un étage (formworkNumber : son N° ;
  // "" : délier ; absent : inchangé) et / ou pose une date de diffusion sur le début de l'étage
  // (date). Une seule opération : le lien et les dates s'écrivent ensemble, ou pas du tout. La
  // réponse arrive quand Grist a répondu.
  function applyStructureLink({ zoneKey, floorKey, formworkNumber, date } = {}) {
    const refusal = (error) => Promise.resolve({ ok: false, error });
    if (!isEditable()) return refusal(lockedMessage());
    const linking = formworkNumber !== undefined;
    if (linking && structureLinkColumn === false) return refusal(MESSAGES.noLinkColumn);
    const all = allSections();
    const floor = findFloor(all.find((section) => section.zoneKey === zoneKey) || null, floorKey);
    if (!floor) return refusal(MESSAGES.floorGone);
    const changes = new Map();
    const actions = [];
    if (linking) {
      if (!floor.rowIds.length) return refusal(MESSAGES.noFloorRow);
      const number = toText(formworkNumber);
      const shown = displayedRows();
      const rowIds = floor.rowIds.filter((rowId) => {
        const row = shown.find((candidate) => Number(candidate?.[TASK_COLUMNS.id]) === rowId);
        return toText(row?.[TASK_COLUMNS.structureLink]) !== number;
      });
      if (rowIds.length) {
        rowIds.forEach((rowId) => changes.set(rowId, { [TASK_COLUMNS.structureLink]: number }));
        actions.push(["BulkUpdateRecord", PLANNING_TABLE, rowIds, { [TASK_COLUMNS.structureLink]: rowIds.map(() => number) }]);
      }
    }
    if (date != null) {
      const { anchor } = findFloorStart(floor.tasks);
      if (!anchor) return refusal(MESSAGES.noPlanTask);
      const moved = moveTaskStart(anchor, date);
      if (!moved.ok) return refusal(moved.error);
      if (Object.keys(moved.fields).length) {
        changes.set(anchor.id, moved.fields);
        actions.push(["UpdateRecord", PLANNING_TABLE, anchor.id, moved.fields]);
      }
      // Même si l'ancre ne bouge pas : un fond de plan retouché à la main est recalé sur elle.
      const updates = cascadeFrom(moved.task, all.flatMap((section) => section.tasks));
      if (updates.length) {
        const fieldsList = updates.map(dateFieldsOf);
        updates.forEach((update, index) => changes.set(update.id, fieldsList[index]));
        actions.push(["BulkUpdateRecord", PLANNING_TABLE, updates.map((update) => update.id), toColumns(fieldsList)]);
      }
    }
    if (!actions.length) return Promise.resolve({ ok: true });
    clearStatus();
    // Une opération écartée par l'échec d'une précédente n'appelle aucun des deux retours.
    let outcome = { ok: false, error: describeWriteError(null) };
    return submit(createOp({ changes, actions }), {
      onSuccess: () => {
        outcome = { ok: true };
      },
      onFailure: (error, dropped) => {
        const message = describeWriteError(error);
        if (message === MESSAGES.noLinkColumn) structureLinkColumn = false;
        fail("Lien Structure impossible :", error, dropped);
        outcome = { ok: false, error: message };
      },
    }).then(() => outcome);
  }
```

7. Dans l'objet renvoyé (après la méthode `refresh`), ajouter :

```js
    // Ce que la fenêtre « Lien Structure » lit du tableau : les lignes telles qu'affichées
    // (écritures en attente comprises) et ce qui permet, ou non, d'y écrire.
    getStructureLinkSource() {
      const editable = isEditable();
      return {
        ready: loaded && !readError,
        rows: displayedRows(),
        editable,
        lockedMessage: editable ? "" : lockedMessage(),
        linkColumn: structureLinkColumn,
      };
    },
    applyStructureLink,
```

- [ ] **Step 4: Run test to verify it passes**

Run : `node --test tests/syntheseTasksController.test.mjs`
Expected: PASS (tous, dont les 12 nouveaux).

- [ ] **Step 5: Point de contrôle**

Run : `node --test tests/*.test.mjs`
Expected: 378 tests, 0 échec. Pas de commit.

---

### Task 4: Fenêtre — états, glisser-déposer, boutons, messages (`structureLinkDialog.js`)

**Files:**
- Modify: `Planning Projet/assets/js/ui/structureLinkDialog.js` (réécrit)
- Test: `Planning Projet/tests/structureLinkDialog.test.mjs` (réécrit)

**Interfaces:**
- Consumes: `LINK_STATES`, `buildStructureLink({ syntheseRows, projectRows, planRows })` (tâche 2) ; `formatDate(date)` de `syntheseTaskModel.js` (« Jeu 27/11/25 », « — » sans date) ; la source et l'écriture de la tâche 3, injectées.
- Produces :
  - `renderStructureLink(body, model, { editable = false, doc = document }) → { floors: Element[], formworks: Element[] }`
  - `createStructureLinkDialog({ dialog, title, status, body, closeButton }, { loadRows, getSource, applyLink, getProjectName, doc }) → { open, close }` avec
    - `loadRows() → Promise<{ projectRows: object[], planRows: object[] }>`
    - `getSource() → { ready, rows, editable, lockedMessage, linkColumn } | null`
    - `applyLink({ zoneKey, floorKey, formworkNumber?, date? }) → Promise<{ ok, error? }>`
  - Classes posées (utilisées par le CSS de la tâche 5) : `structure-link-floor`, `is-state-<état>`, `is-droppable`, `is-drop-target`, `structure-link-floor-name`, `structure-link-plan`, `structure-link-linkrow`, `structure-link-link`, `structure-link-action`, `structure-link-unlink`, `structure-link-formwork`, `is-draggable`, `is-dragging`, `structure-link-formwork-label`, `structure-link-issue`, `structure-link-used` ; sur la ligne d'état : `is-error`.

- [ ] **Step 1: Write the failing test**

Remplacer tout `Planning Projet/tests/structureLinkDialog.test.mjs` par :

```js
import test from "node:test";
import assert from "node:assert/strict";

import { createStructureLinkDialog, renderStructureLink } from "../assets/js/ui/structureLinkDialog.js";
import { FakeElement, createFakeEnvironment, dispatch } from "./helpers/fakeDom.mjs";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);

const HINT = "Faites glisser un coffrage sur un étage de la même zone.";
const NO_LINK_COLUMN = "La colonne « Lien_Structure » (Texte) manque dans Planning_Projet : ajoutez-la pour lier les étages aux coffrages.";

// Planning_Projet, tous services : trois coffrages de Structure (Zone 1 : 3001 et 3002 ; Zone 2 : 3010).
const PROJECT_ROWS = [
  { id: 20, Taches: "PH SS1", Zone: "Zone 1", Service: "Structure", Type_doc: "COFFRAGE", ID2: "3001" },
  { id: 21, Taches: "PH SS2", Zone: "Zone 1", Service: "Structure", Type_doc: "COFFRAGE", ID2: "3002" },
  { id: 22, Taches: "RDC", Zone: "Zone 2", Service: "Structure", Type_doc: "COFFRAGE", ID2: "3010" },
];
// Liste de plans : seul le coffrage 3001 a été diffusé à l'indice 0 (jeudi 27/11/25).
const PLAN_ROWS = [
  { Type_document: "COFFRAGE", NumeroDocument: "3001", Indice: "0", DateDiffusion: "2025-11-27", Service: "Structure" },
];

// Lignes du tableau de tâches : Zone 1 avec SS1 (RECEPTION et FOND DE PLAN liés « même début »)
// et SS2 (vide) ; Zone 2 avec RDC (vide).
function syntheseRows({ ss1Link = "", planStart = null } = {}) {
  const base = {
    NomProjet: "HOTEL DIEU", Type_doc: "", ID2: "", Groupe: "", Etage: false, Nature: "", Parent: "", Lien: "",
    Lien_Structure: "", Diff_coffrage: null, Diff_armature: null, Duree_1: 0,
  };
  return [
    { ...base, id: 11, Taches: "SS1", Zone: "Zone 1", Etage: true, Lien_Structure: ss1Link },
    { ...base, id: 12, Taches: "SS2", Zone: "Zone 1", Etage: true },
    { ...base, id: 13, Taches: "RDC", Zone: "Zone 2", Etage: true },
    { ...base, id: 30, Taches: "RECEPTION ARCH/TOPO/STR", Zone: "Zone 1", Groupe: "SS1", Diff_coffrage: planStart, Diff_armature: planStart },
    { ...base, id: 31, Taches: "FOND DE PLAN DE SYNTHESE NIV SS1", Zone: "Zone 1", Groupe: "SS1", Lien: "30 DD", Diff_coffrage: planStart, Diff_armature: planStart },
  ];
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

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
const textsOf = (node, className) => all(node, className).map((element) => element.textContent);
const floorElement = (env, zoneKey, floorKey) => all(env.body, "structure-link-floor")
  .find((element) => element.dataset.zoneKey === zoneKey && element.dataset.floorKey === floorKey);
const formworkElement = (env, number) => all(env.body, "structure-link-formwork")
  .find((element) => element.dataset.number === number);
const actionOf = (element, action) => all(element, "structure-link-action").find((button) => button.dataset.action === action);

function fakeTransfer() {
  return { data: {}, setData(type, value) { this.data[type] = value; } };
}

// Un glisser complet : prise du coffrage, survol puis dépôt sur l'étage.
function dragOnto(env, number, floor) {
  const source = formworkElement(env, number);
  const dataTransfer = fakeTransfer();
  dispatch(source, "dragstart", { dataTransfer });
  const over = dispatch(floor, "dragover", { dataTransfer });
  const drop = dispatch(floor, "drop", { dataTransfer });
  dispatch(source, "dragend");
  return { dataTransfer, over, drop };
}

function setup({
  rows = syntheseRows(),
  loadRows = async () => ({ projectRows: PROJECT_ROWS, planRows: PLAN_ROWS }),
  projectName = "HOTEL DIEU",
  source: sourceOverrides = {},
  applyLink = null,
} = {}) {
  const { doc } = createFakeEnvironment();
  const dialog = new FakeElement("dialog");
  dialog.open = false;
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
    dispatch(dialog, "close");
  };
  const elements = {
    dialog,
    title: new FakeElement("h3"),
    status: new FakeElement("p"),
    body: new FakeElement("div"),
    closeButton: new FakeElement("button"),
  };
  elements.status.hidden = true;
  // Doublure du tableau de tâches : `source.rows` peut être remplacé par un test.
  const source = { ready: true, rows, editable: true, lockedMessage: "", linkColumn: true, ...sourceOverrides };
  const calls = [];
  const requests = [];
  const controller = createStructureLinkDialog(elements, {
    loadRows: (...args) => {
      calls.push(args);
      return loadRows(...args);
    },
    getSource: () => source,
    applyLink: (request) => {
      requests.push(request);
      return applyLink ? applyLink(request, source) : Promise.resolve({ ok: true });
    },
    getProjectName: () => projectName,
    doc,
  });
  return { ...elements, controller, calls, requests, source, doc };
}

function silenceConsoleError(run) {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  return Promise.resolve().then(run).finally(() => {
    console.error = original;
  }).then(() => errors);
}

test("rendu : étages avec leur fond de plan et leur lien, coffrages avec leur indice 0", () => {
  const { doc } = createFakeEnvironment();
  const body = new FakeElement("div");
  const formwork = {
    id: 20, number: "3001", name: "PH SS1", label: "3001 — PH SS1", zoneKey: "zone1",
    issueDate: new Date(2025, 10, 27), floorNames: ["SS1", "SS2"],
  };
  const result = renderStructureLink(body, {
    zones: [
      {
        zoneKey: "zone1",
        label: "Zone 1",
        floors: [
          { key: "ss1", name: "SS1", state: "current", formworkNumber: "3001", formwork, plan: { id: 31, name: "FOND DE PLAN", start: new Date(2025, 10, 27) } },
          { key: "ss2", name: "SS2", state: "stale", formworkNumber: "3001", formwork, plan: { id: 41, name: "FOND DE PLAN", start: null } },
          { key: "ss3", name: "SS3", state: "none", formworkNumber: "", formwork: null, plan: null },
        ],
        formworks: [
          formwork,
          { id: 21, number: "", name: "Sans numéro", label: "Sans numéro", zoneKey: "zone1", issueDate: null, floorNames: [] },
        ],
      },
      { zoneKey: "zone2", label: "Zone 2", floors: [], formworks: [] },
    ],
  }, { editable: true, doc });
  assert.equal(body.children.length, 2);
  const [zone1, zone2] = body.children;
  assert.ok(zone1.classes.has("structure-link-zone"));
  const [left, right] = zone1.children;
  assert.ok(left.classes.has("structure-link-side--synthese"));
  assert.ok(right.classes.has("structure-link-side--structure"));
  assert.deepEqual(textsOf(left, "structure-link-zone-name"), ["Zone 1"]);
  assert.deepEqual(textsOf(left, "structure-link-floor-name"), ["SS1", "SS2", "SS3"]);
  assert.deepEqual(textsOf(left, "structure-link-plan"), ["Fond de plan : début Jeu 27/11/25", "Fond de plan : début —"]);
  assert.deepEqual(textsOf(left, "structure-link-link"), [
    "3001 — PH SS1 · à jour",
    "3001 — PH SS1 · à mettre à jour : ind. 0 le Jeu 27/11/25",
    "Déposez un coffrage ici",
  ]);
  assert.deepEqual(all(left, "structure-link-action").map((button) => [button.dataset.action, button.textContent]), [
    ["unlink", "×"],
    ["refresh", "Mettre à jour"],
    ["unlink", "×"],
  ]);
  assert.equal(all(left, "structure-link-unlink")[0].getAttribute("aria-label"), "Délier SS1");
  assert.ok(all(left, "structure-link-floor")[1].classes.has("is-state-stale"));
  assert.deepEqual(textsOf(right, "structure-link-formwork-label"), ["3001 — PH SS1", "Sans numéro"]);
  assert.deepEqual(textsOf(right, "structure-link-issue"), ["ind. 0 : Jeu 27/11/25", "pas d'indice 0"]);
  assert.deepEqual(textsOf(right, "structure-link-used"), ["lié : SS1, SS2"]);
  assert.deepEqual(all(right, "structure-link-formwork").map((item) => Boolean(item.draggable)), [true, false], "sans N° : ne se déplace pas");
  assert.deepEqual(textsOf(zone2, "structure-link-empty"), ["Aucun étage", "Aucun coffrage"]);
  assert.deepEqual([result.floors.length, result.formworks.length], [3, 2]);
});

test("rendu : coffrage introuvable, étage sans fond de plan, coffrage sans indice 0", () => {
  const { doc } = createFakeEnvironment();
  const body = new FakeElement("div");
  const formwork = { id: 20, number: "3001", name: "PH SS1", label: "3001 — PH SS1", zoneKey: "zone1", issueDate: null, floorNames: [] };
  renderStructureLink(body, {
    zones: [{
      zoneKey: "zone1",
      label: "Zone 1",
      floors: [
        { key: "a", name: "A", state: "missing", formworkNumber: "9999", formwork: null, plan: null },
        { key: "b", name: "B", state: "noPlan", formworkNumber: "3001", formwork, plan: null },
        { key: "c", name: "C", state: "waiting", formworkNumber: "3001", formwork, plan: { id: 1, name: "FOND DE PLAN", start: null } },
      ],
      formworks: [formwork],
    }],
  }, { editable: true, doc });
  assert.deepEqual(textsOf(body, "structure-link-link"), [
    "Coffrage 9999 introuvable",
    "3001 — PH SS1 · pas de tâche « FOND DE PLAN DE SYNTHESE » dans cet étage",
    "3001 — PH SS1 · en attente de l'indice 0",
  ]);
  assert.deepEqual(all(body, "structure-link-action").map((button) => button.dataset.action), ["unlink", "unlink", "unlink"]);
});

test("rendu en lecture seule : rien ne se déplace, aucun bouton", () => {
  const { doc } = createFakeEnvironment();
  const body = new FakeElement("div");
  const formwork = { id: 20, number: "3001", name: "PH SS1", label: "3001 — PH SS1", zoneKey: "zone1", issueDate: new Date(2025, 10, 27), floorNames: ["SS1"] };
  renderStructureLink(body, {
    zones: [{
      zoneKey: "zone1",
      label: "Zone 1",
      floors: [
        { key: "ss1", name: "SS1", state: "stale", formworkNumber: "3001", formwork, plan: { id: 31, name: "FOND DE PLAN", start: null } },
        { key: "ss2", name: "SS2", state: "none", formworkNumber: "", formwork: null, plan: null },
      ],
      formworks: [formwork],
    }],
  }, { doc });
  assert.equal(all(body, "structure-link-action").length, 0);
  assert.equal(Boolean(all(body, "structure-link-formwork")[0].draggable), false);
  assert.equal(textsOf(body, "structure-link-link")[1], "Aucun coffrage lié");
});

test("un nouveau rendu remplace le précédent", () => {
  const { doc } = createFakeEnvironment();
  const body = new FakeElement("div");
  renderStructureLink(body, { zones: [{ zoneKey: "zone1", label: "Zone 1", floors: [], formworks: [] }] }, { doc });
  renderStructureLink(body, { zones: [] }, { doc });
  assert.equal(body.children.length, 0);
});

test("ouverture : titre, lecture, étages du tableau de tâches en face des coffrages, invite à glisser", async () => {
  const env = setup();
  const opening = env.controller.open();
  assert.equal(env.dialog.open, true);
  assert.equal(env.title.textContent, "Lien Structure — HOTEL DIEU");
  assert.deepEqual([env.status.textContent, env.status.hidden], ["Chargement…", false]);
  await opening;
  assert.equal(env.calls.length, 1);
  assert.deepEqual([env.status.textContent, env.status.hidden], [HINT, false]);
  assert.deepEqual(textsOf(env.body, "structure-link-floor-name"), ["SS1", "SS2", "RDC"]);
  assert.deepEqual(textsOf(env.body, "structure-link-formwork-label"), ["3001 — PH SS1", "3002 — PH SS2", "3010 — RDC"]);
  assert.deepEqual(textsOf(env.body, "structure-link-issue"), ["ind. 0 : Jeu 27/11/25", "pas d'indice 0", "pas d'indice 0"]);
});

test("aucun projet choisi : un message, aucune lecture", async () => {
  const env = setup({ projectName: "" });
  await env.controller.open();
  assert.equal(env.calls.length, 0);
  assert.equal(env.title.textContent, "Lien Structure");
  assert.deepEqual([env.status.textContent, env.status.hidden], ["Choisissez d'abord un projet.", false]);
});

test("projet sans zone : un message à la place des colonnes", async () => {
  const env = setup({ rows: [], loadRows: async () => ({ projectRows: [], planRows: [] }) });
  await env.controller.open();
  assert.deepEqual([env.status.textContent, env.status.hidden], ["Aucune zone pour ce projet.", false]);
  assert.equal(env.body.children.length, 0);
});

test("lecture impossible : un message, la fenêtre reste ouverte et vide", async () => {
  const env = setup({ loadRows: async () => { throw new Error("réseau"); } });
  const errors = await silenceConsoleError(() => env.controller.open());
  assert.equal(errors.length, 1);
  assert.equal(env.dialog.open, true);
  assert.equal(
    env.status.textContent,
    "Les étages et les coffrages n'ont pas pu être lus. Fermez la fenêtre puis rouvrez-la."
  );
  assert.ok(env.status.classes.has("is-error"));
  assert.equal(env.body.children.length, 0);
});

test("tableau de tâches pas encore chargé : un message, rien n'est dessiné", async () => {
  const env = setup({ source: { ready: false } });
  await env.controller.open();
  assert.equal(env.status.textContent, "Les étages ne sont pas encore chargés : fermez la fenêtre puis rouvrez-la.");
  assert.equal(env.body.children.length, 0);
});

test("lecture seule : le message du tableau, rien ne se déplace", async () => {
  const lockedMessage = "Activez « Editer » dans le bandeau pour modifier les tâches.";
  const env = setup({ rows: syntheseRows({ ss1Link: "3001" }), source: { editable: false, lockedMessage } });
  await env.controller.open();
  assert.equal(env.status.textContent, lockedMessage);
  assert.ok(!env.status.classes.has("is-error"));
  assert.equal(all(env.body, "structure-link-action").length, 0);
  const item = formworkElement(env, "3001");
  dispatch(item, "dragstart", { dataTransfer: fakeTransfer() });
  assert.ok(!item.classes.has("is-dragging"));
  assert.equal(dispatch(floorElement(env, "zone1", "ss1"), "dragover").defaultPrevented, false);
  assert.equal(env.requests.length, 0);
});

test("colonne Lien_Structure absente : le dire, et rester en lecture seule", async () => {
  const env = setup({ source: { linkColumn: false } });
  await env.controller.open();
  assert.equal(env.status.textContent, NO_LINK_COLUMN);
  assert.ok(env.status.classes.has("is-error"));
  assert.equal(Boolean(formworkElement(env, "3001").draggable), false);
});

test("fermée avant la fin de la lecture : la réponse tardive n'est pas affichée", async () => {
  let release;
  const env = setup({ loadRows: () => new Promise((resolve) => { release = resolve; }) });
  const opening = env.controller.open();
  dispatch(env.closeButton, "click");
  assert.equal(env.dialog.open, false);
  release({ projectRows: PROJECT_ROWS, planRows: PLAN_ROWS });
  await opening;
  await flush();
  assert.equal(env.body.children.length, 0);
});

test("rouverte pendant une lecture : seule la dernière lecture est affichée", async () => {
  const pending = [];
  const env = setup({ loadRows: () => new Promise((resolve) => pending.push(resolve)) });
  const first = env.controller.open();
  const second = env.controller.open();
  pending[1]({ projectRows: [], planRows: [] });
  await second;
  pending[0]({ projectRows: PROJECT_ROWS, planRows: PLAN_ROWS });
  await first;
  assert.deepEqual(textsOf(env.body, "structure-link-formwork-label"), [], "les coffrages de la première lecture ne sont pas affichés");
});

test("glisser un coffrage sur un étage de sa zone : lien et date d'indice 0 envoyés au tableau", async () => {
  const env = setup({
    applyLink: (request, source) => {
      // Le tableau affiche tout de suite l'écriture en attente.
      source.rows = syntheseRows({ ss1Link: request.formworkNumber, planStart: "2025-11-27" });
      return Promise.resolve({ ok: true });
    },
  });
  await env.controller.open();
  const { dataTransfer, over, drop } = dragOnto(env, "3001", floorElement(env, "zone1", "ss1"));
  assert.equal(dataTransfer.data["text/plain"], "3001");
  assert.equal(over.defaultPrevented, true, "dépôt accepté");
  assert.equal(drop.defaultPrevented, true);
  assert.equal(env.requests.length, 1);
  const [request] = env.requests;
  assert.deepEqual(
    [request.zoneKey, request.floorKey, request.formworkNumber, iso(request.date)],
    ["zone1", "ss1", "3001", "2025-11-27"]
  );
  assert.equal(env.status.textContent, "Enregistrement…");
  assert.deepEqual(textsOf(floorElement(env, "zone1", "ss1"), "structure-link-link"), ["3001 — PH SS1 · à jour"], "affiché avant la réponse");
  await flush();
  assert.equal(env.status.textContent, "SS1 lié au coffrage 3001 : le fond de plan débute le Jeu 27/11/25.");
  assert.ok(!env.status.classes.has("is-error"));
  assert.deepEqual(textsOf(formworkElement(env, "3001"), "structure-link-used"), ["lié : SS1"]);
});

test("coffrage sans indice 0 : le lien seul, la date viendra", async () => {
  const env = setup();
  await env.controller.open();
  dragOnto(env, "3002", floorElement(env, "zone1", "ss1"));
  const [request] = env.requests;
  assert.deepEqual([request.formworkNumber, "date" in request], ["3002", false]);
  await flush();
  assert.equal(env.status.textContent, "SS1 lié au coffrage 3002. La date sera à reprendre quand l'indice 0 sera diffusé.");
});

test("étage sans fond de plan : le lien seul, aucune date posée", async () => {
  const env = setup();
  await env.controller.open();
  dragOnto(env, "3001", floorElement(env, "zone1", "ss2"));
  const [request] = env.requests;
  assert.deepEqual([request.floorKey, request.formworkNumber, "date" in request], ["ss2", "3001", false]);
  await flush();
  assert.equal(
    env.status.textContent,
    "SS2 lié au coffrage 3001. Aucune date posée : l'étage n'a pas de tâche « FOND DE PLAN DE SYNTHESE »."
  );
});

test("glisser : seuls les étages de la zone du coffrage acceptent le dépôt", async () => {
  const env = setup();
  await env.controller.open();
  const source = formworkElement(env, "3010"); // Zone 2
  const dataTransfer = fakeTransfer();
  const ss1 = floorElement(env, "zone1", "ss1");
  const rdc = floorElement(env, "zone2", "rdc");
  dispatch(source, "dragstart", { dataTransfer });
  assert.ok(source.classes.has("is-dragging"));
  assert.deepEqual(all(env.body, "structure-link-floor").map((element) => element.classes.has("is-droppable")), [false, false, true]);
  assert.equal(dispatch(ss1, "dragover", { dataTransfer }).defaultPrevented, false, "autre zone : refusé");
  assert.equal(dispatch(rdc, "dragover", { dataTransfer }).defaultPrevented, true);
  assert.ok(rdc.classes.has("is-drop-target"));
  dispatch(ss1, "dragover", { dataTransfer });
  assert.ok(!rdc.classes.has("is-drop-target"), "le survol a quitté l'étage");
  dispatch(ss1, "drop", { dataTransfer });
  assert.equal(env.requests.length, 0);
  assert.ok(!source.classes.has("is-dragging"));
  assert.ok(!rdc.classes.has("is-droppable"));
});

test("glisser abandonné : les repères disparaissent", async () => {
  const env = setup();
  await env.controller.open();
  const source = formworkElement(env, "3001");
  dispatch(source, "dragstart", { dataTransfer: fakeTransfer() });
  dispatch(source, "dragend");
  assert.ok(!source.classes.has("is-dragging"));
  assert.ok(all(env.body, "structure-link-floor").every((element) => !element.classes.has("is-droppable")));
  assert.equal(env.requests.length, 0);
});

test("« Mettre à jour » : la date d'indice 0 est renvoyée au tableau, sans toucher au lien", async () => {
  const env = setup({
    rows: syntheseRows({ ss1Link: "3001", planStart: "2026-01-02" }),
    applyLink: (request, source) => {
      source.rows = syntheseRows({ ss1Link: "3001", planStart: "2025-11-27" });
      return Promise.resolve({ ok: true });
    },
  });
  await env.controller.open();
  const floor = floorElement(env, "zone1", "ss1");
  assert.deepEqual(textsOf(floor, "structure-link-link"), ["3001 — PH SS1 · à mettre à jour : ind. 0 le Jeu 27/11/25"]);
  dispatch(actionOf(floor, "refresh"), "click");
  const [request] = env.requests;
  assert.deepEqual(
    [request.zoneKey, request.floorKey, iso(request.date), "formworkNumber" in request],
    ["zone1", "ss1", "2025-11-27", false]
  );
  await flush();
  assert.equal(env.status.textContent, "SS1 : le fond de plan débute le Jeu 27/11/25.");
  assert.equal(actionOf(floorElement(env, "zone1", "ss1"), "refresh"), undefined, "à jour : plus de bouton");
});

test("« × » : l'étage est délié", async () => {
  const env = setup({
    rows: syntheseRows({ ss1Link: "3001", planStart: "2025-11-27" }),
    applyLink: (request, source) => {
      source.rows = syntheseRows({ planStart: "2025-11-27" });
      return Promise.resolve({ ok: true });
    },
  });
  await env.controller.open();
  dispatch(actionOf(floorElement(env, "zone1", "ss1"), "unlink"), "click");
  assert.deepEqual(env.requests, [{ zoneKey: "zone1", floorKey: "ss1", formworkNumber: "" }]);
  await flush();
  assert.equal(env.status.textContent, "SS1 n'est plus lié à un coffrage.");
  assert.deepEqual(textsOf(floorElement(env, "zone1", "ss1"), "structure-link-link"), ["Déposez un coffrage ici"]);
});

// Review Focus 4.
test("écriture refusée : le message du tableau en erreur, l'affichage d'avant", async () => {
  const env = setup({
    applyLink: () => Promise.resolve({ ok: false, error: "L'enregistrement dans Grist a échoué. Réessayez." }),
  });
  await env.controller.open();
  dragOnto(env, "3001", floorElement(env, "zone1", "ss1"));
  await flush();
  assert.equal(env.status.textContent, "L'enregistrement dans Grist a échoué. Réessayez.");
  assert.ok(env.status.classes.has("is-error"));
  assert.deepEqual(textsOf(floorElement(env, "zone1", "ss1"), "structure-link-link"), ["Déposez un coffrage ici"]);
});

test("écriture qui lève une erreur : même message, sans planter", async () => {
  const env = setup({ applyLink: () => Promise.reject(new Error("imprévu")) });
  await env.controller.open();
  const errors = await silenceConsoleError(async () => {
    dragOnto(env, "3001", floorElement(env, "zone1", "ss1"));
    await flush();
  });
  assert.equal(errors.length, 1);
  assert.equal(env.status.textContent, "L'enregistrement dans Grist a échoué. Réessayez.");
  assert.ok(env.status.classes.has("is-error"));
});

// Review Focus 5.
test("fenêtre fermée pendant une écriture : la réponse tardive n'affiche rien", async () => {
  let release;
  const env = setup({ applyLink: () => new Promise((resolve) => { release = resolve; }) });
  await env.controller.open();
  dragOnto(env, "3001", floorElement(env, "zone1", "ss1"));
  dispatch(env.closeButton, "click");
  assert.equal(env.dialog.open, false);
  release({ ok: true });
  await flush();
  assert.equal(env.status.textContent, "Enregistrement…", "pas de message de réussite dans une fenêtre fermée");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run : `node --test tests/structureLinkDialog.test.mjs`
Expected: FAIL — la fenêtre de l'étape 1 ne connaît ni les états, ni `getSource`, ni le glisser-déposer (la plupart des 23 tests échouent).

- [ ] **Step 3: Write minimal implementation**

Remplacer tout `Planning Projet/assets/js/ui/structureLinkDialog.js` par :

```js
// Fenêtre « Lien Structure » de la vue Synthese : zone par zone, les étages de Synthese à
// gauche et les coffrages de Structure à droite. On glisse un coffrage sur un étage de sa
// zone : l'étage retient son N° et prend sa date de diffusion à l'indice 0. Les étages viennent
// du tableau de tâches (lignes telles qu'affichées) ; les coffrages et la liste de plans sont
// lus à chaque ouverture ; toute écriture passe par le tableau de tâches. Ses dépendances sont
// injectées (éléments, lectures, écriture, nom du projet) : doublures en test.
import { LINK_STATES, buildStructureLink } from "../services/structureLinkModel.js";
import { formatDate } from "../services/syntheseTaskModel.js";

const TITLE = "Lien Structure";
const MESSAGES = Object.freeze({
  noProject: "Choisissez d'abord un projet.",
  loading: "Chargement…",
  noZone: "Aucune zone pour ce projet.",
  readFailed: "Les étages et les coffrages n'ont pas pu être lus. Fermez la fenêtre puis rouvrez-la.",
  notReady: "Les étages ne sont pas encore chargés : fermez la fenêtre puis rouvrez-la.",
  noLinkColumn: "La colonne « Lien_Structure » (Texte) manque dans Planning_Projet : ajoutez-la pour lier les étages aux coffrages.",
  hint: "Faites glisser un coffrage sur un étage de la même zone.",
  saving: "Enregistrement…",
  writeFailed: "L'enregistrement dans Grist a échoué. Réessayez.",
  noFloor: "Aucun étage",
  noFormwork: "Aucun coffrage",
  dropHere: "Déposez un coffrage ici",
  noLink: "Aucun coffrage lié",
  noIssue: "pas d'indice 0",
  refresh: "Mettre à jour",
});

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function createElement(doc, tag, className, text) {
  const element = doc.createElement(tag);
  element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

// L'élément portant la classe, à partir de la cible d'un évènement (un nœud de texte n'a pas
// de closest : on part de son parent).
function closestOf(target, className) {
  const element = typeof target?.closest === "function" ? target : target?.parentElement;
  return element?.closest?.(`.${className}`) || null;
}

// Texte du lien d'un étage, selon son état.
function linkText(floor, editable) {
  const label = floor.formwork?.label || "";
  switch (floor.state) {
    case LINK_STATES.missing:
      return `Coffrage ${floor.formworkNumber} introuvable`;
    case LINK_STATES.noPlan:
      return `${label} · pas de tâche « FOND DE PLAN DE SYNTHESE » dans cet étage`;
    case LINK_STATES.waiting:
      return `${label} · en attente de l'indice 0`;
    case LINK_STATES.current:
      return `${label} · à jour`;
    case LINK_STATES.stale:
      return `${label} · à mettre à jour : ind. 0 le ${formatDate(floor.formwork?.issueDate)}`;
    default:
      return editable ? MESSAGES.dropHere : MESSAGES.noLink;
  }
}

// Un étage : son nom, le début de son fond de plan, son lien et, si l'on peut écrire, ses
// boutons (« Mettre à jour » quand la date diffère, « × » pour délier).
function buildFloor(doc, zone, floor, editable) {
  const item = createElement(doc, "li", `structure-link-item structure-link-floor is-state-${floor.state}`);
  item.dataset.zoneKey = zone.zoneKey;
  item.dataset.floorKey = floor.key;
  item.appendChild(createElement(doc, "span", "structure-link-floor-name", floor.name));
  if (floor.plan) {
    item.appendChild(createElement(doc, "span", "structure-link-plan", `Fond de plan : début ${formatDate(floor.plan.start)}`));
  }
  const row = createElement(doc, "div", "structure-link-linkrow");
  row.appendChild(createElement(doc, "span", "structure-link-link", linkText(floor, editable)));
  if (editable && floor.state === LINK_STATES.stale) {
    const refresh = createElement(doc, "button", "structure-link-action", MESSAGES.refresh);
    refresh.type = "button";
    refresh.dataset.action = "refresh";
    row.appendChild(refresh);
  }
  if (editable && floor.state !== LINK_STATES.none) {
    const unlink = createElement(doc, "button", "structure-link-action structure-link-unlink", "×");
    unlink.type = "button";
    unlink.dataset.action = "unlink";
    unlink.title = `Délier ${floor.name}`;
    unlink.setAttribute("aria-label", `Délier ${floor.name}`);
    row.appendChild(unlink);
  }
  item.appendChild(row);
  return item;
}

// Un coffrage : « N° — nom », sa date d'indice 0, les étages qu'il sert. Il se déplace si l'on
// peut écrire et s'il a un N°.
function buildFormwork(doc, zone, formwork, editable) {
  const item = createElement(doc, "li", "structure-link-item structure-link-formwork");
  item.dataset.zoneKey = zone.zoneKey;
  item.dataset.number = formwork.number;
  item.appendChild(createElement(doc, "span", "structure-link-formwork-label", formwork.label));
  item.appendChild(createElement(
    doc,
    "span",
    "structure-link-issue",
    formwork.issueDate ? `ind. 0 : ${formatDate(formwork.issueDate)}` : MESSAGES.noIssue
  ));
  const floorNames = formwork.floorNames || [];
  if (floorNames.length) {
    item.appendChild(createElement(doc, "span", "structure-link-used", `lié : ${floorNames.join(", ")}`));
  }
  if (editable && formwork.number) {
    item.draggable = true;
    item.classList.add("is-draggable");
  }
  return item;
}

// Un côté d'une zone : le nom de la zone, puis ses éléments (ou la mention qu'il n'y en a pas).
function buildSide(doc, { modifier, zoneLabel, listLabel, items, emptyText }) {
  const side = createElement(doc, "div", `structure-link-side structure-link-side--${modifier}`);
  side.appendChild(createElement(doc, "div", "structure-link-zone-name", zoneLabel));
  const list = createElement(doc, "ul", "structure-link-list");
  list.setAttribute("aria-label", `${listLabel} — ${zoneLabel}`);
  if (items.length) {
    items.forEach((item) => list.appendChild(item));
  } else {
    list.appendChild(createElement(doc, "li", "structure-link-empty", emptyText));
  }
  side.appendChild(list);
  return side;
}

// Dessine le modèle dans le corps de la fenêtre : une rangée par zone, les deux côtés en face.
// Renvoie les éléments des étages et des coffrages (repères du glisser-déposer).
export function renderStructureLink(body, model, { editable = false, doc = document } = {}) {
  const floors = [];
  const formworks = [];
  const zones = (model?.zones || []).map((zone) => {
    const floorItems = (zone.floors || []).map((floor) => buildFloor(doc, zone, floor, editable));
    const formworkItems = (zone.formworks || []).map((formwork) => buildFormwork(doc, zone, formwork, editable));
    floors.push(...floorItems);
    formworks.push(...formworkItems);
    const row = createElement(doc, "div", "structure-link-zone");
    row.appendChild(buildSide(doc, {
      modifier: "synthese",
      zoneLabel: zone.label,
      listLabel: "Étages de Synthèse",
      items: floorItems,
      emptyText: MESSAGES.noFloor,
    }));
    row.appendChild(buildSide(doc, {
      modifier: "structure",
      zoneLabel: zone.label,
      listLabel: "Coffrages de Structure",
      items: formworkItems,
      emptyText: MESSAGES.noFormwork,
    }));
    return row;
  });
  body.replaceChildren(...zones);
  return { floors, formworks };
}

export function createStructureLinkDialog({ dialog, title, status, body, closeButton }, {
  loadRows,
  getSource = () => null,
  applyLink = async () => ({ ok: false, error: MESSAGES.writeFailed }),
  getProjectName = () => "",
  doc = document,
} = {}) {
  // Jeton de lecture : une réponse arrivée après une fermeture ou une réouverture est ignorée.
  let loadToken = 0;
  // Coffrages et liste de plans lus à l'ouverture ; null tant que la lecture n'est pas finie.
  let data = null;
  let model = { zones: [] };
  let editable = false;
  let elements = { floors: [], formworks: [] };
  // Coffrage en cours de glisser (sa zone, son N°) et étage survolé.
  let drag = null;
  let hover = null;

  function setStatus(text, tone = "info") {
    status.textContent = text;
    status.hidden = !text;
    if (tone === "error") status.classList.add("is-error");
    else status.classList.remove("is-error");
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  function endDrag() {
    drag = null;
    hover = null;
    elements.formworks.forEach((element) => element.classList.remove("is-dragging"));
    elements.floors.forEach((element) => element.classList.remove("is-droppable", "is-drop-target"));
  }

  // Redessine à partir du tableau de tâches (lignes affichées) et de la lecture de l'ouverture.
  // Renvoie la source utilisée, ou null si rien n'a pu être dessiné.
  function redraw() {
    const source = getSource();
    if (!data || !source?.ready) return null;
    endDrag();
    model = buildStructureLink({ syntheseRows: source.rows, projectRows: data.projectRows, planRows: data.planRows });
    editable = Boolean(source.editable) && source.linkColumn !== false;
    elements = renderStructureLink(body, model, { editable, doc });
    return source;
  }

  function findZone(zoneKey) {
    return model.zones.find((zone) => zone.zoneKey === zoneKey) || null;
  }

  function findFloor(zoneKey, floorKey) {
    return findZone(zoneKey)?.floors.find((floor) => floor.key === floorKey) || null;
  }

  function findFormwork(zoneKey, number) {
    return findZone(zoneKey)?.formworks.find((formwork) => formwork.number === number) || null;
  }

  // Une action : envoyée au tableau de tâches, affichée tout de suite, puis confirmée — ou
  // défaite — à la réponse de Grist.
  async function act(request, successText) {
    const token = loadToken;
    setStatus(MESSAGES.saving);
    let result;
    try {
      const pending = applyLink(request);
      redraw();
      result = await pending;
    } catch (error) {
      console.error("Lien Structure impossible :", error);
      result = { ok: false, error: MESSAGES.writeFailed };
    }
    if (!dialog.open) return;
    redraw();
    // Fenêtre rouverte entre-temps : l'affichage est à jour, le message d'une action passée
    // n'a plus sa place.
    if (token !== loadToken) return;
    if (result?.ok) setStatus(successText());
    else setStatus(toText(result?.error) || MESSAGES.writeFailed, "error");
  }

  // Dépôt : le lien, et la date d'indice 0 si le coffrage en a une et l'étage un fond de plan.
  function link(zoneKey, floorKey, number) {
    const floor = findFloor(zoneKey, floorKey);
    const formwork = findFormwork(zoneKey, number);
    if (!floor || !formwork) return Promise.resolve();
    const date = floor.plan && formwork.issueDate ? formwork.issueDate : null;
    const request = { zoneKey, floorKey, formworkNumber: formwork.number };
    if (date) request.date = date;
    return act(request, () => {
      const linked = `${floor.name} lié au coffrage ${formwork.number}`;
      if (date) return `${linked} : le fond de plan débute le ${formatDate(findFloor(zoneKey, floorKey)?.plan?.start)}.`;
      if (!floor.plan) return `${linked}. Aucune date posée : l'étage n'a pas de tâche « FOND DE PLAN DE SYNTHESE ».`;
      return `${linked}. La date sera à reprendre quand l'indice 0 sera diffusé.`;
    });
  }

  function refresh(zoneKey, floorKey) {
    const floor = findFloor(zoneKey, floorKey);
    const date = floor?.formwork?.issueDate;
    if (!floor?.plan || !date) return Promise.resolve();
    return act({ zoneKey, floorKey, date }, () => (
      `${floor.name} : le fond de plan débute le ${formatDate(findFloor(zoneKey, floorKey)?.plan?.start)}.`
    ));
  }

  function unlink(zoneKey, floorKey) {
    const floor = findFloor(zoneKey, floorKey);
    if (!floor) return Promise.resolve();
    return act({ zoneKey, floorKey, formworkNumber: "" }, () => `${floor.name} n'est plus lié à un coffrage.`);
  }

  async function open() {
    loadToken += 1;
    const token = loadToken;
    const projectName = toText(getProjectName());
    title.textContent = projectName ? `${TITLE} — ${projectName}` : TITLE;
    data = null;
    model = { zones: [] };
    editable = false;
    elements = { floors: [], formworks: [] };
    drag = null;
    hover = null;
    body.replaceChildren();
    if (!dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    if (!projectName) {
      setStatus(MESSAGES.noProject);
      return;
    }
    setStatus(MESSAGES.loading);
    let loaded;
    try {
      loaded = await loadRows();
    } catch (error) {
      if (token !== loadToken) return;
      console.error("Lecture des étages et des coffrages impossible :", error);
      setStatus(MESSAGES.readFailed, "error");
      return;
    }
    if (token !== loadToken) return;
    data = {
      projectRows: Array.isArray(loaded?.projectRows) ? loaded.projectRows : [],
      planRows: Array.isArray(loaded?.planRows) ? loaded.planRows : [],
    };
    const source = redraw();
    if (!source) {
      data = null;
      setStatus(MESSAGES.notReady, "error");
      return;
    }
    if (!model.zones.length) {
      setStatus(MESSAGES.noZone);
      return;
    }
    if (source.linkColumn === false) setStatus(MESSAGES.noLinkColumn, "error");
    else if (!source.editable) setStatus(toText(source.lockedMessage));
    else setStatus(MESSAGES.hint);
  }

  // L'étage survolé, s'il accepte le coffrage glissé (même zone).
  function dropFloorOf(event) {
    if (!drag) return null;
    const floor = closestOf(event.target, "structure-link-floor");
    return floor && floor.dataset.zoneKey === drag.zoneKey ? floor : null;
  }

  function setHover(floor) {
    if (floor === hover) return;
    hover?.classList.remove("is-drop-target");
    hover = floor;
    hover?.classList.add("is-drop-target");
  }

  body.addEventListener("dragstart", (event) => {
    const item = closestOf(event.target, "structure-link-formwork");
    if (!editable || !item?.draggable) return;
    drag = { zoneKey: item.dataset.zoneKey, number: item.dataset.number };
    // Sans donnée, certains navigateurs ne lancent pas le glisser.
    event.dataTransfer?.setData?.("text/plain", drag.number);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "link";
    item.classList.add("is-dragging");
    elements.floors
      .filter((floor) => floor.dataset.zoneKey === drag.zoneKey)
      .forEach((floor) => floor.classList.add("is-droppable"));
  });

  // Accepter le survol (preventDefault) autorise le dépôt : seulement sur un étage de la zone.
  body.addEventListener("dragover", (event) => {
    const floor = dropFloorOf(event);
    setHover(floor);
    if (!floor) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "link";
  });

  body.addEventListener("drop", (event) => {
    const floor = dropFloorOf(event);
    const dragged = drag;
    endDrag();
    if (!floor || !dragged) return;
    event.preventDefault();
    void link(floor.dataset.zoneKey, floor.dataset.floorKey, dragged.number);
  });

  body.addEventListener("dragend", () => endDrag());

  body.addEventListener("click", (event) => {
    const button = closestOf(event.target, "structure-link-action");
    const floor = button ? closestOf(button, "structure-link-floor") : null;
    if (!editable || !floor) return;
    const { zoneKey, floorKey } = floor.dataset;
    if (button.dataset.action === "refresh") void refresh(zoneKey, floorKey);
    else if (button.dataset.action === "unlink") void unlink(zoneKey, floorKey);
  });

  closeButton?.addEventListener("click", close);
  // Fermeture par le bouton ou par Échap : la lecture en cours n'a plus où s'afficher.
  dialog.addEventListener("close", () => {
    loadToken += 1;
    data = null;
    endDrag();
  });

  return { open, close };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run : `node --test tests/structureLinkDialog.test.mjs`
Expected: PASS (23 tests).

- [ ] **Step 5: Point de contrôle**

Run : `node --test tests/*.test.mjs`
Expected: 393 tests, 0 échec. Pas de commit.

---

### Task 5: Branchement, styles et versions (`main.js`, `index.html`, `styles.css`)

**Files:**
- Modify: `Planning Projet/assets/js/main.js` (fonction `bindStructureLinkDialog`)
- Modify: `Planning Projet/index.html` (versions `?v=`, titre du bouton, commentaire de la fenêtre)
- Modify: `Planning Projet/assets/css/styles.css` (après le bloc `.structure-link-empty`)
- Test: `Planning Projet/tests/structureLinkWiring.test.mjs`, `tests/syntheseGanttWiring.test.mjs`, `tests/syntheseTasksWiring.test.mjs`

**Interfaces:**
- Consumes: `createStructureLinkDialog(elements, { loadRows, getSource, applyLink, getProjectName })` (tâche 4) ; `syntheseTasks.getStructureLinkSource()`, `syntheseTasks.applyStructureLink(request)` (tâche 3) ; `window.GristServiceContext.fetchProjectRows(tableName)` (existant) ; la variable de module `syntheseTasks` de `main.js` (null tant que la vue Synthese n'a jamais été ouverte).
- Produces: rien pour d'autres tâches.

- [ ] **Step 1: Write the failing test**

Dans `Planning Projet/tests/structureLinkWiring.test.mjs` :

1. Remplacer le test « main.js ouvre la fenêtre au clic et lit les lignes du projet de tous les services » par :

```js
test("main.js : la fenêtre lit les deux tables du projet et passe par le tableau de tâches pour écrire", () => {
  assert.match(mainJs, /import \{ createStructureLinkDialog \} from "\.\/ui\/structureLinkDialog\.js";/);
  const bind = sliceBetween(mainJs, "function bindStructureLinkDialog(", "\n}\n");
  assert.match(bind, /if \(EMBEDDED_PLANNING_SYNC_MODE\) return;/);
  assert.match(bind, /fetchProjectRows\("Planning_Projet"\)/);
  assert.match(bind, /fetchProjectRows\("ListePlan_NDC_COF"\)/);
  assert.match(bind, /return \{ projectRows, planRows \};/);
  assert.match(bind, /getSource: \(\) => syntheseTasks\?\.getStructureLinkSource\(\) \|\| null/);
  assert.match(bind, /syntheseTasks\.applyStructureLink\(request\)/);
  assert.match(bind, /getElementById\("structureLinkToggle"\)\s*\?\.addEventListener\("click", \(\) => \{\s*void structureLinkDialog\.open\(\);/);
  assert.match(mainJs, /bindSyntheseSpace\(\);\s*bindStructureLinkDialog\(\);/);
});

test("styles du lien : cibles de dépôt, états, coffrage déplaçable, boutons, message d'erreur", () => {
  assert.match(css, /\.structure-link-item\s*\{[^}]*display:\s*flex;/);
  assert.match(css, /\.structure-link-floor\.is-droppable\s*\{[^}]*border-color:/);
  assert.match(css, /\.structure-link-floor\.is-drop-target\s*\{[^}]*background:/);
  assert.match(css, /\.structure-link-linkrow\s*\{[^}]*flex-basis:\s*100%;/);
  assert.match(css, /\.structure-link-floor\.is-state-stale \.structure-link-link\s*\{/);
  assert.match(css, /\.structure-link-formwork\.is-draggable\s*\{[^}]*cursor:\s*grab;/);
  assert.match(css, /\.structure-link-formwork\.is-dragging\s*\{[^}]*opacity:/);
  assert.match(css, /\.structure-link-action\s*\{[^}]*cursor:\s*pointer;/);
  assert.match(css, /\.structure-link-dialog__status\.is-error\s*\{[^}]*color:/);
});
```

2. Dans le test « les scripts sont servis dans leur nouvelle version », remplacer les trois `20261007-lien1` par `20261007-lien2`.

3. Dans `tests/syntheseGanttWiring.test.mjs` (deux lignes) et `tests/syntheseTasksWiring.test.mjs` (une ligne), remplacer `20261007-lien1` par `20261007-lien2`.

- [ ] **Step 2: Run test to verify it fails**

Run : `node --test tests/structureLinkWiring.test.mjs tests/syntheseGanttWiring.test.mjs tests/syntheseTasksWiring.test.mjs`
Expected: FAIL — `ListePlan_NDC_COF` absent de `bindStructureLinkDialog`, styles absents, versions `lien1`.

- [ ] **Step 3: Write minimal implementation**

1. `Planning Projet/assets/js/main.js` — remplacer le commentaire et la fonction `bindStructureLinkDialog` par :

```js
// Bouton « Lien Structure » de la vue Synthese : une fenêtre montre, zone par zone, les étages
// de Synthese en face des coffrages de Structure ; on y glisse un coffrage sur un étage pour
// les lier et reprendre sa date de diffusion à l'indice 0. Les coffrages et la liste de plans
// sont lus pour le projet, tous services confondus ; les étages et toute écriture passent par
// le tableau de tâches.
function bindStructureLinkDialog() {
  if (EMBEDDED_PLANNING_SYNC_MODE) return;
  const serviceContext = window.GristServiceContext;
  const dialog = document.getElementById("structureLinkDialog");
  if (!dialog || typeof serviceContext?.fetchProjectRows !== "function") return;
  const structureLinkDialog = createStructureLinkDialog({
    dialog,
    title: document.getElementById("structureLinkTitle"),
    status: document.getElementById("structureLinkStatus"),
    body: document.getElementById("structureLinkBody"),
    closeButton: document.getElementById("structureLinkCloseBtn"),
  }, {
    loadRows: async () => {
      const [projectRows, planRows] = await Promise.all([
        serviceContext.fetchProjectRows("Planning_Projet"),
        serviceContext.fetchProjectRows("ListePlan_NDC_COF"),
      ]);
      return { projectRows, planRows };
    },
    getSource: () => syntheseTasks?.getStructureLinkSource() || null,
    applyLink: (request) => (syntheseTasks
      ? syntheseTasks.applyStructureLink(request)
      : Promise.resolve({ ok: false, error: "Les étages ne sont pas encore chargés : fermez la fenêtre puis rouvrez-la." })),
    getProjectName: () => serviceContext.getCurrentProject?.()?.name || "",
  });
  document.getElementById("structureLinkToggle")
    ?.addEventListener("click", () => {
      void structureLinkDialog.open();
    });
}
```

2. `Planning Projet/index.html` :
   - remplacer les cinq `?v=20261007-lien1` par `?v=20261007-lien2` ;
   - bouton `#structureLinkToggle` : remplacer son attribut `title` par `title="Lier, zone par zone, les étages de Synthèse aux coffrages de Structure"` ;
   - commentaire au-dessus de `<dialog id="structureLinkDialog"` : le remplacer par

```html
  <!-- Lien Structure (vue Synthese) : étages de Synthese en face des coffrages de Structure ;
       on glisse un coffrage sur un étage pour les lier. Construit par
       assets/js/ui/structureLinkDialog.js -->
```

3. `Planning Projet/assets/css/styles.css` — juste après le bloc `.structure-link-empty { … }` :

```css
/* Lien Structure : un étage est une cible de dépôt ; son lien change de couleur selon son
   état ; un coffrage se déplace quand on peut écrire. */
.structure-link-item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
}

.structure-link-floor {
  margin: 2px 0;
  padding: 3px 6px;
  border: 1px dashed transparent;
  border-radius: 4px;
}

.structure-link-floor.is-droppable {
  border-color: #7fa7cf;
  background: #f1f7ff;
}

.structure-link-floor.is-drop-target {
  border-style: solid;
  border-color: #004990;
  background: #dbeafe;
}

.structure-link-floor-name,
.structure-link-formwork-label {
  font-weight: 600;
}

.structure-link-plan,
.structure-link-issue,
.structure-link-used,
.structure-link-link {
  color: #475569;
  font-size: 12px;
}

.structure-link-linkrow {
  flex-basis: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  padding-left: 20px;
}

.structure-link-floor.is-state-current .structure-link-link {
  color: #166534;
}

.structure-link-floor.is-state-stale .structure-link-link {
  color: #9a3412;
  font-weight: 600;
}

.structure-link-floor.is-state-missing .structure-link-link {
  color: #b91c1c;
}

.structure-link-formwork.is-draggable {
  cursor: grab;
}

.structure-link-formwork.is-dragging {
  opacity: 0.5;
}

.structure-link-action {
  border: 1px solid #b7c7d9;
  border-radius: 4px;
  padding: 1px 8px;
  background: #ffffff;
  color: #23415f;
  font-size: 12px;
  cursor: pointer;
}

.structure-link-action:hover {
  border-color: #7fa7cf;
  background: #f1f7ff;
}

.structure-link-unlink {
  border-color: transparent;
  padding: 1px 6px;
  font-size: 14px;
  line-height: 1;
}

.structure-link-dialog__status.is-error {
  color: #b91c1c;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run : `node --test tests/structureLinkWiring.test.mjs tests/syntheseGanttWiring.test.mjs tests/syntheseTasksWiring.test.mjs`
Expected: PASS.

- [ ] **Step 5: Point de contrôle final**

Run (depuis `Planning Projet/`) : `node --test tests/*.test.mjs`
Expected: 394 tests, 0 échec.

Run (depuis `shared/`) : `node --test tests/*.test.cjs`
Expected: 175 tests, 0 échec (rien n'y a changé).

Pas de commit. Test manuel par l'utilisateur sur localhost (Ctrl+F5), après avoir créé la colonne Texte `Lien_Structure` dans `Planning_Projet` : vue Synthese, « Editer » actif, « Lien Structure », glisser un coffrage diffusé à l'indice 0 sur un étage du modèle de la même zone.
