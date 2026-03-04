export const APP_CONFIG = {
  storageKey: "ms-project.selected-project",

  grist: {
    projectsTable: {
      sourceTable: "Projets",
      columns: {
        project: "Nom_de_projet",
      },
    },

    msProjectTable: {
      enabled: false,
      sourceTable: "MS_Project",
      columns: {
        id: "id",
        project: "NomProjet",
        taskName: "TaskName",
        taskNameAlt: "Tache",
        start: "StartDate",
        end: "EndDate",
        progress: "Progress",
        status: "Status",
      },
    },
  },
};
