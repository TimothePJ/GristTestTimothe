// Etat du pane bas : QUOI afficher, et sur QUELLE periode.
//
// Ces deux decisions vivaient dans le `if (bounds) / else` de
// main.js::loadProject, donc dependaient de l'existence d'une ligne TimeSegment.
// C'etait le mauvais critere : un projet dont personne n'avait encore pose de
// segment se rendait ENTIEREMENT VIDE — les membres de ProjectTeam etaient jetes
// (`workers: []`), donc aucune piste a cliquer, donc aucun moyen de creer le
// premier segment depuis planning-synchro. Il fallait passer par
// gestion-depenses2 pour amorcer, apres quoi tout le monde apparaissait d'un
// coup. Les regles ci-dessous se prononcent sur ce qu'il y a REELLEMENT a
// montrer : des personnes, des lignes de planning.
//
// Extraire ces regles ici plutot que de les laisser en ligne dans main.js sert
// aussi a les rendre UNIQUES : loadProject (chargement initial) et
// renderChargeFromLocalRows (rafraichissement apres ecriture) divergeaient
// justement sur ce point, le second affichant deja les personnes que le premier
// jetait.
//
// Module PUR : aucun DOM, aucun appel Grist. Testable sous `node --test`.

import { normalizeIsoDate, shiftIsoDateValue } from "../viewport/normalize.js";

// Demi-largeur du repli temporel, en jours, quand un projet n'offre AUCUNE date
// (ni segment, ni phase datable). Assez large pour que tout mois raisonnable
// reste atteignable a la molette ou au glisser, sans quoi le premier segment ne
// pourrait se poser que dans la fenetre ou l'on est tombe.
const FALLBACK_BOUNDS_RADIUS_DAYS = 365;

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Union de deux bornes { startDate, endDate } ISO (l'une ou l'autre peut etre
// nulle). Les dates ISO se comparent lexicographiquement : min des debuts / max
// des fins est une simple comparaison de chaines.
export function unionDateBounds(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return {
    startDate: a.startDate < b.startDate ? a.startDate : b.startDate,
    endDate: a.endDate > b.endDate ? a.endDate : b.endDate,
  };
}

// Bornes de la frise partagee : l'union du previsionnel (TimeSegment) et des
// phases du planning. Sans ni l'un ni l'autre, on ouvre une fenetre large autour
// d'aujourd'hui plutot que de se refermer sur le mois courant.
//
// `todayIso` est INJECTE pour que le repli soit testable ; une valeur illisible
// retombe sur l'horloge reelle, jamais sur des bornes vides (elles empecheraient
// tout deplacement dans la frise).
export function resolveChargeBounds({ segmentBounds, planBounds, todayIso } = {}) {
  const union = unionDateBounds(segmentBounds || null, planBounds || null);
  if (union) return union;

  const anchor = normalizeIsoDate(todayIso) || todayIsoDate();
  return {
    startDate: shiftIsoDateValue(anchor, -FALLBACK_BOUNDS_RADIUS_DAYS),
    endDate: shiftIsoDateValue(anchor, FALLBACK_BOUNDS_RADIUS_DAYS),
  };
}

// Ce que le pane bas montre :
//   showBoard        — rendre la grille (pistes, Total, Charge) ;
//   showEmptyMessage — afficher « Aucun previsionnel pour ce projet. ».
//
// Le message parle des PERSONNES, pas des segments : une equipe sans aucun
// segment a bien quelque chose a montrer (ses pistes vides, pretes a recevoir un
// premier segment), et le message y serait un contresens.
//
// Sans personne mais avec un planning, la grille reste rendue : c'est elle qui
// porte la ligne Charge, dont le bouton est le SEUL point d'entree de la fenetre
// d'assignation des charges de reference — exactement le cas ou l'on veut definir
// les charges AVANT d'avoir pose le moindre previsionnel.
export function resolveChargePaneVisibility({ workerCount, planningRowCount } = {}) {
  const hasWorkers = Number(workerCount) > 0;
  const hasPlanningRows = Number(planningRowCount) > 0;

  return {
    showBoard: hasWorkers || hasPlanningRows,
    showEmptyMessage: !hasWorkers,
  };
}

// Date sur laquelle ouvrir la fenetre initiale, GARANTIE dans les bornes.
//
// buildInitialProjectViewport applique une garde « ne jamais depasser la fin des
// bornes » : une ancre posee au-dela rabat la fenetre a UN SEUL JOUR. Le cas
// n'est pas theorique — `firstPlanningDate` vient de buildRowPhases (le modele
// simplifie) alors que les bornes viennent du builder vendorise, qui ECARTE
// certaines lignes (Type_doc vide, par exemple) tout en laissant buildRowPhases
// emettre leur jalon de demarrage. On peut donc parfaitement avoir une date de
// planning sans les bornes qui vont avec.
//
// Ordre de preference : la premiere date de planning, puis aujourd'hui, puis le
// debut des bornes. Les deux premieres ne sont retenues que si elles tombent
// DANS les bornes ; un projet entierement dans le futur s'ouvre donc au debut de
// ses bornes, comme avant.
export function resolveViewportAnchorDate({ firstPlanningDate, bounds, todayIso } = {}) {
  const startDate = normalizeIsoDate(bounds?.startDate);
  const endDate = normalizeIsoDate(bounds?.endDate);
  const isInsideBounds = (value) => (
    Boolean(value) && (!startDate || value >= startDate) && (!endDate || value <= endDate)
  );

  const preferred = [
    normalizeIsoDate(firstPlanningDate),
    normalizeIsoDate(todayIso) || todayIsoDate(),
  ];

  return preferred.find(isInsideBounds) || startDate || "";
}
