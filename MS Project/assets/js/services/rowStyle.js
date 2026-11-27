// Nuancier des lignes du tableau, repris du planning MS Project.
//
// Le fichier XML ne donne que le NOM du style de chaque ligne (champ « StyleTab » du modèle
// de planning, enregistré dans la colonne Style_Ligne) : « Auto », « Niv_3 », « Titre_1 »,
// « HL_Rouge »… Les couleurs, elles, vivent dans le modèle MS Project. Celles-ci ont été
// relevées sur une capture du planning Hôtel Dieu : fond, texte blanc ou non, gras ou non.
// Un style qui n'est pas dans ce nuancier laisse la ligne sans fond : pour en ajouter un, il
// suffit de le déclarer ici.
const LEVEL_STYLES = new Map([
  [2, { fill: "#0070C0", whiteText: true, bold: true }],
  [3, { fill: "#9CC3E5", whiteText: false, bold: true }],
  [4, { fill: "#C8C8C8", whiteText: false, bold: false }],
  [5, { fill: "#DCDCDC", whiteText: false, bold: false }],
  [6, { fill: "#F0F0F0", whiteText: false, bold: false }],
]);

// `styleName` : contenu de Style_Ligne. `level` : niveau hiérarchique de la ligne (nombre ou
// `null`). `isSection` : la ligne est une tâche récapitulative.
// Renvoie `{ fill, whiteText, bold }`, ou `null` quand la ligne garde son aspect habituel.
export function resolveRowStyle({ styleName, level, isSection }) {
  const name = String(styleName ?? "").trim().toLocaleLowerCase("fr");

  // « Auto » : MS Project colore la section selon son niveau, et laisse les tâches simples.
  if (name === "auto") {
    return (isSection && LEVEL_STYLES.get(level)) || null;
  }

  // « Niv_N » : la couleur du niveau N, imposée à la main quelle que soit la ligne.
  const forcedLevel = /^niv_(\d+)$/.exec(name);
  return (forcedLevel && LEVEL_STYLES.get(Number(forcedLevel[1]))) || null;
}
