export const APP_CONFIG = {
  storageKey: "nouveau-projet.selected-project",

  grist: {
    projectsTable: {
      sourceTable: "Projets",
      columns: {
        project: "Nom_de_projet",
      },
    },

    planningTable: {
      sourceTable: "Planning_Projet", // ou "Planning projet" selon ton vrai nom exact
      columns: {
        id: "id",
        id2: "ID2",
        taches: "Taches",
        typeDoc: "Type_doc",
        lignePlanning: "Ligne_planning",
        dateLimite: "Date_limite",
        duree1: "Duree_1",
        diffCoffrage: "Diff_coffrage",
        duree2: "Duree_2",
        diffArmature: "Diff_armature",
        duree3: "Duree_3",
        demarragesTravaux: "Demarrages_travaux",
        retards: "Retards",
        indice: "Indice",
        realise: "Realise",
        projectLink: null
      }
    }
  },
};