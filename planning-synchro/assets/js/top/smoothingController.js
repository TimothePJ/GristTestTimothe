// Controleur du lissage des taches de planning-synchro (spec 2026-10-23, §5.2 a
// §5.4, §6.1 et §6.5).
//
// Cree UNE SEULE FOIS par main.js : il tient l'etat du lissage (taches, cellule
// `Projets2.Lissage`, reglages du service courant, resultat, mode d'affichage)
// HORS du cycle de chargement par projet, pour que les fenetres « Lissage » et
// « Taches du mois » survivent au rechargement du MEME projet (§6.5).
//
// Il porte l'en-tete du graphique (groupe « Afficher » + bouton « Lisser… »),
// cree les deux fenetres, recalcule smoothTasks a chaque setProjectData,
// enregistrement ou refreshFromProjectRows, et ecrit la cellule Lissage (une
// seule action, relue juste avant d'ecrire : ruling 10).

import { APP_CONFIG } from "../config.js";
import { loadSmoothingView, persistSmoothingView } from "../state.js";
import { createMonthTasksModal as defaultCreateMonthTasksModal, buildBucketTaskList } from "./monthTasksModal.js";
import { createSmoothingModal as defaultCreateSmoothingModal } from "./smoothingModal.js";
import { getServiceSettings, hasAnyMax, serializeSmoothingCell } from "./smoothingSettings.js";
import { TYPE_ORDER } from "./taskLabels.js";
import { monthKeyOf, smoothTasks } from "./taskSmoothing.js";

const NO_COLUMN_TITLE = "Ajoutez une colonne texte « Lissage » dans Projets2 pour activer le lissage.";
const READ_FAILED_TITLE = "Lecture de Projets2 impossible : rechargez le projet.";
const NO_TASK_TITLE = "Aucune tâche à lisser";
const SAVE_ERROR = "L'enregistrement du lissage a échoué. Réessayez.";
const BUSY_ERROR = "Un enregistrement du lissage est déjà en cours.";
const READ_FAILED_SAVE_ERROR = "Lecture de Projets2 impossible : l'enregistrement est annulé. Réessayez.";
const SERVICE_CHANGED_ERROR = "Le service a changé : fermez la fenêtre et recommencez.";

const VIEWS = ["raw", "smoothed", "both"];

function lissageColumn() {
  return APP_CONFIG.grist.columns.projects.lissage;
}

// Types presents dans les taches, dans l'ordre d'affichage des series.
function presentTypesOf(tasks) {
  const present = new Set((tasks || []).map((task) => task.type));
  return TYPE_ORDER.filter((type) => present.has(type));
}

// Valeur de la cellule sous forme de texte comparable ("" si vide).
function cellText(value) {
  return value == null ? "" : String(value);
}

// els = { displayGroup, openButton, smoothingModalEl, monthTasksModalEl } ; un
// element absent (index.html en cache sans les nouveaux blocs) est tolere.
// saveCell(projectId, value) -> Promise<void> ; loadProjectRow(projectId) ->
// Promise<object|null> (relecture de la ligne Projets2 avant d'ecrire).
// setProjectData({ projectRow }) : la ligne Projets2 du projet, ou null quand
// elle n'a pas pu etre lue (« lecture impossible », distincte de « colonne
// absente », qui est une ligne lue sans la colonne Lissage).
export function createSmoothingController({
  els,
  saveCell,
  loadProjectRow,
  getService,
  isReadOnly,
  todayIso,
  onChange,
  createSmoothingModal = defaultCreateSmoothingModal,
  createMonthTasksModal = defaultCreateMonthTasksModal,
} = {}) {
  const { displayGroup, openButton, smoothingModalEl, monthTasksModalEl } = els || {};

  // --- etat (hors du cycle par projet) ---
  let mode = loadSmoothingView();
  let contextKey = null;
  let project = null;
  let tasks = [];
  let hasColumn = false;
  let rawCell = "";
  // La ligne Projets2 du contexte courant a-t-elle deja ete lue au moins une
  // fois ? Sinon rawCell ne vaut rien : une ecriture qui en repartirait
  // effacerait les entrees des autres services.
  let rowKnown = false;
  // Derniere lecture de Projets2 impossible, sans rien de connu pour ce
  // contexte : bouton grise avec READ_FAILED_TITLE.
  let rowUnreadable = false;
  let settings = { maxTotal: null, maxByType: {} };
  // Service dont `settings` porte les reglages (celui du dernier recompute) :
  // entre un changement de service et la fin du loadProject qui suit, il
  // differe encore du service courant.
  let settingsService = null;
  let result = null; // dernier smoothTasks(), ou null sans taches
  let lastBucket = null; // dernier seau ouvert dans « Taches du mois »
  let saving = false; // verrou : une seule ecriture a la fois
  // Service fige a l'ouverture de la fenetre « Lissage » (ruling 16) : la
  // fenetre ne se ferme qu'a la fin du loadProject declenche par un changement
  // de service, et sa saisie appartient au service d'origine. null tant que la
  // fenetre n'a pas ete ouverte dans ce contexte.
  let openedService = null;

  const service = () => (typeof getService === "function" ? getService() : "");
  const today = () => todayIso();
  const notify = () => {
    if (typeof onChange === "function") onChange();
  };

  const smoothingModal = createSmoothingModal(smoothingModalEl, {
    compute: (nextSettings) => smoothTasks(tasks, nextSettings, today()),
    onSubmit: (nextSettings) => saveSettings(nextSettings),
    onDelete: () => saveSettings({ maxTotal: null, maxByType: {} }),
  });
  const monthModal = createMonthTasksModal(monthTasksModalEl);

  const isActive = () => Boolean(result && result.active);

  // --- calcul ---
  function recompute() {
    settingsService = service();
    settings = hasColumn ? getServiceSettings(rawCell, settingsService) : { maxTotal: null, maxByType: {} };
    result = tasks.length ? smoothTasks(tasks, settings, today()) : null;
  }

  // --- en-tete ---
  function renderHeader() {
    if (openButton) {
      let title = "";
      if (rowUnreadable) title = READ_FAILED_TITLE;
      else if (!hasColumn) title = NO_COLUMN_TITLE;
      else if (!tasks.length) title = NO_TASK_TITLE;
      openButton.disabled = Boolean(title);
      openButton.title = title;
      openButton.classList.toggle("is-active", isActive());
    }
    if (displayGroup) {
      displayGroup.hidden = !isActive();
      Array.from(displayGroup.querySelectorAll("[data-smoothing-view]")).forEach((button) => {
        const on = button.dataset.smoothingView === mode;
        button.classList.toggle("is-active", on);
        button.setAttribute("aria-pressed", String(on));
      });
    }
  }

  // --- fenetres ---
  function monthModel() {
    if (!lastBucket) return null;
    return buildBucketTaskList({
      result: result || { active: false, tasks: [], movedCount: 0, overflows: [] },
      mode: isActive() ? mode : "raw",
      bucket: lastBucket,
      visibleTypeKeys: lastBucket.visibleTypeKeys || [],
      settings,
    });
  }

  function updateMonthModal() {
    if (!monthModal.isOpen()) return;
    const model = monthModel();
    if (model) monthModal.update(model);
  }

  // « Lissage des tâches — <Projet> · <Service> » (§6.2), repli sur le titre seul.
  // Le service nomme est celui des reglages affiches.
  function titleText() {
    const parts = [project?.name, settingsService ?? service()].filter(Boolean).join(" · ");
    return parts ? `Lissage des tâches — ${parts}` : "Lissage des tâches";
  }

  function smoothingContext() {
    return {
      title: titleText(),
      typesPresent: presentTypesOf(tasks),
      tasks,
      todayIso: today(),
      settings,
      saved: hasAnyMax(settings),
      readOnly: typeof isReadOnly === "function" ? Boolean(isReadOnly()) : false,
    };
  }

  // Ouvre (ou rouvre) la fenetre « Lissage » et y fige le service de ses
  // reglages (ruling 16). C'est le service courant, sauf si celui-ci vient de
  // changer et que le rechargement n'a pas encore suivi : la fenetre montre
  // alors les reglages de l'ancien service, et l'enregistrement sera refuse.
  function openSmoothingWindow() {
    openedService = settingsService ?? service();
    smoothingModal.open(smoothingContext());
  }

  function openSmoothing() {
    if (!openButton || openButton.disabled) return;
    openSmoothingWindow();
  }

  function closeWindows() {
    smoothingModal.close();
    monthModal.close();
    lastBucket = null;
    openedService = null;
  }

  // --- ecriture ---
  // Relit la cellule fraiche (ruling 10) puis ecrit une seule action sur la
  // colonne Lissage. Sur succes : etat local mis a jour tout de suite, mode
  // « Les deux » memorise, graphique redessine par onChange.
  // NB : un rechargement du projet livre APRES l'ecriture peut encore porter
  // l'ancienne cellule Lissage (lecture perimee) ; non traite ici.
  async function saveSettings(nextSettings) {
    const target = project;
    if (!target) return { ok: false, error: SAVE_ERROR };
    // Ruling 16 : la saisie appartient au service fige a l'ouverture de la
    // fenetre ; s'il a change depuis, on n'ecrit rien (ni dans l'un ni dans
    // l'autre). Fenetre jamais ouverte : service courant.
    if (openedService != null && service() !== openedService) {
      return { ok: false, error: SERVICE_CHANGED_ERROR };
    }
    // Service fige AVANT la relecture : il peut encore changer pendant l'attente.
    const targetService = openedService ?? service();
    if (saving) return { ok: false, error: BUSY_ERROR };
    saving = true;
    try {
      return await writeSettings(target, targetService, nextSettings);
    } finally {
      saving = false;
    }
  }

  async function writeSettings(target, targetService, nextSettings) {
    // Derniere valeur connue, prise AVANT la relecture : un setProjectData
    // d'un autre projet peut arriver pendant l'attente.
    let base = rawCell;
    let baseKnown = rowKnown;
    if (typeof loadProjectRow === "function") {
      let fresh = null;
      try {
        fresh = await loadProjectRow(target.id);
      } catch (error) {
        console.warn("Lissage : relecture de la ligne Projets2 impossible.", error);
      }
      if (fresh) {
        baseKnown = true;
        if (Object.prototype.hasOwnProperty.call(fresh, lissageColumn())) base = fresh[lissageColumn()];
      }
    }
    // Relecture en echec et cellule jamais lue : repartir d'une cellule vide
    // effacerait les entrees des autres services. Sinon, derniere valeur connue.
    if (!baseKnown) return { ok: false, error: READ_FAILED_SAVE_ERROR };

    const value = serializeSmoothingCell(base, targetService, nextSettings);
    try {
      await saveCell(target.id, value);
    } catch (error) {
      console.warn("Lissage : échec de l'enregistrement.", error);
      return { ok: false, error: SAVE_ERROR };
    }

    // Le projet a change pendant l'ecriture : elle est faite, mais l'etat local
    // n'est plus celui de ce projet.
    if (project?.id !== target.id || service() !== targetService) return { ok: true };

    rawCell = value;
    rowKnown = true;
    rowUnreadable = false;
    recompute();
    // « Les deux » pour montrer l'effet, seulement si un maximum subsiste
    // (une suppression ne change pas le mode memorise).
    if (hasAnyMax(nextSettings)) {
      mode = "both";
      persistSmoothingView(mode);
    }
    renderHeader();
    updateMonthModal();
    notify();
    return { ok: true };
  }

  // --- API ---
  // Nouvelles donnees du projet charge. Meme contextKey (meme projet, meme
  // service) : les fenetres restent ouvertes (§6.5) ; sinon elles sont fermees.
  function setProjectData(data = {}) {
    const sameContext = data.contextKey === contextKey;
    if (!sameContext) closeWindows();

    const previousTypes = presentTypesOf(tasks).join(",");
    contextKey = data.contextKey ?? null;
    project = data.project || null;
    tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const row = data.projectRow || null;
    if (row) {
      hasColumn = Object.prototype.hasOwnProperty.call(row, lissageColumn());
      rawCell = hasColumn ? row[lissageColumn()] : "";
      rowKnown = true;
      rowUnreadable = false;
    } else if (!sameContext) {
      // Lecture impossible (erreur REST passagere, table rendue vide) et rien de
      // connu pour ce contexte : ce n'est PAS « colonne absente ».
      hasColumn = false;
      rawCell = "";
      rowKnown = false;
      rowUnreadable = true;
    }
    // Lecture impossible au rechargement du meme contexte : la colonne et la
    // cellule deja connues sont gardees, le lissage actif ne disparait pas.
    recompute();
    renderHeader();

    if (sameContext) {
      if (smoothingModal.isOpen()) {
        if (!saving && presentTypesOf(tasks).join(",") !== previousTypes) {
          // Cas rare, accepte : la saisie en cours est perdue.
          openSmoothingWindow();
        } else {
          smoothingModal.refresh({ tasks, todayIso: today() });
        }
      }
      updateMonthModal();
    }
  }

  // { tasks, mode, active } pour createPlanningChart().setChartInput.
  function getChartInput() {
    if (!isActive()) return { tasks, mode: "raw", active: false };
    return { tasks: result.tasks, mode, active: true };
  }

  // Mois couverts par les dates lissees, { startDate, endDate } du 1er jour du
  // premier mois au dernier jour du dernier ; null sans lissage actif. main.js
  // en elargit les bornes de la frise : un lissage qui avance des taches avant
  // le planning (mois de depart passe) doit pouvoir etre parcouru.
  function getSmoothedBounds() {
    if (!isActive()) return null;
    const months = result.tasks.map((task) => monthKeyOf(task.smoothedIso)).filter(Boolean).sort();
    if (!months.length) return null;
    const [year, month] = months.at(-1).split("-").map(Number);
    const lastDay = String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0");
    return { startDate: `${months[0]}-01`, endDate: `${months.at(-1)}-${lastDay}` };
  }

  // Clic sur le graphique (payload de planningChart.onBucketClick).
  function openMonthTasks(bucketInfo) {
    if (!bucketInfo) return;
    lastBucket = bucketInfo;
    const model = monthModel();
    if (model) monthModal.open(model);
  }

  // Lignes Projets2 relues (signal du catalogue) : redessine si la cellule a change.
  function refreshFromProjectRows(rows) {
    if (!project || !Array.isArray(rows)) return false;
    const row = rows.find((candidate) => candidate && candidate.id === project.id);
    if (!row) return false;
    if (!Object.prototype.hasOwnProperty.call(row, lissageColumn())) {
      // Ligne enfin lue apres une lecture impossible, sans la colonne : le
      // bouton passe de « rechargez le projet » a « colonne absente ».
      if (rowUnreadable) {
        rowKnown = true;
        rowUnreadable = false;
        renderHeader();
      }
      return false;
    }
    if (hasColumn && cellText(row[lissageColumn()]) === cellText(rawCell)) return false;
    hasColumn = true;
    rawCell = row[lissageColumn()];
    rowKnown = true;
    rowUnreadable = false;
    recompute();
    renderHeader();
    if (smoothingModal.isOpen()) smoothingModal.refresh({ tasks, todayIso: today() });
    updateMonthModal();
    notify();
    return true;
  }

  function clear() {
    closeWindows();
    contextKey = null;
    project = null;
    tasks = [];
    hasColumn = false;
    rawCell = "";
    rowKnown = false;
    rowUnreadable = false;
    settings = { maxTotal: null, maxByType: {} };
    settingsService = null;
    result = null;
    renderHeader();
  }

  // --- evenements ---
  function handleViewClick(event) {
    const target = event?.target;
    const button = typeof target?.closest === "function" ? target.closest("[data-smoothing-view]") : target;
    const next = button?.dataset?.smoothingView;
    if (!VIEWS.includes(next) || next === mode) return;
    mode = next;
    persistSmoothingView(mode);
    renderHeader();
    updateMonthModal();
    notify();
  }

  displayGroup?.addEventListener("click", handleViewClick);
  openButton?.addEventListener("click", openSmoothing);
  renderHeader();

  function destroy() {
    displayGroup?.removeEventListener("click", handleViewClick);
    openButton?.removeEventListener("click", openSmoothing);
    smoothingModal.destroy();
    monthModal.destroy();
  }

  return { setProjectData, getChartInput, getSmoothedBounds, openMonthTasks, refreshFromProjectRows, clear, destroy };
}
