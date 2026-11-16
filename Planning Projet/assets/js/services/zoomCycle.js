// Échelle du planning (bouton du bandeau) : semaine, mois, année, dans cet ordre ; un clic passe à
// la suivante et la dernière ramène à la première. Module pur, sans DOM.
export const ZOOM_MODES = Object.freeze(["week", "month", "year"]);

const ZOOM_LABELS = Object.freeze({ week: "Semaine", month: "Mois", year: "Année" });

// Libellé du bouton pour une échelle ; une échelle inconnue vaut la semaine.
export function zoomModeLabel(mode) {
  return ZOOM_LABELS[mode] || ZOOM_LABELS.week;
}

// L'échelle qui suit `mode` : Semaine → Mois → Année → Semaine ; inconnue → Semaine.
export function nextZoomMode(mode) {
  const index = ZOOM_MODES.indexOf(mode);
  return index < 0 ? ZOOM_MODES[0] : ZOOM_MODES[(index + 1) % ZOOM_MODES.length];
}
