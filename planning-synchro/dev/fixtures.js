export const FIXTURE_TABLES = {
  Projets2: [
    { id: 1, Nom_de_projet: "ERA QUAI D'ORSAY", Numero_de_projet: "252035" },
    { id: 2, Nom_de_projet: "HOTEL DIEU", Numero_de_projet: "12345" },
  ],
  Planning_Projet: [
    { id: 1, NomProjet: "ERA QUAI D'ORSAY", Taches: "FONDATIONS", Type_doc: "COFFRAGE", Ligne_planning: "1", Zone: "Z01", Date_limite: "02/02/2027", Diff_coffrage: "2027-03-16", Diff_armature: "2027-04-01", Demarrages_travaux: "2027-05-01" },
    { id: 2, NomProjet: "ERA QUAI D'ORSAY", Taches: "LONGRINES", Type_doc: "ARMATURES", Ligne_planning: "2", Zone: "Z01", Date_limite: "2027-02-10", Diff_coffrage: "2027-03-20", Diff_armature: "2027-04-05" },
    { id: 3, NomProjet: "ERA QUAI D'ORSAY", Taches: "", Type_doc: "", Zone: "Z02" }, // zone-only, excluded
  ],
  TimeSegment: [
    { id: 1, NumeroProjet: "252035", Name: "Fouzia Raggui", Start_At: "06/04/2026 08:00", End_At: "10/04/2026 17:00", Allocation_Days: "4,5", Effectif: "1", Label: "" },
    { id: 2, NumeroProjet: "252035", Name: "Guillaume Sadot", Start_At: "01/06/2026 08:00", End_At: "30/06/2026 17:00", Allocation_Days: "20", Effectif: "1", Label: "" },
  ],
  ProjectTeam: [
    { id: 1, NumeroProjet: "252035", Name: "Fouzia Raggui", Role: "Projeteur", Daily_Rate: 0 },
    { id: 2, NumeroProjet: "252035", Name: "Guillaume Sadot", Role: "Ingenieur", Daily_Rate: 0 },
  ],
};
