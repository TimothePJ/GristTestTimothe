// Table des indices de référence des projets : l'indice auquel un document est réalisé à
// 100 %, par type de document. Elle vient de la configuration d'avancement de chaque projet,
// qui est tenue par service : une table n'est juste que pour le service pour lequel elle a été
// construite. Elle est donc refaite quand le service affiché change, et quand les
// configurations sont relues — jamais gardée d'un service à l'autre.
// Dépendances injectées (construction de la table, service affiché) : doublures en test.
export function createRealisationTargetCache({ build, getService }) {
  let configs = [];
  let lookup = null;
  let builtFor = null;

  return {
    // Configurations d'avancement relues dans Grist : la table est à refaire.
    setConfigs(nextConfigs) {
      configs = Array.isArray(nextConfigs) ? nextConfigs : [];
      lookup = null;
    },
    // La table du service affiché à l'instant de l'appel. Tant que le contexte ne connaît pas
    // encore le service, `build` reçoit `undefined` et applique son service par défaut.
    get() {
      const service = String(getService?.() ?? "");
      if (!lookup || service !== builtFor) {
        lookup = build(configs, service || undefined);
        builtFor = service;
      }
      return lookup;
    },
  };
}
