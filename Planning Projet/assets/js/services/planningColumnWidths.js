// Largeur réglable des colonnes du planning Structure (volet gauche de la timeline) : colonnes
// concernées, lecture des largeurs mémorisées et calcul des largeurs pendant un glisser. Pur :
// ni DOM ni stockage, c'est ui/planningColumnResize.js qui branche le tout.

// Mêmes colonnes et même ordre que l'en-tête (index.html, .planning-header-left) : la colonne
// `key` a le titre `.c-<key>` et la largeur `--col-<key>` (styles.css).
export const PLANNING_COLUMNS = Object.freeze([
  { key: "id2", label: "Id" },
  { key: "task", label: "Tâches" },
  { key: "ligne-planning", label: "Ligne planning" },
  { key: "start", label: "Début" },
  { key: "duration-1", label: "Durée" },
  { key: "end", label: "Fin" },
  { key: "duration-2", label: "Durée" },
  { key: "demarrage", label: "Démarrage Travaux" },
  { key: "indice", label: "Indice" },
  { key: "realise", label: "Réalisation" },
  { key: "retards", label: "Retard" },
].map((column) => Object.freeze(column)));

export const COLUMN_WIDTHS_STORAGE_KEY = "planning-projet.structure.column-widths";
// Comme dans le tableau de Synthèse.
export const MIN_COLUMN_WIDTH = 36;
// Le volet gauche ne descend pas sous cette largeur et laisse au moins celle-ci au planning.
export const PANE_MIN_WIDTH = 260;
export const PANE_MIN_TIMELINE_WIDTH = 320;

export function columnCssVar(key) {
  return `--col-${key}`;
}

// Largeurs mémorisées (texte JSON) : seules les colonnes réglées par l'utilisateur y figurent, les
// autres gardent la largeur de la feuille de style. Ce qui ne se lit pas est ignoré.
export function readColumnWidths(raw) {
  let stored = null;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch (_error) {
    stored = null;
  }
  const widths = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return widths;
  PLANNING_COLUMNS.forEach(({ key }) => {
    const value = Number(stored[key]);
    if (Number.isFinite(value) && value > 0) widths[key] = Math.max(MIN_COLUMN_WIDTH, Math.round(value));
  });
  return widths;
}

// Glisser le bord droit d'une colonne de `delta` px. Elle ne grandit pas au-delà de `maxWidth` ;
// si elle le dépasse déjà (fenêtre rétrécie depuis), elle garde sa largeur tant qu'on ne la rétrécit pas.
export function resizeColumn(startWidth, delta, maxWidth = Infinity) {
  const wanted = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + delta));
  return Math.min(wanted, Math.max(maxWidth, startWidth));
}

// Place que le volet gauche peut occuper : la fenêtre moins la part du planning, ou ce qu'il occupe
// déjà s'il a plus (dans une fenêtre étroite, il s'ouvre sur toutes ses colonnes).
export function paneRoom({ paneWidth = 0, viewportWidth }) {
  return Math.max(viewportWidth - PANE_MIN_TIMELINE_WIDTH, paneWidth);
}

// Largeur la plus grande d'une colonne dont le titre finit à `cellRight` px du bord gauche : son bord
// droit doit rester dans la place du volet gauche (`room`), sinon la poignée passerait sous le
// planning et la colonne ne pourrait plus être rétrécie.
export function maxColumnWidth({ width, cellRight, room, padX = 0 }) {
  return width + (room - padX) - cellRight;
}

// Largeurs à afficher pour les colonnes réglées (`custom`), dans une fenêtre qui peut être plus
// étroite que celle où elles ont été réglées : une colonne trop large est ramenée à ce qui laisse sa
// poignée atteignable, sans descendre sous la largeur de la feuille de style (`defaults`). La
// largeur mémorisée, elle, n'est pas touchée : elle revient dès que la fenêtre le permet.
export function fitColumnWidths({ custom, defaults, viewportWidth, padX = 0 }) {
  // Cadre encore masqué, fenêtre sans largeur : rien à quoi ajuster.
  if (!(viewportWidth > 0)) return { ...custom };
  const room = paneRoom({ viewportWidth });
  const fitted = {};
  // Bord gauche de la colonne en cours.
  let left = padX;
  PLANNING_COLUMNS.forEach(({ key }) => {
    let width = defaults[key];
    if (key in custom) {
      const available = room - padX - left;
      width = Math.min(custom[key], Math.max(available, defaults[key]));
      fitted[key] = width;
    }
    left += width;
  });
  return fitted;
}

// Bornes du volet gauche : au plus toutes ses colonnes (`naturalWidth`), en laissant
// PANE_MIN_TIMELINE_WIDTH au planning.
export function paneWidthBounds({ naturalWidth, viewportWidth }) {
  const maxWidth = Math.max(
    PANE_MIN_WIDTH,
    Math.min(naturalWidth || PANE_MIN_WIDTH, viewportWidth - PANE_MIN_TIMELINE_WIDTH)
  );
  return { minWidth: Math.min(PANE_MIN_WIDTH, maxWidth), maxWidth };
}

// Largeur du volet gauche quand une de ses colonnes a changé de `delta` px depuis le début du
// glisser. `start` est l'état relevé au début du glisser, pour ne rien avoir à relire pendant.
// - Volet aussi large que possible au départ (toutes ses colonnes, ou borné par la fenêtre) : il le
//   reste, donc des colonnes cachées par la fenêtre reviennent quand la colonne rétrécit.
// - Volet réduit à la main : il suit la colonne, pour garder les mêmes colonnes visibles.
// Dans les deux cas il ne prend pas plus que sa place (`paneRoom`) : un volet déjà plus large que
// ce que la fenêtre permet ne saute pas, il ne grandit simplement plus.
export function paneWidthDuringResize({ paneWidth, naturalWidth, viewportWidth }, delta) {
  const room = paneRoom({ paneWidth, viewportWidth });
  const natural = naturalWidth + delta;
  const atMax = paneWidth >= Math.min(naturalWidth, room);
  const wanted = atMax ? natural : Math.min(paneWidth + delta, natural);
  return Math.max(PANE_MIN_WIDTH, Math.min(wanted, room));
}
