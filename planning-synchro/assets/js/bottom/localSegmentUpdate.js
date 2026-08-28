// Mise a jour LOCALE des lignes TimeSegment apres une ecriture reussie.
//
// POURQUOI CE MODULE EXISTE : apres chaque ecriture, main.js rechargeait tout le
// projet (`fetchProjectData()`) puis redessinait — le planning clignotait et la
// position de defilement sautait. Le jumeau gestion-depenses2 applique la
// modification aux donnees deja en memoire et redessine sans aller-retour ; ce
// module est le noyau pur de cette application locale cote planning-synchro.
//
// DIFFERENCE ASSUMEE AVEC LE JUMEAU : gestion-depenses2 est OPTIMISTE (il pose la
// modification AVANT l'ecriture et fait marche arriere si elle echoue). Ici la
// modification est appliquee APRES une ecriture reussie : chargeEditing appelle
// `onChanged(change)` seulement quand le CRUD Grist a abouti. Il n'y a donc
// aucune fenetre pendant laquelle l'etat local contredit la base — et donc rien a
// annuler en cas d'echec (le message d'erreur du board reste le seul effet).
//
// DEUX TABLEAUX, PAS UN :
// - `projectRows` : les lignes du projet affiche, qui alimentent le pane bas ;
// - `allRows`     : TOUTES les lignes TimeSegment, tous projets et tous services,
//                   qui alimentent la barre de charge mensuelle de la fenetre
//                   (cf. utils/monthLoad.js, qui raisonne sur la PERSONNE).
// Oublier le second afficherait des chiffres perimes des la premiere sauvegarde.
//
// REPLI ASSUME : quand le changement n'est pas applicable a coup sur (creation
// sans id Grist, ligne introuvable), la fonction rend `applied: false` et laisse
// les tableaux intacts — a l'appelant de retomber sur un rechargement complet
// plutot que d'afficher un etat invente.
//
// Aucun DOM, aucun appel Grist : testable sous `node --test`.

import { toGristMonthValue, getMonthBusinessDays } from "../utils/monthSegments.js";

// Id d'une ligne : colonne declaree si l'appelant en fournit une (config.js
// declare `id: "id"`), repli sur la propriete `id` que Grist pose sur chaque
// enregistrement. Meme regle que utils/monthLoad.js.
function readRowId(row, columns) {
  const declared = columns?.id ? row?.[columns.id] : undefined;
  return declared == null || declared === "" ? row?.id : declared;
}

// « 42 » (dataset DOM) et 42 (retour Grist) designent la meme ligne.
function isSameId(left, right) {
  if (left == null || left === "" || right == null || right === "") return false;
  if (String(left).trim() === String(right).trim()) return true;

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
}

function toRows(value) {
  return Array.isArray(value) ? value : [];
}

// Ligne synthetique equivalente a ce que Grist renverra au prochain fetch. Seules
// les colonnes REELLEMENT relues par le widget sont posees (mois, personne,
// effectif, numero projet, jours ouvres) ; `Service` est laissee a Grist, aucun
// lecteur du plan de charge ne la filtre.
function buildCreatedRow({ segmentId, monthKey, workerName, effectif }, columns, projectNumber) {
  return {
    id: segmentId,
    [columns.id]: segmentId,
    [columns.projectNumber]: projectNumber,
    [columns.name]: workerName,
    [columns.mois]: toGristMonthValue(monthKey),
    [columns.allocationDays]: getMonthBusinessDays(monthKey),
    [columns.effectif]: effectif,
  };
}

function patchRow(row, { monthKey, effectif }, columns) {
  const next = { ...row };
  if (monthKey) {
    next[columns.mois] = toGristMonthValue(monthKey);
    next[columns.allocationDays] = getMonthBusinessDays(monthKey);
    // La ligne bascule sur `Mois` : le repli legacy sur Start_At ne doit plus
    // pouvoir contredire le mois qu'on vient d'ecrire (cf. spec §12).
    if (columns.startDate && Object.prototype.hasOwnProperty.call(next, columns.startDate)) {
      delete next[columns.startDate];
    }
  }
  if (effectif !== undefined) {
    next[columns.effectif] = effectif;
  }
  return next;
}

// Separateurs (unites ASCII 0x1F/0x1E) impossibles a rencontrer dans une valeur
// Grist : sans eux, deux jeux de lignes differents pourraient produire la meme
// empreinte par simple concatenation. Puis les colonnes qui font la DIFFERENCE a
// l'ecran : celles que le pane bas, les bornes de la frise et la barre de charge
// mensuelle relisent.
//
// `label` EN FAIT PARTIE : chargeBoard.js le lit (buildWorkersFromSegments) et
// s'en sert comme TEXTE DE LA BARRE (`segment?.label || "X j"`). Les deux widgets
// savent l'ecrire et la colonne reste editable dans la vue brute Grist : l'exclure
// avalait un changement reellement externe — le libelle restait perime a l'ecran
// jusqu'au prochain changement d'une AUTRE colonne.
//
// `End_At` et `Service` n'y sont pas : plus aucun lecteur du plan de charge ne les
// relit, Grist peut donc les rendre autrement sans qu'aucun pixel ne change.
const FIELD_SEPARATOR = "\u001f";
const ROW_SEPARATOR = "\u001e";
const SIGNATURE_COLUMN_KEYS = [
  "mois",
  "startDate",
  "effectif",
  "name",
  "projectNumber",
  "allocationDays",
  "label",
];

// timeSegmentRowsSignature(rows, columns) → chaine comparable
//
// POURQUOI : le relais de synchronisation inter-widgets reveille ce widget apres
// CHAQUE ecriture TimeSegment — la sienne comprise (cf.
// shared/grist-service-context.js : « que le changement vienne de LUI, d'un autre
// widget de la page, ou d'un autre utilisateur »). Apres sa propre ecriture, la
// mise a jour locale ci-dessus a deja pose le resultat a l'ecran : redessiner sur
// des lignes identiques ne ferait que faire clignoter le pane bas.
//
// Comparer les lignes plutot qu'armer un jeton « ignorer le prochain signal » :
// un jeton avalerait l'ecriture SIMULTANEE d'un autre utilisateur, alors qu'une
// empreinte differente redessine toujours. Dans le doute, l'empreinte differe et
// le widget se rafraichit.
//
// L'ordre des lignes n'est pas significatif (Grist renvoie ses propres tris, la
// creation locale ajoute en fin de tableau) : les empreintes de ligne sont donc
// triees avant d'etre concatenees.
export function timeSegmentRowsSignature(rows, columns) {
  const cols = columns || {};
  const fieldNames = SIGNATURE_COLUMN_KEYS.map((key) => cols[key]).filter(Boolean);

  return toRows(rows)
    .map((row) => {
      const id = readRowId(row, cols);
      const fields = fieldNames.map((fieldName) => {
        const value = row?.[fieldName];
        return value == null ? "" : String(value);
      });
      return [id == null ? "" : String(id), ...fields].join(FIELD_SEPARATOR);
    })
    .sort()
    .join(ROW_SEPARATOR);
}

// applySegmentChangeLocally({ change, projectRows, allRows, columns, projectNumber })
//   → { applied, projectRows, allRows }
//
// `change` est le descripteur emis par bottom/chargeEditing.js apres une ecriture
// reussie : { type: "create"|"update"|"delete", segmentId, monthKey, workerName,
// effectif }. Les tableaux rendus sont TOUJOURS neufs (jamais mutes sur place) :
// une fermeture qui tiendrait encore l'ancien tableau ne doit pas voir la
// modification par effet de bord.
export function applySegmentChangeLocally({
  change,
  projectRows,
  allRows,
  columns,
  projectNumber,
} = {}) {
  const currentProjectRows = toRows(projectRows);
  const currentAllRows = toRows(allRows);
  const unchanged = { applied: false, projectRows: currentProjectRows, allRows: currentAllRows };

  if (!change || !columns) return unchanged;

  const segmentId = change.segmentId;
  if (segmentId == null || segmentId === "") return unchanged;

  if (change.type === "create") {
    const createdRow = buildCreatedRow(change, columns, projectNumber);
    if (createdRow[columns.mois] == null) return unchanged;

    return {
      applied: true,
      projectRows: [...currentProjectRows, createdRow],
      allRows: [...currentAllRows, createdRow],
    };
  }

  if (change.type === "update") {
    const found = currentProjectRows.some((row) => isSameId(readRowId(row, columns), segmentId));
    if (!found) return unchanged;

    const patch = (rows) =>
      rows.map((row) => (isSameId(readRowId(row, columns), segmentId) ? patchRow(row, change, columns) : row));

    return { applied: true, projectRows: patch(currentProjectRows), allRows: patch(currentAllRows) };
  }

  if (change.type === "delete") {
    const found = currentProjectRows.some((row) => isSameId(readRowId(row, columns), segmentId));
    if (!found) return unchanged;

    const drop = (rows) => rows.filter((row) => !isSameId(readRowId(row, columns), segmentId));
    return { applied: true, projectRows: drop(currentProjectRows), allRows: drop(currentAllRows) };
  }

  return unchanged;
}
