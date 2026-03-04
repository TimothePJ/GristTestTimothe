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
      enabled: true,
      sourceTable: "MsProject",
      columns: {
        id: "id",
        uniqueNumber: "Numero_Unique",
        indicator: "Indicateur",
        taskName: "Nom_Tache",
        duration: "Duree",
        start: "Debut",
        end: "Fin",
        team: "Equipe",
        subTeam: "Sous_Equipe",
        level: "Niveau",
        barStyle: "Style_Barre",
        effort: "Eff",
        projectLink: "NomProjet",
      },
      projectLinkCandidates: [
        "NomProjet",
        "Nom_Projet",
        "Projet",
        "Project",
        "Nom_de_projet",
      ],
    },
  },
};
