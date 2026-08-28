// Charge mensuelle TOTALE d'une personne — noyau pur de la barre affichee sous
// « Jours effectifs travailles » dans la fenetre d'edition d'un segment.
//
// Le point de la fonction : elle regarde la personne, pas le projet. Les lignes
// TimeSegment recues doivent etre TOUTES les lignes de la table, sans filtre de
// projet ni de service — une personne a 5 jours sur un autre projet est deja a
// 5 jours pris, et c'est precisement ce que la fenetre doit montrer.
//
// COPIE IDENTIQUE OCTET POUR OCTET dans :
//   gestion-depenses2/assets/js/utils/monthLoad.js
//   planning-synchro/assets/js/utils/monthLoad.js
// Verrouille par shared/tests/vendored-charge-modules-parity.test.cjs : toute
// modification doit etre repercutee dans les deux fichiers.
//
// CONTRAINTE DE PORTABILITE : ce module n'importe QUE ./monthSegments.js et
// ./leaveAbsences.js, seuls fichiers presents au meme chemin relatif dans les
// deux widgets. Pas de ./format.js ni d'utilitaire local : leurs versions
// different d'un widget a l'autre.
//
// Aucun DOM, aucun appel Grist : testable sous `node --test`.

import {
  getMonthAvailableDays,
  getMonthKeyFromRawMonth,
  resolveSegmentMonthKey,
} from "./monthSegments.js";
import { normalizeName } from "./leaveAbsences.js";

// Effectif est un multiple de 0,5, mais une somme de flottants derive :
// 0.1 + 16.1 + 5.8 ne vaut pas 22 en binaire. Toutes les comparaisons de jours
// passent donc par cette tolerance — sinon un mois pile a 100 % s'afficherait
// en surcharge.
const DAY_EPSILON = 1e-9;

// Les jours affiches sont arrondis au millionieme : assez fin pour ne rien
// masquer d'une saisie au demi-jour, assez grossier pour effacer la derive
// binaire d'une somme de lignes.
const DAY_ROUNDING = 1e6;

function roundDays(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * DAY_ROUNDING) / DAY_ROUNDING;
}

// Effectif tel qu'il arrive de Grist ou du champ de saisie : nombre, chaine
// pointee, ou chaine a virgule francaise (« 7,5 »), eventuellement entouree
// d'espaces — y compris l'espace insecable des claviers francais.
// Tout ce qui n'est pas un nombre fini vaut 0 jour.
export function parseEffectifDays(value) {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  // \s couvre l espace insecable et l espace fine insecable (categorie Zs).
  const text = String(value).replace(/\s/g, "").replace(",", ".");
  if (!text) return 0;

  const numericValue = Number(text);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

// Les ids de ligne arrivent en nombre depuis Grist, mais en chaine depuis un
// dataset DOM (`barEl.dataset.segmentId`) : « 42 » et 42 designent la meme
// ligne et doivent s'apparier. Un id absent ou vide n'apparie rien — sinon une
// creation (excludeSegmentId null) ecarterait toutes les lignes sans id.
function isSameSegmentId(left, right) {
  if (left == null || left === "" || right == null || right === "") return false;
  if (String(left).trim() === String(right).trim()) return true;

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return (
    Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber
  );
}

// Id d'une ligne : colonne declaree si l'appelant en fournit une (les deux
// config.js declarent `id: "id"`), repli sur la propriete `id` que Grist pose
// sur chaque enregistrement.
function readSegmentId(row, columns) {
  const declared = columns?.id ? row?.[columns.id] : undefined;
  return declared == null || declared === "" ? row?.id : declared;
}

// Charge totale de `personName` sur `monthKey`, tous projets et tous services
// confondus, saisie en cours comprise.
//
// - `allSegmentRows` : TOUTES les lignes TimeSegment, sans filtre.
// - `absenceSet`     : Set<"YYYY-MM-DD:am|pm"> des demi-journees d'absence, ou
//                      null (aucun conge connu => geometrie brute du mois).
// - `excludeSegmentId` : ligne en cours d'edition, remplacee par `draftEffectif`
//                      (null en creation).
export function computeMonthLoad({
  monthKey,
  personName,
  allSegmentRows,
  columns,
  absenceSet = null,
  excludeSegmentId = null,
  draftEffectif = null,
} = {}) {
  // Tolere "2026-09-01" ou une Date en entree : le mois clique n'est pas
  // toujours deja normalise cote appelant.
  const targetMonthKey = getMonthKeyFromRawMonth(monthKey);
  const availableDays = roundDays(getMonthAvailableDays(targetMonthKey, absenceSet));

  const personKey = normalizeName(personName);

  let otherDaysRaw = 0;
  if (targetMonthKey && personKey && Array.isArray(allSegmentRows)) {
    for (const row of allSegmentRows) {
      if (!row) continue;
      if (isSameSegmentId(readSegmentId(row, columns), excludeSegmentId)) continue;
      // Mois illisible (colonnes disparues, valeur aberrante) : ligne ecartee
      // en silence, comme partout ailleurs dans le plan de charge.
      if (resolveSegmentMonthKey(row, columns) !== targetMonthKey) continue;
      if (normalizeName(row?.[columns?.name]) !== personKey) continue;
      otherDaysRaw += parseEffectifDays(row?.[columns?.effectif]);
    }
  }

  // Une saisie negative n'a pas de sens : elle vaut 0 jour, comme une saisie
  // vide ou illisible.
  const draftDaysRaw = Math.max(0, parseEffectifDays(draftEffectif));
  const totalDaysRaw = otherDaysRaw + draftDaysRaw;

  const otherDays = roundDays(otherDaysRaw);
  const draftDays = roundDays(draftDaysRaw);
  const totalDays = roundDays(totalDaysRaw);

  let state = "partial";
  if (totalDaysRaw > availableDays + DAY_EPSILON) {
    state = "overload";
  } else if (totalDaysRaw > availableDays - DAY_EPSILON) {
    // Egalite a la tolerance pres : le mois est pile plein.
    state = "balanced";
  }

  const remainingDays = state === "partial" ? roundDays(availableDays - totalDaysRaw) : 0;
  const overloadDays = state === "overload" ? roundDays(totalDaysRaw - availableDays) : 0;

  // RATIO A DISPONIBILITE NULLE (personne en conge tout le mois) : la division
  // vaudrait Infinity ou NaN, deux valeurs qui cassent une largeur CSS. On
  // sature donc a 1 des qu'il reste de la charge — la barre est pleine, l'etat
  // « overload » dit le reste — et on renvoie 0 quand il n'y a rien a montrer.
  let ratio = 0;
  if (availableDays > 0) {
    ratio = totalDays / availableDays;
  } else if (totalDays > 0) {
    ratio = 1;
  }

  return {
    availableDays,
    otherDays,
    draftDays,
    totalDays,
    state,
    remainingDays,
    overloadDays,
    ratio,
  };
}
