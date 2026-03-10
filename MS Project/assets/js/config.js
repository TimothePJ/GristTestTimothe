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
        sourceName: "Nom",
        duration: "Duree",
        start: "Debut",
        end: "Fin",
        team: "Equipe",
        subTeam: "Sous_Equipe",
        level: "Niveau",
        barStyle: "Style_Barre",
        title: "Titre",
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
      sourceNameCandidates: [
        "Nom",
      ],
    },

    planningSyncTable: {
      enabled: true,
      sourceTable: "Planning_Projet",
      columns: {
        id: "id",
        projectLink: "NomProjet",
        linePlanning: "Ligne_planning",
        demarragesTravaux: "Demarrages_travaux",
      },
      projectLinkCandidates: [
        "NomProjet",
        "Nom_Projet",
        "Projet",
        "Project",
        "Nom_de_projet",
      ],
      linePlanningCandidates: [
        "Ligne_planning",
        "LignePlanning",
      ],
      demarrageCandidates: [
        "Demarrages_travaux",
        "Demarrage_travaux",
        "DemarrageTravaux",
      ],
    },
  },
};
