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

// Numero de projet d'une ligne, normalise en chaine. Grist rend NumeroProjet
// tantot en nombre, tantot en chaine : 252035 et « 252035 » designent le meme
// projet et doivent fusionner en une seule entree.
//
// Une valeur absente, vide ou faite d'espaces devient la chaine vide — un seau
// EXPLICITE, jamais une ligne ecartee : ses jours comptent dans otherDays, donc
// les omettre du detail ferait mentir la somme affichee.
function readProjectNumber(row, columns) {
  const raw = columns?.projectNumber ? row?.[columns.projectNumber] : undefined;
  return raw == null ? "" : String(raw).trim();
}

// Charge totale de `personName` sur `monthKey`, tous projets et tous services
// confondus, saisie en cours comprise.
//
// - `allSegmentRows` : TOUTES les lignes TimeSegment, sans filtre.
// - `absenceSet`     : Set<"YYYY-MM-DD:am|pm"> des demi-journees d'absence, ou
//                      null (aucun conge connu => geometrie brute du mois).
// - `excludeSegmentId` : ligne en cours d'edition, remplacee par `draftEffectif`
//                      (null en creation).
//
// Renvoie aussi `byProject` : la ventilation de `otherDays` par numero de projet,
// triee du plus charge au moins charge. La barre dit COMBIEN de jours sont deja
// pris, `byProject` dit OU — et comme les deux sortent de la meme boucle, ils ne
// peuvent pas se contredire. Le module ne connait que des NUMEROS : resoudre un
// nom lisible demande le catalogue Projets2, qui n'est pas au meme chemin dans
// les deux widgets (cf. la contrainte de portabilite en tete de fichier).
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
  const daysByProjectRaw = new Map();
  if (targetMonthKey && personKey && Array.isArray(allSegmentRows)) {
    for (const row of allSegmentRows) {
      if (!row) continue;
      if (isSameSegmentId(readSegmentId(row, columns), excludeSegmentId)) continue;
      // Mois illisible (colonnes disparues, valeur aberrante) : ligne ecartee
      // en silence, comme partout ailleurs dans le plan de charge.
      if (resolveSegmentMonthKey(row, columns) !== targetMonthKey) continue;
      if (normalizeName(row?.[columns?.name]) !== personKey) continue;
      const rowDays = parseEffectifDays(row?.[columns?.effectif]);
      otherDaysRaw += rowDays;

      const projectNumber = readProjectNumber(row, columns);
      daysByProjectRaw.set(projectNumber, (daysByProjectRaw.get(projectNumber) || 0) + rowDays);
    }
  }

  // Les projets a 0 jour sont ecartes de la liste — un segment vide n'apprend
  // rien a l'utilisateur. Ils ne cassent pas l'invariant somme(byProject) ===
  // otherDays, puisqu'ils y contribuent justement 0.
  //
  // Le tri retombe sur le numero a jours egaux : sans ce second critere, l'ordre
  // d'affichage suivrait celui, arbitraire, des lignes renvoyees par Grist, et
  // la liste bougerait d'un rafraichissement a l'autre sans qu'aucune donnee
  // n'ait change.
  const byProject = [...daysByProjectRaw.entries()]
    .map(([projectNumber, rawDays]) => ({ projectNumber, days: roundDays(rawDays) }))
    .filter((entry) => entry.days !== 0)
    .sort((left, right) => {
      if (right.days !== left.days) return right.days - left.days;
      if (left.projectNumber === right.projectNumber) return 0;
      return left.projectNumber < right.projectNumber ? -1 : 1;
    });

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
    byProject,
    draftDays,
    totalDays,
    state,
    remainingDays,
    overloadDays,
    ratio,
  };
}

// Libelles de la liste « Deja engage ce mois-ci », a partir de la ventilation
// rendue ci-dessus. Vit ICI, avec le calcul qui la nourrit : la fenetre de
// gestion-depenses2 et celle de planning-synchro l'affichent toutes les deux, et
// deux copies independantes finiraient par diverger sur les memes donnees.
//
// Ce module ne connait que des NUMEROS de projet : le nom lisible vit dans le
// catalogue Projets2, que seul le widget sait lire. `resolveProjectLabel` est
// donc injectee, et son echec est PREVU, pas accidentel :
//
// - numero absent (segment sans NumeroProjet) -> « Projet non renseigne ». Ses
//   jours comptent dans le total, les taire ferait mentir la somme affichee.
// - numero inconnu du catalogue (projet d'un AUTRE service, ou masque par les
//   ACL) -> le numero nu. Le masquer serait pire : l'utilisateur chercherait des
//   jours manquants qui existent bel et bien.
export function formatLoadProjectEntries(byProject, resolveProjectLabel) {
  const resolve = typeof resolveProjectLabel === "function" ? resolveProjectLabel : () => "";

  return (Array.isArray(byProject) ? byProject : []).map((entry) => {
    const projectNumber = String(entry?.projectNumber ?? "").trim();
    if (!projectNumber) {
      return { projectNumber: "", days: entry?.days ?? 0, label: "Projet non renseigne" };
    }

    let name = "";
    try {
      name = String(resolve(projectNumber) ?? "").trim();
    } catch {
      // Un catalogue en cours de rechargement ne doit pas faire tomber la
      // fenetre entiere : on retombe sur le numero nu.
      name = "";
    }

    return {
      projectNumber,
      days: entry?.days ?? 0,
      label: name ? `${projectNumber} · ${name}` : projectNumber,
    };
  });
}

// Index de surcharge, par couple (personne, mois).
//
// Une barre de segment du plan de charge vire a la teinte de surcharge quand la
// PERSONNE depasse sa capacite du mois, tous projets confondus — et donc pas
// forcement a cause du segment affiche. Un segment de 2 j peut alerter parce que
// la personne en a 25 ailleurs : c'est voulu, la couleur parle de la personne,
// pas du projet regarde. L'infobulle est la pour lever l'ambiguite.
//
// A ne pas confondre avec l'etat « incoherent » (rouge) des deux widgets, qui
// compare l'effectif d'UN segment au disponible de son mois : celui-la denonce
// une saisie fausse, celui-ci une charge trop lourde.
//
// POURQUOI UN INDEX : computeMonthLoad rebalaie TOUTE la table a chaque appel.
// Un board affiche des dizaines de barres, souvent pour la meme personne sur des
// mois voisins ; sans dedoublonnage par couple, le rendu deviendrait quadratique
// en nombre de lignes TimeSegment.
//
// - `entries` : les couples { personName, monthKey } affiches, doublons admis.
// - `resolveAbsenceSet(personName)` : jeu de demi-journees d'absence, ou null.
//   Les conges reduisent la capacite : 20 j poses sur un mois entierement pris
//   par des conges sont une surcharge, sans qu'aucun segment n'ait bouge.
export function buildMonthOverloadIndex({
  entries = [],
  allSegmentRows = [],
  columns = {},
  resolveAbsenceSet = null,
} = {}) {
  const loads = new Map();

  // La cle passe par normalizeName : les segments viennent de TimeSegment et les
  // noms affiches de Team, qui ne s'ecrivent pas toujours pareil (accents,
  // casse). Sans cette normalisation la barre resterait neutre EN SILENCE.
  const keyOf = (personName, monthKey) =>
    `${normalizeName(personName)}|${getMonthKeyFromRawMonth(monthKey) || ""}`;

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const personName = entry?.personName;
    const monthKey = entry?.monthKey;
    const key = keyOf(personName, monthKey);
    if (loads.has(key)) return;

    const absenceSet =
      typeof resolveAbsenceSet === "function" ? resolveAbsenceSet(personName) : null;

    loads.set(
      key,
      computeMonthLoad({
        monthKey,
        personName,
        allSegmentRows,
        columns,
        absenceSet: absenceSet instanceof Set ? absenceSet : null,
      })
    );
  });

  return {
    isOverloaded(personName, monthKey) {
      return loads.get(keyOf(personName, monthKey))?.state === "overload";
    },
    // Rend la charge complete du couple, pour que l'appelant puisse ecrire
    // « N j sur M disponibles » plutot qu'afficher une couleur muette.
    getLoad(personName, monthKey) {
      return loads.get(keyOf(personName, monthKey)) || null;
    },
  };
}
