// Lignes Planning_Projet de l'étage SS1 de la zone « Zone 1 / BAT BC » du projet ERA QUAI
// D'ORSAY, tirées de l'export de l'utilisateur du 20/10/2026 (les ids sont déduits de Parent et
// Lien). Un cycle (CYCLE 2, CYCLE 3) y contient un sous-groupe « PLAN SYT … ».
export const ERA_PROJECT = "ERA QUAI D'ORSAY";
export const ERA_ZONE = "Zone 1 / BAT BC";
export const ERA_ZONE_KEY = "zone1batbc";

// [id, Taches, Nature, Parent, Lien, Duree_1, Diff_coffrage, Diff_armature, Ordre]
const ERA_LINES = [
  [984, "RECEPTION ARCH/TOPO/STR", "", "", "", 0, "2025-11-14", "2025-11-14", ""],
  [985, "CYCLE 1", "Cycle", "", "", 0, null, null, ""],
  [986, "FOND DE PLAN DE SYNTHESE NIV SS1", "", "985", "984 DD", 2, "2025-11-14", "2025-11-17", 1],
  [987, "DIFFUSION FDS Indice 0", "", "985", "986 FD", 0, "2025-11-17", "2025-11-17", 2],
  [988, "RECEPTION RENDU CET RESEAUX (GED)", "", "985", "987 FD", 10, "2025-11-18", "2025-12-01", 3],
  [989, "VISA Indice 0", "", "985", "1061 FD", 10, "2025-12-03", "2025-12-16", 5],
  [990, "PLAN DE SYNTHESE RESEAUX NIV SS1", "", "985", "988 FD", 5, "2025-12-02", "2025-12-08", 6],
  [991, "REUNION + DIFFUSION SYT RSX Indice 0", "Reunion", "985", "990 FD", 0, "2025-12-08", "2025-12-08", 7],
  [992, "CYCLE 2", "Cycle", "", "", 0, null, null, ""],
  [993, "RECEPTION RENDU CET RSX RESA TER", "", "992", "991 FD", 5, "2025-12-09", "2025-12-15", ""],
  [994, "PLAN SYT CYCLE 2", "Sous-groupe", "992", "", 0, null, null, ""],
  [995, "PLAN DE SYNTHESE RESEAUX NIV SS1", "", "994", "993 FD", 5, "2025-12-16", "2025-12-22", 1],
  [996, "PLAN DE SYNTHESE RESERVATIONS NIV SS1", "", "994", "995 FF", 2, "2025-12-19", "2025-12-22", 2],
  [997, "PLAN DE SYNTHESE TERMINAUX NIV SS1", "", "994", "995 FF", 2, "2025-12-19", "2025-12-22", 4],
  [998, "REUNION + DIFFUSION SYT", "Reunion", "992", "995 FD", 0, "2025-12-22", "2025-12-22", ""],
  [999, "CYCLE 3", "Cycle", "", "", 0, null, null, ""],
  [1000, "RECEPTION RENDU CET RSX RESA TER", "", "999", "998 FD", 5, "2025-12-23", "2025-12-30", ""],
  [1001, "VISA Indice A", "", "999", "1000 FD", 10, "2025-12-31", "2026-01-14", ""],
  [1002, "PLAN SYT CYCLE 3", "Sous-groupe", "999", "", 0, null, null, ""],
  [1003, "PLAN DE SYNTHESE RESEAUX NIV SS1", "", "1002", "1000 FD", 5, "2025-12-31", "2026-01-07", ""],
  [1004, "PLAN DE SYNTHESE RESERVATIONS NIV SS1", "", "1002", "1003 FF", 2, "2026-01-06", "2026-01-07", ""],
  [1005, "PLAN DE SYNTHESE TERMINAUX NIV SS1", "", "1002", "1003 FF", 2, "2026-01-06", "2026-01-07", ""],
  [1006, "REUNION + DIFFUSION SYT", "Reunion", "999", "1003 FD", 0, "2026-01-07", "2026-01-07", ""],
  [1007, "SIGNATURE PLANS SYNTHESE", "", "999", "1001 FD+5", 0, "2026-01-21", "2026-01-21", ""],
  [1008, "DEMARRAGE GO SS1 (date prévisionnelle)", "Demarrage", "999", "1007 FD", 0, "2026-01-21", "2026-01-21", ""],
  [1061, "test", "", "985", "988 FD", 1, "2025-12-02", "2025-12-02", 4],
];

function eraRow(fields) {
  return {
    NomProjet: ERA_PROJECT,
    Zone: ERA_ZONE,
    Service: "Synthese",
    Type_doc: "",
    ID2: "",
    Indice: "",
    Lien_Structure: "",
    Controle_Coffrage: false,
    Etage: false,
    ...fields,
  };
}

export function eraSs1Rows() {
  return [
    eraRow({
      id: 983, Taches: "SS1", Etage: true, Lien_Structure: "3021", Groupe: "", Nature: "", Parent: "",
      Lien: "", Duree_1: 0, Diff_coffrage: null, Diff_armature: null, Ordre: "",
    }),
    ...ERA_LINES.map(([id, name, nature, parent, link, days, start, end, order]) => eraRow({
      id, Taches: name, Groupe: "SS1", Nature: nature, Parent: parent, Lien: link, Duree_1: days,
      Diff_coffrage: start, Diff_armature: end, Ordre: order,
    })),
  ];
}
