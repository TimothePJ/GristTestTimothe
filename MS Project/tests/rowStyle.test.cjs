// Couleur de fond des lignes du tableau, reprise du planning MS Project.
// Le fichier XML ne donne que le nom du style de chaque ligne (colonne Style_Ligne) ; les
// couleurs attendues ici ont été relevées sur une capture du planning Hôtel Dieu.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const serviceUrl = pathToFileURL(
  path.join(__dirname, "..", "assets", "js", "services", "msProjectService.js")
).href;

const PLANNING = "Planning A";

const LEVEL_2 = { fill: "#0070C0", whiteText: true, bold: true };
const LEVEL_3 = { fill: "#9CC3E5", whiteText: false, bold: true };
const LEVEL_4 = { fill: "#C8C8C8", whiteText: false, bold: false };
const LEVEL_5 = { fill: "#DCDCDC", whiteText: false, bold: false };
const LEVEL_6 = { fill: "#F0F0F0", whiteText: false, bold: false };

// Une ligne de la table MsProject, telle que l'import l'écrit. `section` : tâche
// récapitulative (Bold = « Oui »). `style` : nom du style de ligne MS Project.
function line(uniqueNumber, { level, style, section = true, start = "2026-03-02" }) {
  return {
    id: 100 + uniqueNumber,
    Indicateur: uniqueNumber + 1,
    Numero_Unique: String(uniqueNumber),
    Nom_Tache: `Ligne ${uniqueNumber}`,
    Nom: PLANNING,
    Debut: start,
    Fin: "2026-03-13",
    Duree: 10,
    Niveau: level,
    Bold: section ? "Oui" : "",
    Style_Barre: "",
    Style_Ligne: style,
  };
}

// Style d'affichage de chaque ligne, dans l'ordre du fichier XML : numéro unique → style.
async function rowStyles(rows, sortMode = "xml-order") {
  const { buildTimelineDataFromMsProjectRows } = await import(serviceUrl);
  const data = buildTimelineDataFromMsProjectRows(rows, PLANNING, sortMode);
  return Object.fromEntries(data.groups.map((group) => [group.idLabel, group.rowStyle]));
}

test("une section en style Auto prend la couleur de son niveau", async () => {
  const styles = await rowStyles([
    line(1, { level: "2", style: "Auto" }),
    line(2, { level: "3", style: "Auto" }),
    line(3, { level: "4", style: "Auto" }),
    line(4, { level: "5", style: "Auto" }),
    line(5, { level: "6", style: "Auto" }),
  ]);

  assert.deepEqual(styles, { 1: LEVEL_2, 2: LEVEL_3, 3: LEVEL_4, 4: LEVEL_5, 5: LEVEL_6 });
});

test("une tâche simple en style Auto reste sans fond", async () => {
  const styles = await rowStyles([
    line(1, { level: "3", style: "Auto" }),
    line(2, { level: "4", style: "Auto", section: false }),
  ]);

  assert.deepEqual(styles, { 1: LEVEL_3, 2: null });
});

test("une section d'un niveau dont la couleur n'est pas connue reste sans fond", async () => {
  const styles = await rowStyles([
    line(1, { level: "1", style: "Auto" }),
    line(2, { level: "7", style: "Auto" }),
    line(3, { level: "", style: "Auto" }),
  ]);

  assert.deepEqual(styles, { 1: null, 2: null, 3: null });
});

test("un style « Niv_N » impose la couleur du niveau N, quel que soit le niveau de la ligne", async () => {
  const styles = await rowStyles([
    line(1, { level: "2", style: "Niv_4" }),
    line(2, { level: "6", style: "Niv_2", section: false }),
  ]);

  assert.deepEqual(styles, { 1: LEVEL_4, 2: LEVEL_2 });
});

test("les styles dont la couleur n'est pas connue restent sans fond", async () => {
  const names = [
    "Titre_1", "Titre_2", "Titre_3", "HL_Rouge", "HL_Vert", "HL_Bleu", "HL_Noir",
    "Aucun", "Masqué", "Niv", "Niv_1", "Niv_7",
  ];
  const styles = await rowStyles(
    names.map((style, index) => line(index + 1, { level: "2", style }))
  );

  assert.deepEqual(Object.values(styles), names.map(() => null));
});

// Les plannings importés avant l'enregistrement du style n'ont rien dans Style_Ligne : ils
// doivent s'afficher exactement comme avant, même si leurs sections ont un niveau.
test("une ligne sans style enregistré reste sans fond", async () => {
  const withoutColumn = line(2, { level: "2", style: "" });
  delete withoutColumn.Style_Ligne;
  const styles = await rowStyles([line(1, { level: "2", style: "" }), withoutColumn]);

  assert.deepEqual(styles, { 1: null, 2: null });
});

test("le nom du style est reconnu quelle que soit sa casse", async () => {
  const styles = await rowStyles([
    line(1, { level: "2", style: " auto " }),
    line(2, { level: "2", style: "NIV_3" }),
  ]);

  assert.deepEqual(styles, { 1: LEVEL_2, 2: LEVEL_3 });
});

// La couleur tient à la ligne, pas à sa place : elle suit la ligne dans les autres tris.
test("la couleur d'une ligne ne dépend pas du tri affiché", async () => {
  const rows = [
    line(1, { level: "2", style: "Auto", start: "2026-05-04" }),
    line(2, { level: "3", style: "Auto", start: "2026-03-02" }),
  ];

  assert.deepEqual(await rowStyles(rows, "chronological"), { 1: LEVEL_2, 2: LEVEL_3 });
  assert.deepEqual(await rowStyles(rows, "planning-number"), { 1: LEVEL_2, 2: LEVEL_3 });
});
