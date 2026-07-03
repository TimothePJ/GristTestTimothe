// Dev-only fixtures for dev/harness.html (mock Grist). Not shipped to production.
// TimeSegment (previsionnel) and Planning_Projet dates deliberately OVERLAP in 2027 so the
// shared frise shows both panes populated within the TimeSegment-derived bounds — mirroring
// how a real project's resource plan and task deadlines occupy the same period.

// Project 3 has MORE than 16 tasks (deliberately) to exercise the top pane's
// 16-row visible ceiling + internal vertical scroll (sticky frise). A long task
// name is included to exercise single-line truncation (ellipsis + title tooltip).
const MANY_TASK_NUMBER = "999999";
const MANY_TASK_ROWS = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  const limite = new Date(Date.UTC(2027, 1, 3 + i * 3)); // 03/02/2027 + 3 days each
  const coffrage = new Date(limite.getTime() + 10 * 24 * 3600 * 1000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    id: 1000 + n,
    NomProjet: "TEST SCROLL 20 TACHES",
    Taches:
      n === 1
        ? "TACHE 01 AVEC UN NOM VOLONTAIREMENT TRES TRES LONG POUR TESTER LA TRONCATURE ELLIPSIS ET LE TOOLTIP"
        : `TACHE ${String(n).padStart(2, "0")}`,
    Type_doc: "COFFRAGE",
    Ligne_planning: String(n),
    Zone: "Z01",
    Date_limite: iso(limite),
    Diff_coffrage: iso(coffrage),
  };
});

// Project 4: the SAME task name ("FONDATIONS - COF", "PH RDC - COF") repeated
// across two zones with empty Ligne_planning — exactly the real-data shape that
// used to wrongly merge into single rows. Each record has a distinct ID2, so the
// per-record grouping must keep them as separate rows (see top/phases.js).
const HOMONYM_NUMBER = "444444";
const HOMONYM_ROWS = [
  // Past-dated + realisé -> phase-past band (state rendering, exactly like Planning Projet).
  { id: 4000, NomProjet: "TEST ZONES HOMONYMES", ID2: "3000", Groupe: "1", Zone: "Zone 1 / BAT BC", Taches: "SEMELLES (réalisé)", Type_doc: "COFFRAGE", Date_limite: "2026-02-01", Diff_coffrage: "2026-03-01", Indice: "B", Realise: "100" },
  { id: 4001, NomProjet: "TEST ZONES HOMONYMES", ID2: "3001", Groupe: "1", Zone: "Zone 1 / BAT BC", Taches: "FONDATIONS - COF", Type_doc: "COFFRAGE", Date_limite: "2027-02-01", Diff_coffrage: "2027-02-15", Indice: "A", Realise: "100" },
  // Retard -> red inline style on the band.
  { id: 4002, NomProjet: "TEST ZONES HOMONYMES", ID2: "3031", Groupe: "4", Zone: "Zone 1 / BAT BC", Taches: "PH RDC - COF", Type_doc: "COFFRAGE", Date_limite: "2027-03-01", Diff_coffrage: "2027-03-15", Indice: "0", Realise: "50", Retards: "30" },
  { id: 4003, NomProjet: "TEST ZONES HOMONYMES", ID2: "3002", Groupe: "1", Zone: "Zone 2 / BAT B", Taches: "FONDATIONS - COF", Type_doc: "ARMATURES", Diff_coffrage: "2027-02-10", Diff_armature: "2027-02-24", Demarrages_travaux: "2027-03-15" },
  { id: 4004, NomProjet: "TEST ZONES HOMONYMES", ID2: "3032", Groupe: "4", Zone: "Zone 2 / BAT B", Taches: "PH RDC - COF", Type_doc: "COFFRAGE", Date_limite: "2027-03-10", Diff_coffrage: "2027-03-24", Demarrages_travaux: "2027-03-28" },
  // Phase FAR outside the TimeSegment window (ends 2027-04): the frise must widen
  // to cover it (union bounds) so this row is visible/scrollable.
  { id: 4005, NomProjet: "TEST ZONES HOMONYMES", ID2: "3080", Groupe: "9", Zone: "Zone 2 / BAT B", Taches: "PH R+5 - COF (2028)", Type_doc: "COFFRAGE", Date_limite: "2028-06-01", Diff_coffrage: "2028-06-15" },
];

export const FIXTURE_TABLES = {
  Projets2: [
    { id: 1, Nom_de_projet: "ERA QUAI D'ORSAY", Numero_de_projet: "252035", Avancement: '[{"typeDocument":"COFFRAGE","indice":"B"},{"typeDocument":"ARMATURES","indice":"0"}]' },
    { id: 2, Nom_de_projet: "HOTEL DIEU", Numero_de_projet: "12345" }, // no TimeSegment -> empty-state demo
    { id: 3, Nom_de_projet: "TEST SCROLL 20 TACHES", Numero_de_projet: MANY_TASK_NUMBER }, // >16 tasks -> scroll demo
    { id: 4, Nom_de_projet: "TEST ZONES HOMONYMES", Numero_de_projet: HOMONYM_NUMBER }, // homonym tasks across zones
  ],
  Planning_Projet: [
    // Mixed date formats (FR + ISO) on purpose to exercise the robust parser.
    { id: 1, NomProjet: "ERA QUAI D'ORSAY", Taches: "FONDATIONS", Type_doc: "COFFRAGE", Ligne_planning: "1", Zone: "Z01", Date_limite: "02/02/2027", Diff_coffrage: "2027-03-16", Diff_armature: "2027-04-01", Demarrages_travaux: "2027-05-01" },
    { id: 2, NomProjet: "ERA QUAI D'ORSAY", Taches: "LONGRINES", Type_doc: "ARMATURES", Ligne_planning: "2", Zone: "Z01", Date_limite: "2027-02-10", Diff_coffrage: "2027-03-20", Diff_armature: "2027-04-05" },
    { id: 3, NomProjet: "ERA QUAI D'ORSAY", Taches: "PH 1er SOUS-SOL - VOILES", Type_doc: "COFFRAGE", Ligne_planning: "3", Zone: "Z01", Date_limite: "20/02/2027", Diff_coffrage: "2027-04-10", Diff_armature: "2027-04-25", Demarrages_travaux: "2027-05-10" },
    { id: 4, NomProjet: "ERA QUAI D'ORSAY", Taches: "RSO", Type_doc: "NDC", Ligne_planning: "4", Zone: "Z01", Date_limite: "2027-03-01", Diff_coffrage: "2027-03-25" },
    { id: 5, NomProjet: "ERA QUAI D'ORSAY", Taches: "", Type_doc: "", Zone: "Z02" }, // zone-only header -> excluded
    ...MANY_TASK_ROWS,
    ...HOMONYM_ROWS,
  ],
  TimeSegment: [
    { id: 1, NumeroProjet: "252035", Name: "Fouzia Raggui", Start_At: "02/02/2027 08:00", End_At: "26/02/2027 17:00", Allocation_Days: "18", Effectif: "1", Label: "" },
    { id: 2, NumeroProjet: "252035", Name: "Guillaume Sadot", Start_At: "01/03/2027 08:00", End_At: "28/05/2027 17:00", Allocation_Days: "40,5", Effectif: "1", Label: "" },
    { id: 3, NumeroProjet: "252035", Name: "BA INGENERIE", Start_At: "15/02/2027 08:00", End_At: "15/04/2027 17:00", Allocation_Days: "30", Effectif: "2", Label: "" },
    { id: 4, NumeroProjet: "252035", Name: "Laurent Orven", Start_At: "01/04/2027 08:00", End_At: "30/05/2027 17:00", Allocation_Days: "22", Effectif: "1", Label: "" },
    // Project 3 (many tasks): two segments spanning the generated phase dates so
    // the frise bounds cover them.
    { id: 5, NumeroProjet: MANY_TASK_NUMBER, Name: "Equipe Etudes", Start_At: "01/01/2026 08:00", End_At: "31/12/2027 17:00", Allocation_Days: "120", Effectif: "3", Label: "" },
    { id: 6, NumeroProjet: MANY_TASK_NUMBER, Name: "BE Externe", Start_At: "15/02/2027 08:00", End_At: "30/06/2027 17:00", Allocation_Days: "80", Effectif: "2", Label: "" },
    // Project 4 (homonym zones): span from early 2026 so the past-dated (réalisé)
    // task falls inside the frise window and its phase-past band is visible.
    { id: 7, NumeroProjet: HOMONYM_NUMBER, Name: "Equipe Zones", Start_At: "01/01/2026 08:00", End_At: "01/04/2027 17:00", Allocation_Days: "40", Effectif: "2", Label: "" },
  ],
  ProjectTeam: [
    { id: 1, NumeroProjet: "252035", Name: "Fouzia Raggui", Role: "Projeteur", Daily_Rate: 0 },
    { id: 2, NumeroProjet: "252035", Name: "Guillaume Sadot", Role: "Ingenieur", Daily_Rate: 0 },
    { id: 3, NumeroProjet: "252035", Name: "BA INGENERIE", Role: "Sous-traitant", Daily_Rate: 0 },
    { id: 4, NumeroProjet: "252035", Name: "Laurent Orven", Role: "Ingenieur", Daily_Rate: 0 },
    { id: 8, NumeroProjet: "252035", Name: "Membre Sans Segment", Role: "Ingenieur", Daily_Rate: 0 }, // no TimeSegment -> must still appear
    { id: 5, NumeroProjet: MANY_TASK_NUMBER, Name: "Equipe Etudes", Role: "Projeteur", Daily_Rate: 0 },
    { id: 6, NumeroProjet: MANY_TASK_NUMBER, Name: "BE Externe", Role: "Sous-traitant", Daily_Rate: 0 },
    { id: 7, NumeroProjet: HOMONYM_NUMBER, Name: "Equipe Zones", Role: "Projeteur", Daily_Rate: 0 },
  ],
  // "Données d'entrées" (reception) references, linked to planning rows by
  // NomProjet + NumeroDocument(=ID2) + Type_document + NomDocument(=Taches) + Zone.
  // Two blocking refs on row 4001 (FONDATIONS - COF, Zone 1): one received, one
  // not -> "mixed" band. One blocking ref on row 4004 -> "missing" band.
  References2: [
    { id: 1, NomProjet: "TEST ZONES HOMONYMES", NumeroDocument: "3001", Type_document: "COFFRAGE", NomDocument: "FONDATIONS - COF", Zone: "Zone 1 / BAT BC", Bloquant: true, DureeLimite: "2", Recu: "", Emetteur: "BET", Reference: "PLA-330-A" },
    { id: 2, NomProjet: "TEST ZONES HOMONYMES", NumeroDocument: "3001", Type_document: "COFFRAGE", NomDocument: "FONDATIONS - COF", Zone: "Zone 1 / BAT BC", Bloquant: true, DureeLimite: "3", Recu: "15/01/2027", Emetteur: "Archi", Reference: "PLA-330-B" },
    { id: 3, NomProjet: "TEST ZONES HOMONYMES", NumeroDocument: "3032", Type_document: "COFFRAGE", NomDocument: "PH RDC - COF", Zone: "Zone 2 / BAT B", Bloquant: true, DureeLimite: "2", Recu: "", Emetteur: "BET", Reference: "PLA-331-A" },
  ],
};
