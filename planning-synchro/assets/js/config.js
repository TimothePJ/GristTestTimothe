export const APP_CONFIG = {
  sharedProjectStorageKey: "grist.selected-project",
  sharedProjectIdStorageKey: "grist.selected-project-id",
  storageKey: "planning-synchro.state",
  initialWindowDays: 365,
  months: ["janvier","fevrier","mars","avril","mai","juin","juillet","aout","septembre","octobre","novembre","decembre"],
  zoomModes: {
    week:  { label: "Semaine", targetVisibleDays: 7 },
    month: { label: "Mois",    targetVisibleDays: 31 },
    year:  { label: "Annee",   targetVisibleDays: 365 },
  },
  // maxVisibleDays caps the widest window at ~14 months (14 * 30.4375 ≈ 426),
  // so the user is no longer limited to a single year and can zoom out further.
  viewport: { minVisibleDays: 7, maxVisibleDays: 426, referenceMonthDays: 30.4375 },
  // Top (planning) pane resizable visible-rows window (see top/paneMath.js and
  // ui/topPaneResizer.js): min 5 / max 16 visible rows, defaulting to 10 so the
  // editable bottom pane stays in view on load. `fallbackRowHeightPx`/
  // `fallbackAxisHeightPx` are only used before the vis-timeline has rendered
  // and can be measured.
  topPane: { minRows: 5, maxRows: 16, defaultRows: 10, fallbackRowHeightPx: 34, fallbackAxisHeightPx: 44 },
  grist: {
    tables: {
      projects: "Projets2",
      planningProject: "Planning_Projet",
      timeSegment: "TimeSegment",
      projectTeam: "ProjectTeam",
    },
    columns: {
      projects:  { id: "id", name: "Nom_de_projet", number: "Numero_de_projet", avancement: "Avancement" },
      planningProject: {
        id: "id", projectName: "NomProjet", id2: "ID2", taskName: "Taches", taskNameAlt: "Tache",
        typeDoc: "Type_doc", groupe: "Groupe", lignePlanning: "Ligne_planning", zone: "Zone",
        dateLimite: "Date_limite", duree1: "Duree_1", diffCoffrage: "Diff_coffrage",
        duree2: "Duree_2", diffArmature: "Diff_armature", duree3: "Duree_3",
        demarragesTravaux: "Demarrages_travaux", indice: "Indice", nomXml: "Nom_XML",
        realise: "Realise", retards: "Retards", dateRealise: "Date_Realise", remarque: "Remarque",
      },
      timeSegment: {
        id: "id", projectNumber: "NumeroProjet", name: "Name",
        startDate: "Start_At", endDate: "End_At",
        allocationDays: "Allocation_Days", effectif: "Effectif", label: "Label",
      },
      projectTeam: { id: "id", projectNumber: "NumeroProjet", role: "Role", name: "Name", dailyRate: "Daily_Rate" },
    },
  },
};
