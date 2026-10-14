// Jeu d'essai de la vue Global, repris de la base de test (ERA QUAI D'ORSAY) : Planning_Projet
// du projet, tous services, et sa liste de plans. Aujourd'hui = vendredi 09/10/26.
//
// Structure
//   Zone 1 / BAT BC : coffrage 3031 (id 101, groupe 4) et son armature 3216 (102).
//   Zone 2 / BAT B  : coffrages 3032 (113, groupe 13), 3012 (111, groupe 11), 3022 (112,
//                     groupe 12), chacun avec une armature (123, 121, 122) ; coupes 3820 (131) ;
//                     armature sans groupe 3724 (142, terminée).
//   Sans zone       : NDC 3999 (141, terminée).
// Synthèse (étages créés d'après le modèle, durées de la capture, RECEPTION au 02/01/26)
//   Zone 1 / BAT BC : SS1 (ligne-étage 200) lié au coffrage 3031.
//   Zone 2 / BAT B  : SS1 (300) lié à 3022 ; RDC (400) lié à 3032, dont la tâche contrôlée
//                     choisie (420) finit le 30/11/26 ; R+1 (500) non lié, une tâche (501) ;
//                     « Réunion de lancement » (600) hors étage.
// Liste de plans : 0 Prev de 3022 au 02/01/26 (fond de plan à jour), de 3031 au 27/11/25 (à
// mettre à jour), rien pour 3032.
import { datedRows } from "./templateRows.mjs";

export const PROJECT = "ERA QUAI D'ORSAY";
export const ZONE_1 = "Zone 1 / BAT BC";
export const ZONE_2 = "Zone 2 / BAT B";
export const TODAY = new Date(2026, 9, 9);

function structureRow(id, fields = {}) {
  return {
    id,
    NomProjet: PROJECT,
    Service: "Structure",
    ID2: "",
    Taches: "",
    Type_doc: "",
    Zone: "",
    Groupe: "",
    Ligne_planning: "",
    Indice: "",
    Duree_1: 0,
    Duree_2: 0,
    Duree_3: 0,
    Date_limite: null,
    Diff_coffrage: null,
    Diff_armature: null,
    Demarrages_travaux: null,
    Retards: 0,
    Realise: 0,
    Date_Realise: null,
    Date_Cloture: null,
    Remarque: "",
    ...fields,
  };
}

const formwork = (id, number, name, zone, group, start, end, fields = {}) => structureRow(id, {
  ID2: number, Taches: name, Type_doc: "COFFRAGE", Zone: zone, Groupe: group, Indice: "A",
  Date_limite: start, Duree_1: 2, Diff_coffrage: end, Realise: 67, ...fields,
});

const rebar = (id, number, name, zone, group, start, end, works, fields = {}) => structureRow(id, {
  ID2: number, Taches: name, Type_doc: "ARMATURES", Zone: zone, Groupe: group, Ligne_planning: "900",
  Diff_coffrage: start, Duree_2: 2, Diff_armature: end, Duree_3: 4, Demarrages_travaux: works, ...fields,
});

export function structureRows() {
  return [
    structureRow(1, { Zone: ZONE_1 }),
    structureRow(2, { Zone: ZONE_2 }),
    formwork(101, "3031", "PH REZ DE CHAUSSEE - COF", ZONE_1, "4", "2027-03-03", "2027-03-17"),
    rebar(102, "3216", "PH REZ DE CHAUSSEE - VOILES", ZONE_1, "4", "2027-03-17", "2027-03-31", "2027-04-28"),
    formwork(111, "3012", "PBAS 1er SOUS-SOL - COF", ZONE_2, "11", "2026-10-05", "2026-10-19"),
    formwork(112, "3022", "PH 1er SOUS-SOL - COF", ZONE_2, "12", "2026-10-29", "2026-11-12"),
    formwork(113, "3032", "PH REZ DE CHAUSSEE - COF", ZONE_2, "13", "2026-08-19", "2026-09-02", { Retards: 37 }),
    rebar(121, "3306", "CARNEAUX + DALLES BASSES", ZONE_2, "11", "2026-10-19", "2026-11-02", "2026-11-30"),
    rebar(122, "3310", "PH 1er SOUS-SOL - DALLES", ZONE_2, "12", "2026-11-12", "2026-11-26", "2026-12-24"),
    rebar(123, "3314", "PH REZ DE CHAUSSEE - DALLES", ZONE_2, "13", "2026-09-02", "2026-09-16", "2026-10-14", { Retards: 23 }),
    structureRow(131, {
      ID2: "3820", Taches: "BAT B - ASCENSEURS 1-2 FILE 3", Type_doc: "COUPES", Zone: ZONE_2, Ligne_planning: "832",
      Date_limite: "2027-02-23", Duree_1: 2, Diff_coffrage: "2027-03-09", Duree_3: 6, Demarrages_travaux: "2027-04-20",
    }),
    structureRow(141, { ID2: "3999", Taches: "Note d'hypothèses générales", Type_doc: "NDC", Indice: "0", Realise: 100 }),
    structureRow(142, { ID2: "3724", Taches: "GRUE ARM", Type_doc: "ARMATURES", Zone: ZONE_2, Indice: "A", Realise: 100, Retards: 8 }),
  ];
}

// Un étage du modèle, au service Synthese, sans la ligne de zone de l'aide (id 10).
function floorRows({ zoneName, floorName, firstId, link }) {
  return datedRows({ zoneName, floorName, firstId })
    .filter((row) => row.id !== 10)
    .map((row) => ({
      ...row,
      NomProjet: PROJECT,
      Service: "Synthese",
      Lien_Structure: row.id === firstId ? link : "",
      Controle_Coffrage: false,
    }));
}

export function syntheseRows() {
  const plain = {
    NomProjet: PROJECT, Service: "Synthese", Type_doc: "", ID2: "", Groupe: "", Etage: false, Nature: "", Parent: "",
    Lien: "", Lien_Structure: "", Controle_Coffrage: false, Diff_coffrage: null, Diff_armature: null, Duree_1: 0,
  };
  const rdc = floorRows({ zoneName: ZONE_2, floorName: "RDC", firstId: 400, link: "3032" });
  // La tâche contrôlée choisie de RDC : « PLAN DE SYNTHESE RESEAUX NIV RDC » du cycle 3.
  Object.assign(rdc.find((row) => row.id === 420), { Controle_Coffrage: true, Diff_armature: "2026-11-30", Duree_1: 200 });
  return [
    ...floorRows({ zoneName: ZONE_1, floorName: "SS1", firstId: 200, link: "3031" }),
    ...floorRows({ zoneName: ZONE_2, floorName: "SS1", firstId: 300, link: "3022" }),
    ...rdc,
    { ...plain, id: 500, Taches: "R+1", Zone: ZONE_2, Etage: true },
    { ...plain, id: 501, Taches: "Visa MOE", Zone: ZONE_2, Groupe: "R+1", Diff_coffrage: "2026-10-12", Diff_armature: "2026-10-16", Duree_1: 5 },
    { ...plain, id: 600, Taches: "Réunion de lancement", Zone: ZONE_2, Diff_coffrage: "2025-12-01", Diff_armature: "2025-12-01", Duree_1: 0 },
  ];
}

// Planning_Projet du projet, tous services : Structure, Synthèse, et ce que la vue ignore.
export function projectRows() {
  return [
    ...structureRows(),
    ...syntheseRows(),
    structureRow(901, { Service: "Topographie", ID2: "7001", Taches: "Implantation", Type_doc: "COUPES", Zone: ZONE_2 }),
    { id: 902, NomProjet: PROJECT, Service: "Synthese", Taches: "Segment v1", Type_doc: "SYNTHESE", Zone: "", Diff_coffrage: "2026-09-17", Diff_armature: "2026-09-18" },
  ];
}

export function planRows() {
  const plan = (number, date) => ({ Type_document: "COFFRAGE", NumeroDocument: number, Indice: "Prev 0", DateDiffusion: date, Service: "Structure" });
  return [plan("3022", "2026-01-02"), plan("3031", "2025-11-27")];
}
