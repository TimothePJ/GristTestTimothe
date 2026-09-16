// Etat du pane bas : ce qu'on affiche, et sur quelle periode.
//
// Ces deux decisions ne dependaient jusqu'ici que de l'existence d'une ligne
// TimeSegment (le `if (bounds) / else` de main.js::loadProject), ce qui rendait
// le pane bas ENTIEREMENT VIDE sur un projet dont personne n'avait encore pose
// le moindre segment : les membres de ProjectTeam etaient jetes (`workers: []`),
// donc aucune piste a cliquer, donc impossible de creer le premier segment
// depuis planning-synchro. Il fallait aller le poser dans gestion-depenses2 pour
// que planning-synchro daigne afficher l'equipe.
//
// Les regles ci-dessous remplacent cette branche : elles se prononcent sur ce
// qu'il y a REELLEMENT a montrer (des personnes ? des lignes de planning ?) et
// non sur la presence d'un segment.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  unionDateBounds,
  resolveChargeBounds,
  resolveChargePaneVisibility,
  resolveViewportAnchorDate,
} from "../assets/js/bottom/chargePaneState.js";

const SEGMENT_BOUNDS = { startDate: "2027-02-01", endDate: "2027-05-31" };
const PLAN_BOUNDS = { startDate: "2027-01-15", endDate: "2027-04-10" };
const TODAY = "2026-09-16";

// --- unionDateBounds ---------------------------------------------------------

test("unionDateBounds : une borne absente laisse l'autre telle quelle", () => {
  assert.deepEqual(unionDateBounds(null, PLAN_BOUNDS), PLAN_BOUNDS);
  assert.deepEqual(unionDateBounds(SEGMENT_BOUNDS, null), SEGMENT_BOUNDS);
});

test("unionDateBounds : sans aucune borne, rien a unir", () => {
  assert.equal(unionDateBounds(null, null), null);
});

test("unionDateBounds : garde le debut le plus tot et la fin la plus tard", () => {
  assert.deepEqual(unionDateBounds(SEGMENT_BOUNDS, PLAN_BOUNDS), {
    startDate: "2027-01-15",
    endDate: "2027-05-31",
  });
});

// --- resolveChargeBounds -----------------------------------------------------

test("resolveChargeBounds : segments seuls -> les bornes des segments", () => {
  assert.deepEqual(
    resolveChargeBounds({ segmentBounds: SEGMENT_BOUNDS, planBounds: null, todayIso: TODAY }),
    SEGMENT_BOUNDS
  );
});

// LE CAS DU BUG : aucun segment, mais un planning. La frise doit couvrir les
// phases — c'est la que l'utilisateur voudra poser son premier segment.
test("resolveChargeBounds : sans segment, la frise couvre les phases du planning", () => {
  assert.deepEqual(
    resolveChargeBounds({ segmentBounds: null, planBounds: PLAN_BOUNDS, todayIso: TODAY }),
    PLAN_BOUNDS
  );
});

test("resolveChargeBounds : segments ET planning -> l'union des deux", () => {
  assert.deepEqual(
    resolveChargeBounds({ segmentBounds: SEGMENT_BOUNDS, planBounds: PLAN_BOUNDS, todayIso: TODAY }),
    { startDate: "2027-01-15", endDate: "2027-05-31" }
  );
});

// Cas degenere : une equipe affectee, mais ni segment ni phase datable. Sans ce
// repli les bornes se refermaient sur ~31 jours figes — un seul mois atteignable,
// pan impossible, donc un premier segment impossible a poser ailleurs que la.
test("resolveChargeBounds : ni segment ni phase -> aujourd'hui plus ou moins un an", () => {
  assert.deepEqual(
    resolveChargeBounds({ segmentBounds: null, planBounds: null, todayIso: TODAY }),
    { startDate: "2025-09-16", endDate: "2027-09-16" }
  );
});

test("resolveChargeBounds : un todayIso illisible ne renvoie jamais de bornes cassees", () => {
  const bounds = resolveChargeBounds({ segmentBounds: null, planBounds: null, todayIso: "pas-une-date" });
  assert.ok(bounds, "des bornes exploitables sont attendues malgre l'entree invalide");
  assert.match(bounds.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(bounds.endDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(bounds.startDate < bounds.endDate);
});

// --- resolveChargePaneVisibility ---------------------------------------------

// LE CAS DU BUG, cote affichage : des personnes existent, aucun segment n'a
// encore ete pose. On montre les pistes vides — et surtout PAS le message
// « Aucun previsionnel », qui laissait croire qu'il n'y avait rien a faire ici.
test("visibilite : des personnes sans segment -> le board s'affiche, sans message", () => {
  assert.deepEqual(resolveChargePaneVisibility({ workerCount: 3, planningRowCount: 0 }), {
    showBoard: true,
    showEmptyMessage: false,
  });
});

// Sans personne mais avec un planning, le board reste rendu : c'est lui qui porte
// la ligne Charge, dont le bouton est le SEUL point d'entree de la fenetre
// d'assignation des charges de reference.
test("visibilite : sans personne mais avec un planning, le board reste rendu", () => {
  assert.deepEqual(resolveChargePaneVisibility({ workerCount: 0, planningRowCount: 12 }), {
    showBoard: true,
    showEmptyMessage: true,
  });
});

test("visibilite : ni personne ni planning -> rien a rendre", () => {
  assert.deepEqual(resolveChargePaneVisibility({ workerCount: 0, planningRowCount: 0 }), {
    showBoard: false,
    showEmptyMessage: true,
  });
});

test("visibilite : des personnes ET un planning -> le board, sans message", () => {
  assert.deepEqual(resolveChargePaneVisibility({ workerCount: 4, planningRowCount: 12 }), {
    showBoard: true,
    showEmptyMessage: false,
  });
});

// --- resolveViewportAnchorDate -----------------------------------------------
//
// L'ancre DOIT tomber dans les bornes. buildInitialProjectViewport applique une
// garde « ne jamais depasser la fin des bornes » : une ancre au-dela rabat la
// fenetre a UN SEUL JOUR, frise effondree.
//
// Le cas n'est pas theorique. `firstPlanningDate` vient de buildRowPhases (le
// modele simplifie) tandis que `planBounds` vient du builder vendorise : une
// ligne au Type_doc vide est ECARTEE par le builder — donc planBounds nul — mais
// buildRowPhases lui emet quand meme son jalon de demarrage. On se retrouve alors
// avec une date de planning sans les bornes qui vont avec.

test("ancre : la premiere date de planning sert d'ancre quand elle tombe dans les bornes", () => {
  assert.equal(
    resolveViewportAnchorDate({
      firstPlanningDate: "2027-02-02",
      bounds: SEGMENT_BOUNDS,
      todayIso: TODAY,
    }),
    "2027-02-02"
  );
});

test("ancre : une date de planning HORS bornes est ecartee, pas subie", () => {
  const bounds = { startDate: "2025-09-16", endDate: "2027-09-16" };
  assert.equal(
    resolveViewportAnchorDate({ firstPlanningDate: "2028-05-01", bounds, todayIso: TODAY }),
    TODAY,
    "sinon la fenetre se rabat a un seul jour"
  );
});

test("ancre : sans date de planning, aujourd'hui fait l'affaire s'il est dans les bornes", () => {
  const bounds = { startDate: "2025-09-16", endDate: "2027-09-16" };
  assert.equal(resolveViewportAnchorDate({ firstPlanningDate: "", bounds, todayIso: TODAY }), TODAY);
});

// Projet entierement dans le futur (segments en 2027) : aujourd'hui est hors
// bornes, on ouvre donc au debut des bornes — le comportement d'avant.
test("ancre : aujourd'hui hors bornes -> on ouvre au debut des bornes", () => {
  assert.equal(
    resolveViewportAnchorDate({ firstPlanningDate: "", bounds: SEGMENT_BOUNDS, todayIso: TODAY }),
    SEGMENT_BOUNDS.startDate
  );
});
