// Dev-only fixtures for dev/harness.html (mock Grist). Not shipped to production.
// TimeSegment (previsionnel) and Planning_Projet dates deliberately OVERLAP in 2027 so the
// shared frise shows both panes populated within the TimeSegment-derived bounds — mirroring
// how a real project's resource plan and task deadlines occupy the same period.
export const FIXTURE_TABLES = {
  Projets2: [
    { id: 1, Nom_de_projet: "ERA QUAI D'ORSAY", Numero_de_projet: "252035" },
    { id: 2, Nom_de_projet: "HOTEL DIEU", Numero_de_projet: "12345" }, // no TimeSegment -> empty-state demo
  ],
  Planning_Projet: [
    // Mixed date formats (FR + ISO) on purpose to exercise the robust parser.
    { id: 1, NomProjet: "ERA QUAI D'ORSAY", Taches: "FONDATIONS", Type_doc: "COFFRAGE", Ligne_planning: "1", Zone: "Z01", Date_limite: "02/02/2027", Diff_coffrage: "2027-03-16", Diff_armature: "2027-04-01", Demarrages_travaux: "2027-05-01" },
    { id: 2, NomProjet: "ERA QUAI D'ORSAY", Taches: "LONGRINES", Type_doc: "ARMATURES", Ligne_planning: "2", Zone: "Z01", Date_limite: "2027-02-10", Diff_coffrage: "2027-03-20", Diff_armature: "2027-04-05" },
    { id: 3, NomProjet: "ERA QUAI D'ORSAY", Taches: "PH 1er SOUS-SOL - VOILES", Type_doc: "COFFRAGE", Ligne_planning: "3", Zone: "Z01", Date_limite: "20/02/2027", Diff_coffrage: "2027-04-10", Diff_armature: "2027-04-25", Demarrages_travaux: "2027-05-10" },
    { id: 4, NomProjet: "ERA QUAI D'ORSAY", Taches: "RSO", Type_doc: "NDC", Ligne_planning: "4", Zone: "Z01", Date_limite: "2027-03-01", Diff_coffrage: "2027-03-25" },
    { id: 5, NomProjet: "ERA QUAI D'ORSAY", Taches: "", Type_doc: "", Zone: "Z02" }, // zone-only header -> excluded
  ],
  TimeSegment: [
    { id: 1, NumeroProjet: "252035", Name: "Fouzia Raggui", Start_At: "02/02/2027 08:00", End_At: "26/02/2027 17:00", Allocation_Days: "18", Effectif: "1", Label: "" },
    { id: 2, NumeroProjet: "252035", Name: "Guillaume Sadot", Start_At: "01/03/2027 08:00", End_At: "28/05/2027 17:00", Allocation_Days: "40,5", Effectif: "1", Label: "" },
    { id: 3, NumeroProjet: "252035", Name: "BA INGENERIE", Start_At: "15/02/2027 08:00", End_At: "15/04/2027 17:00", Allocation_Days: "30", Effectif: "2", Label: "" },
    { id: 4, NumeroProjet: "252035", Name: "Laurent Orven", Start_At: "01/04/2027 08:00", End_At: "30/05/2027 17:00", Allocation_Days: "22", Effectif: "1", Label: "" },
  ],
  ProjectTeam: [
    { id: 1, NumeroProjet: "252035", Name: "Fouzia Raggui", Role: "Projeteur", Daily_Rate: 0 },
    { id: 2, NumeroProjet: "252035", Name: "Guillaume Sadot", Role: "Ingenieur", Daily_Rate: 0 },
    { id: 3, NumeroProjet: "252035", Name: "BA INGENERIE", Role: "Sous-traitant", Daily_Rate: 0 },
    { id: 4, NumeroProjet: "252035", Name: "Laurent Orven", Role: "Ingenieur", Daily_Rate: 0 },
  ],
};
