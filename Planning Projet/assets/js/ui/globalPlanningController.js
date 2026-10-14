// Chef d'orchestre de la vue Global (Planning Projet) : lit Planning_Projet et la liste de
// plans du projet courant, tous services confondus, construit le planning fusionné et le
// redessine. Il ne fait que lire : aucune écriture dans Grist. Ses dépendances sont injectées
// (le contexte partagé, la lecture des deux tables, la fabrique du tableau, l'horloge) :
// doublures en test.
import { buildGlobalPlanning, buildGlobalRowModel } from "../services/globalPlanningModel.js";

const MESSAGES = Object.freeze({
  noProject: "Choisissez un projet pour afficher son planning global.",
  loading: "Chargement du planning global…",
  empty: "Aucune ligne de planning pour ce projet.",
  emptyZone: "Aucune ligne de planning dans cette zone.",
  noAlert: "Aucune alerte sur ce projet.",
  noAlertZone: "Aucune alerte dans cette zone.",
  readFailed: "Le planning global n'a pas pu être lu. Cliquez sur « Actualiser ».",
  refreshFailed: "La dernière relecture a échoué : les dates affichées peuvent être anciennes.",
});

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function toProjectKey(name) {
  return toText(name).replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

export function createGlobalPlanningController({
  context,
  createTable,
  // Lecture des deux tables du projet, tous services, et de ce que le planning Structure reçoit
  // pour dessiner ses barres : { projectRows, planRows, targetLookup, referenceLookup }.
  loadRows,
  now = () => new Date(),
} = {}) {
  let active = false;
  let bound = false;
  let zoneFilter = "";
  let planning = null;
  let loaded = false;
  let readError = false;
  let refreshError = false;
  let projectKey = "";
  let loadToken = 0;
  let alertsOnly = false;
  // Lignes basculées par l'utilisateur : par défaut les zones sont dépliées et le reste replié.
  const toggledKeys = new Set();
  // Dans « Alertes seulement », tout est déplié par défaut : ses bascules sont à part.
  const alertToggledKeys = new Set();

  const table = createTable({
    onToggle: (key) => toggle(key),
    onToggleAlertsOnly: () => toggleAlertsOnly(),
    onRefresh: () => {
      void load();
    },
  });

  function getProject() {
    return context?.getState?.().currentProject || null;
  }

  function currentProjectKey() {
    const project = getProject();
    return project ? toProjectKey(project.name) : "";
  }

  function render() {
    if (!active) return;
    let message = "";
    if (!getProject()) message = context?.getState?.().ready === false ? MESSAGES.loading : MESSAGES.noProject;
    else if (!loaded) message = MESSAGES.loading;
    else if (readError) message = MESSAGES.readFailed;
    if (message) {
      table.render([], { emptyMessage: message, alertsOnly });
      return;
    }
    try {
      const { lines, totals } = buildGlobalRowModel(planning, {
        zoneFilter,
        alertsOnly,
        toggledKeys: alertsOnly ? alertToggledKeys : toggledKeys,
      });
      let emptyMessage = "";
      if (!lines.length) {
        if (alertsOnly) emptyMessage = zoneFilter ? MESSAGES.noAlertZone : MESSAGES.noAlert;
        else emptyMessage = zoneFilter ? MESSAGES.emptyZone : MESSAGES.empty;
      }
      table.render(lines, {
        emptyMessage,
        totals,
        alertsOnly,
        notice: refreshError ? MESSAGES.refreshFailed : "",
      });
    } catch (error) {
      console.error("Affichage du planning global impossible :", error);
      table.render([], { emptyMessage: MESSAGES.readFailed, alertsOnly });
    }
  }

  async function load() {
    if (!active) return;
    const token = ++loadToken;
    const nextProjectKey = currentProjectKey();
    if (nextProjectKey !== projectKey) {
      projectKey = nextProjectKey;
      planning = null;
      loaded = false;
      readError = false;
      refreshError = false;
      toggledKeys.clear();
      alertToggledKeys.clear();
    }
    // Sans données à garder à l'écran : l'invite ou « Chargement… ».
    if (!nextProjectKey || !loaded) render();
    if (!nextProjectKey) return;
    let nextPlanning;
    try {
      const rows = await loadRows();
      if (token !== loadToken || !active) return;
      nextPlanning = buildGlobalPlanning({
        projectRows: rows?.projectRows,
        planRows: rows?.planRows,
        targetLookup: rows?.targetLookup,
        referenceLookup: rows?.referenceLookup,
        today: now(),
      });
    } catch (error) {
      if (token !== loadToken || !active) return;
      console.error("Lecture du planning global impossible :", error);
      // Des données sont déjà affichées : elles restent, avec un avertissement.
      if (loaded && !readError) refreshError = true;
      else {
        readError = true;
        loaded = true;
      }
      render();
      return;
    }
    planning = nextPlanning;
    loaded = true;
    readError = false;
    refreshError = false;
    render();
  }

  function toggle(key) {
    const keys = alertsOnly ? alertToggledKeys : toggledKeys;
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    render();
  }

  function toggleAlertsOnly() {
    alertsOnly = !alertsOnly;
    alertToggledKeys.clear();
    render();
  }

  function bind() {
    if (bound) return;
    bound = true;
    // Le contexte prévient aussi d'un changement de service, qui ne change rien ici : seule
    // l'arrivée d'un autre projet relance une lecture.
    context?.subscribe?.(() => {
      if (currentProjectKey() !== projectKey) void load();
    });
  }

  return {
    setActive(nextActive) {
      const wasActive = active;
      active = Boolean(nextActive);
      if (!active) {
        loadToken += 1;
        return;
      }
      // La lecture d'abord : elle fixe projectKey avant que l'abonné, appelé tout de suite par
      // le contexte prêt, ne voie un « changement de projet ».
      if (!wasActive) void load();
      bind();
    },
    setZoneFilter(zoneName) {
      const next = toText(zoneName);
      if (next === zoneFilter) return;
      zoneFilter = next;
      render();
    },
    // Appelée par la surveillance de tables de main.js et par « Actualiser ».
    refresh() {
      return load();
    },
  };
}
