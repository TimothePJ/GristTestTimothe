// Libelles et couleurs partages des taches du graphique (top/planningChart.js) et
// des fenetres du lissage (liste du mois, fenetre « Lissage »).
//
// Module PUR, sans DOM : il ne porte que des constantes et deux formateurs de
// texte francais. Il est la SOURCE UNIQUE des constantes TYPE_META / TYPE_ORDER /
// TOTAL_META et de formatMonthLabel : le graphique (top/planningChart.js), le
// lissage (taskSmoothing.js, smoothingSettings.js, smoothingController.js) et
// les deux fenetres les importent d'ici, aucun n'en garde de copie.

// Ordre d'affichage des six types de tache, tel que le graphique les trace.
export const TYPE_ORDER = ["COFFRAGE", "ARMATURES", "NDC", "COUPES", "DEMOLITION", "AUTRES"];

// Libelle et couleur de trait de chaque type. AUTRES regroupe tout type
// personnalise du projet.
export const TYPE_META = {
  COFFRAGE: { label: "Coffrage", color: "#d97706" },
  ARMATURES: { label: "Armature", color: "#475569" },
  NDC: { label: "NDC", color: "#7c3aed" },
  COUPES: { label: "Coupes", color: "#16a34a" },
  DEMOLITION: { label: "Démolition", color: "#dc2626" },
  AUTRES: { label: "Autres", color: "#8470ff" },
};

// Serie generale (tous types confondus).
export const TOTAL_META = { label: "Total", color: "#004990" };

const MONTH_NAMES_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

// Raison d'un depassement restant (SmoothingResult.overflows[].reason, §4.7),
// telle qu'elle s'affiche dans la liste du mois et dans la fenetre « Lissage ».
export const OVERFLOW_REASON_LABELS = {
  "taches-realisees": "tâches réalisées",
  "mois-en-cours": "mois en cours",
  "taches-passees": "tâches réalisées ou en retard",
  "coffrage-sans-place": "coffrage sans place",
  "plus-de-place": "plus de place avant",
};

// "2027-04" -> "avril 2027". Cle invalide -> "".
export function formatMonthLabel(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? "").trim());
  if (!match) return "";
  const monthName = MONTH_NAMES_FR[Number(match[2]) - 1];
  return monthName ? `${monthName} ${match[1]}` : "";
}

// "2027-03-05" -> "05/03/2027". Date invalide -> "".
export function formatDateFr(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}
