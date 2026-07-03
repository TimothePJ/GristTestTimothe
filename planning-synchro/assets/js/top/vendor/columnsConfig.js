// Config shim for the vendored Planning Projet builder (planningProjetBuilder.js).
// The builder reads `APP_CONFIG.grist.planningTable.columns`; this exposes that
// exact shape with the real Grist column ids — copied from
// `Planning Projet/assets/js/config.js` so the vendored code runs unchanged.
export const APP_CONFIG = {
  grist: {
    projectsTable: {
      sourceTable: "Projets2",
      columns: { project: "Nom_de_projet", projectNumber: "Numero_de_projet", avancement: "Avancement" },
    },
    planningTable: {
      sourceTable: "Planning_Projet",
      columns: {
        id: "id", nomProjet: "NomProjet", id2: "ID2", taches: "Taches", tacheAlt: "Tache",
        groupe: "Groupe", zone: "Zone", typeDoc: "Type_doc", lignePlanning: "Ligne_planning",
        nomXml: "Nom_XML", dateLimite: "Date_limite", duree1: "Duree_1", diffCoffrage: "Diff_coffrage",
        duree2: "Duree_2", diffArmature: "Diff_armature", duree3: "Duree_3",
        demarragesTravaux: "Demarrages_travaux", retards: "Retards", remarque: "Remarque",
        indice: "Indice", realise: "Realise", dateRealise: "Date_Realise", projectLink: "NomProjet",
      },
    },
  },
};
