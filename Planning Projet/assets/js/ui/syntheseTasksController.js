// Chef d'orchestre du tableau de tâches de la vue Synthese : charge les lignes
// Planning_Projet du projet et du service courants, se tient à jour, applique les
// saisies dans Grist et redessine le tableau. Ses dépendances sont injectées (le
// contexte partagé, l'API Grist, la fabrique du tableau, les minuteries) : doublures en
// test.
import {
  NO_ZONE_KEY,
  PLANNING_TABLE,
  TASK_COLUMNS,
  applyTaskEdit,
  buildFloorDeleteActions,
  buildFloorDeleteQuestion,
  buildFloorRenameActions,
  buildFloorRenameChanges,
  buildGroupDeleteActions,
  buildGroupDeleteQuestion,
  buildGroupRenameAction,
  buildRowModel,
  buildSections,
  dateFieldsOf,
  detectFloorColumn,
  detectFormworkCheckColumn,
  detectOrderColumn,
  detectStructureLinkColumn,
  detectTemplateColumns,
  findGroup,
  descendantGroups,
  floorCollapseKey,
  floorKeyOf,
  floorRemovalIds,
  groupCollapseKey,
  groupRemovalIds,
  moveTaskStart,
  nextFloorName,
  validateFloorName,
  validateGroupName,
} from "../services/syntheseTaskModel.js";
import {
  buildBulkAddAction,
  buildFloorFromTemplate,
  buildTemplateLinks,
} from "../services/syntheseFloorTemplate.js";
import { cascadeFrom } from "../services/syntheseLinks.js";
import { applyLineNumbers, lineNumbersOf, linkChoices, planLinkChange, previewLink } from "../services/syntheseLinkColumn.js";
import { createLinkDialog as createDefaultLinkDialog } from "./syntheseLinkDialog.js";
import { planCycleInsert, planCycleMove, planCycleRemoval } from "../services/syntheseCycles.js";
import {
  applyCycleModes,
  cycleModes,
  parallelPilot,
  planCycleMode,
  planParallelRealign,
  planParentsParallel,
} from "../services/syntheseCycleModes.js";
import {
  buildUpdateActions,
  mergeChanges,
  planInsertFollowUp,
  planOrphanLinks,
  planTaskInsert,
  planTaskMove,
  planTaskRemoval,
} from "../services/syntheseTaskOrder.js";
import {
  applyControlTasks,
  applyEndLimits,
  applyFloorLinks,
  controlTaskEndLimits,
  findFloorStart,
  readControlTasks,
  readFloorLinks,
} from "../services/structureLinkModel.js";

const SAVING_DELAY_MS = 1000;

// Saisies qui changent les dates : les tâches liées en aval suivent.
const DATE_FIELDS = new Set(["start", "end", "duration"]);

const MESSAGES = Object.freeze({
  noProject: "Choisissez un projet pour afficher ses tâches.",
  loading: "Chargement des tâches…",
  noZone: "Aucune zone pour ce projet. Ajoutez-en une avec la liste « Zone » du bandeau (« Ajouter une zone »).",
  readFailed: "Les tâches du projet n'ont pas pu être lues. Elles seront relues au prochain changement.",
  locked: "Activez « Editer » dans le bandeau pour modifier les tâches.",
  readOnly: "Ce service est en lecture seule pour vous : les tâches ne sont pas modifiables.",
  saving: "Enregistrement…",
  contextChanged: "Le projet ou le service a changé avant l'enregistrement : recommencez.",
  noFloorColumn: "La colonne « Etage » n'existe pas dans Planning_Projet : ajoutez-la (type Booléen) pour créer des étages.",
  noTemplateColumns: "Les colonnes « Nature », « Parent » et « Lien » (Texte) manquent dans Planning_Projet : ajoutez-les pour créer des étages.",
  noCycleColumns: "Les colonnes « Nature », « Parent » et « Lien » (Texte) manquent dans Planning_Projet : ajoutez-les pour créer des cycles.",
  noTaskLinkColumn: "La colonne « Lien » (Texte) manque dans Planning_Projet : ajoutez-la pour lier les tâches.",
  templateFailed: "L'étage n'a pas pu être créé complètement : rien n'a été gardé. Réessayez.",
  noLinkColumn: "La colonne « Lien_Structure » (Texte) manque dans Planning_Projet : ajoutez-la pour lier les étages aux coffrages.",
  noCheckColumn: "La colonne « Controle_Coffrage » (Booléen) manque dans Planning_Projet : ajoutez-la pour choisir la tâche contrôlée par rapport au coffrage.",
  floorGone: "Cet étage n'existe plus : fermez la fenêtre puis rouvrez-la.",
  noFloorRow: "Cet étage n'a pas de ligne « étage » dans Planning_Projet : le lien ne peut pas être mémorisé.",
  noPlanTask: "Cet étage n'a pas de tâche « FOND DE PLAN DE SYNTHESE » : aucune date ne peut être posée.",
  badIssueDate: "La date 0 Prev de ce coffrage n'est pas utilisable (elle doit être entre 2000 et 2100) : corrigez-la dans la liste de plans.",
  insertFailed: "La tâche n'a pas pu être ajoutée complètement : elle a été retirée. Réessayez.",
  insertCleanupFailed: "La tâche n'a pas pu être ajoutée complètement et n'a pas pu être retirée : supprimez « Nouvelle tâche » à la main.",
});

// Seul cas où la création d'un étage ne peut ni réussir ni être annulée : le dire précisément.
function floorCleanupFailedMessage(name) {
  return `L'étage n'a pas pu être créé complètement et ses lignes n'ont pas pu être retirées : supprimez l'étage « ${name} » à la main.`;
}

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function toProjectKey(name) {
  return toText(name).replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

function describeWriteError(error) {
  if (error?.userMessage) return error.userMessage;
  const message = String(error?.message || "");
  if (/lecture seule|read.?only/i.test(message)) {
    return "Ce service est en lecture seule pour vous : rien n'a été enregistré.";
  }
  if (/a changé pendant/i.test(message)) {
    return "Le projet ou le service a changé pendant l'enregistrement : recommencez.";
  }
  // Colonne du lien Structure inconnue de Grist.
  if (/\bLien_Structure\b/.test(message)) return MESSAGES.noLinkColumn;
  // Colonne de la tâche contrôlée inconnue de Grist.
  if (/\bControle_Coffrage\b/.test(message)) return MESSAGES.noCheckColumn;
  // Grist refuse une colonne inconnue : seule l'écriture d'un étage utilise Etage.
  if (/\bEtage\b/.test(message)) return MESSAGES.noFloorColumn;
  // Colonnes du modèle d'étage inconnues de Grist.
  if (/\b(Nature|Parent|Lien)\b/.test(message)) return MESSAGES.noTemplateColumns;
  return "L'enregistrement dans Grist a échoué. Réessayez.";
}

// Champs de plusieurs lignes (mêmes colonnes) → colonnes d'un BulkUpdateRecord.
function toColumns(fieldsList) {
  const columns = {};
  fieldsList.forEach((fields, index) => Object.entries(fields).forEach(([name, value]) => {
    if (!columns[name]) columns[name] = new Array(fieldsList.length).fill(null);
    columns[name][index] = value;
  }));
  return columns;
}

export function createSyntheseTasksController({
  context,
  docApi,
  createTable,
  confirm = (message) => window.confirm(message),
  now = () => new Date(),
  timers = {
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => clearTimeout(handle),
  },
  // Lecture des coffrages de Structure du projet : N°, zone et début de leur plan.
  loadFormworkStarts = null,
  // Fenêtre « Lien de la tâche » (clic droit) : créée à la première ouverture.
  createLinkDialog = createDefaultLinkDialog,
} = {}) {
  let active = false;
  let bound = false;
  let editingEnabled = false;
  let zoneFilter = "";
  let rows = [];
  let loaded = false;
  let readError = false;
  let projectKey = "";
  let sharedZones = [];
  let sharedZonesProjectKeys = new Set();
  let sections = [];
  let loadToken = 0;
  // Coffrages de Structure du projet et début de leur plan : la limite de fin du plan de
  // réservations du cycle 3. Lus à part des tâches (voir loadStarts).
  let formworkStarts = [];
  let startsToken = 0;
  let startsDue = false;
  const collapsedZoneKeys = new Set();
  const collapsedFloorKeys = new Set();
  const collapsedGroupKeys = new Set();
  // Colonne Etage : true / false d'après les lignes lues, null tant qu'on ne sait pas.
  let floorColumn = null;
  // Colonnes Nature, Parent et Lien (modèle d'étage) : même principe que Etage.
  let templateColumns = null;
  // Colonne Lien_Structure (lien vers un coffrage de Structure) : même principe que Etage.
  let structureLinkColumn = null;
  // Colonne Controle_Coffrage (tâche contrôlée choisie à la main) : même principe que Etage.
  let formworkCheckColumn = null;
  // Colonne Ordre (rang libre des tâches) : même principe que Etage. Sans elle, ni ordre libre
  // ni chaînage automatique.
  let orderColumn = null;
  // Opérations affichées mais pas encore enregistrées, dans l'ordre (voir submit).
  let pendingOps = [];
  let writeQueue = Promise.resolve();
  let queuedWrites = 0;
  let savingTimer = null;
  let savingShown = false;
  let errorShown = false;
  // La file est occupée depuis plus d'une seconde : « Enregistrement… » doit rester affiché.
  let savingDue = false;

  const table = createTable({
    onEdit: (taskId, field, rawValue) => handleEdit(taskId, field, rawValue),
    onRenameFloor: (zoneKey, floorKey, rawValue) => handleRenameFloor(zoneKey, floorKey, rawValue),
    onRenameGroup: (groupRowId, rawValue) => handleRenameGroup(groupRowId, rawValue),
    onAddTask: (zoneKey, floorKey = "", groupRowId = null, afterTaskId = null) => (
      handleAddTask(zoneKey, floorKey, groupRowId, afterTaskId)
    ),
    onAddFloor: (zoneKey) => handleAddFloor(zoneKey),
    onAddCycle: (zoneKey, floorKey, parentGroupRowId = null) => handleAddCycle(zoneKey, floorKey, parentGroupRowId),
    onDeleteTask: (taskId) => handleDeleteTask(taskId),
    onEditLink: (taskId) => handleEditLink(taskId),
    onDeleteFloor: (zoneKey, floorKey) => handleDeleteFloor(zoneKey, floorKey),
    onDeleteGroup: (groupRowId) => handleDeleteGroup(groupRowId),
    onSetFormworkCheck: (taskId, checked) => handleSetFormworkCheck(taskId, checked),
    onMoveTask: (taskId, target) => handleMoveTask(taskId, target),
    onMoveCycle: (groupRowId, target) => handleMoveCycle(groupRowId, target),
    onSetCycleMode: (groupRowId, mode) => handleSetCycleMode(groupRowId, mode),
    onToggleZone: (zoneKey) => toggleZone(zoneKey),
    onToggleFloor: (zoneKey, floorKey) => toggleFloor(zoneKey, floorKey),
    onToggleGroup: (groupRowId) => toggleGroup(groupRowId),
    onLockedAttempt: () => setStatus(lockedMessage(), "error"),
  });

  function getState() {
    return context?.getState?.() || {};
  }

  function getProject() {
    return getState().currentProject || null;
  }

  function projectKeysOf(project) {
    return [project?.name, ...(Array.isArray(project?.names) ? project.names : [])]
      .map(toProjectKey)
      .filter(Boolean);
  }

  function hasWriteAccess() {
    return getState().accessMode === "editable";
  }

  function isEditable() {
    return editingEnabled && hasWriteAccess();
  }

  function lockedMessage() {
    return hasWriteAccess() ? MESSAGES.locked : MESSAGES.readOnly;
  }

  function getSharedZones(project) {
    return projectKeysOf(project).some((key) => sharedZonesProjectKeys.has(key)) ? sharedZones : [];
  }

  // Barre d'état : une erreur reste jusqu'à la saisie acceptée suivante ; ni un message
  // d'information arrivé en arrière-plan ni « Enregistrement… » ne la remplacent.
  function setStatus(text, tone = "info") {
    errorShown = Boolean(text) && tone === "error";
    savingShown = Boolean(text) && tone === "saving";
    table.setStatus(text, tone);
  }

  function info(text) {
    if (errorShown) return;
    // D'autres écritures attendent encore et la file traîne : « Enregistrement… » reste affiché.
    if (savingDue && queuedWrites > 1) {
      setStatus(MESSAGES.saving, "saving");
      return;
    }
    setStatus(text, "info");
  }

  // Une action acceptée efface le message précédent ; si la file traîne depuis plus d'une
  // seconde, « Enregistrement… » reste affiché jusqu'à ce qu'elle soit vide.
  function clearStatus() {
    if (savingDue && queuedWrites) setStatus(MESSAGES.saving, "saving");
    else setStatus("", "info");
  }

  function fail(label, error, dropped = []) {
    console.error(label, error);
    const message = describeWriteError(error);
    setStatus(
      dropped.length > 1 ? `${message} Les saisies suivantes sur les mêmes lignes sont annulées aussi.` : message,
      "error"
    );
  }

  // Lignes lues dans Grist, avec par-dessus les opérations pas encore enregistrées : une
  // relecture pendant une écriture ne fait ni réapparaître une ancienne valeur, ni revenir
  // une ligne en cours de suppression.
  function displayedRows() {
    if (!pendingOps.length) return rows;
    const overlay = new Map();
    const removed = new Set();
    pendingOps.forEach((op) => {
      op.changes.forEach((fields, rowId) => overlay.set(rowId, { ...overlay.get(rowId), ...fields }));
      op.removals.forEach((rowId) => removed.add(rowId));
    });
    return rows
      .filter((row) => !removed.has(Number(row?.[TASK_COLUMNS.id])))
      .map((row) => {
        const fields = overlay.get(Number(row?.[TASK_COLUMNS.id]));
        return fields ? { ...row, ...fields } : row;
      });
  }

  function render() {
    if (!active) return;
    const project = getProject();
    const shownRows = project ? displayedRows() : [];
    sections = project
      ? buildSections({ rows: shownRows, sharedZones: getSharedZones(project), zoneFilter })
      : [];
    // La tâche contrôlée de chaque étage (cochée, sinon le plan de réservations du cycle 3)
    // porte sa limite de fin, le début du plan de coffrage de son étage : le tableau et le
    // Gantt la signalent quand elle la dépasse, et son menu dit si elle est contrôlée. Chaque
    // étage porte son lien Structure, que son emblème montre. Chaque cycle porte son mode, escalier
    // ou parallèle, lu dans les liens : son menu propose l'autre.
    let lines = buildRowModel(sections, { collapsedZoneKeys, collapsedFloorKeys, collapsedGroupKeys });
    lines = applyEndLimits(lines, controlTaskEndLimits({ syntheseRows: shownRows, formworkStarts }));
    lines = applyControlTasks(lines, readControlTasks(shownRows));
    lines = applyFloorLinks(lines, readFloorLinks(shownRows));
    lines = applyCycleModes(lines, cycleModes(sections));
    // Numéros de ligne sur tout le projet, tout déplié : replier ou filtrer une zone ne les change pas.
    // Sans filtre de zone, les sections affichées sont déjà tout le projet : pas de second calcul.
    const numberingSections = project && zoneFilter
      ? buildSections({ rows: shownRows, sharedZones: getSharedZones(project) })
      : sections;
    lines = applyLineNumbers(lines, lineNumbersOf(numberingSections));
    let emptyMessage = "";
    if (!project) emptyMessage = MESSAGES.noProject;
    else if (!loaded) emptyMessage = MESSAGES.loading;
    else if (readError) emptyMessage = MESSAGES.readFailed;
    else if (!lines.length) emptyMessage = MESSAGES.noZone;
    table.render(lines, {
      editable: isEditable(),
      emptyMessage,
      canAddFloor: floorColumn !== false && templateColumns !== false,
      canAddCycle: templateColumns !== false,
      canOrder: orderColumn === true,
      canMoveCycles: orderColumn === true && templateColumns === true,
      canSetCycleMode: templateColumns === true,
      canEditLink: templateColumns === true,
    });
  }

  // Les coffrages se lisent à l'ouverture de la vue, au changement de projet et quand
  // Planning_Projet change (refreshFormworkStarts) — pas à chaque relecture des tâches.
  // Illisibles, ils ne bloquent rien : les tâches s'affichent sans limite.
  async function loadStarts() {
    if (!active || typeof loadFormworkStarts !== "function") return;
    const token = ++startsToken;
    let next = [];
    try {
      if (getProject()) next = await loadFormworkStarts();
    } catch (error) {
      if (token !== startsToken) return;
      console.error("Lecture des coffrages de Structure impossible :", error);
      return;
    }
    if (token !== startsToken || !active) return;
    formworkStarts = Array.isArray(next) ? next : [];
    render();
  }

  async function load({ forceRefresh = false } = {}) {
    if (!active) return;
    const token = ++loadToken;
    const project = getProject();
    const nextProjectKey = project ? toProjectKey(project.name) : "";
    if (nextProjectKey !== projectKey) {
      projectKey = nextProjectKey;
      collapsedZoneKeys.clear();
      collapsedFloorKeys.clear();
      collapsedGroupKeys.clear();
      floorColumn = null;
      templateColumns = null;
      structureLinkColumn = null;
      formworkCheckColumn = null;
      orderColumn = null;
      rows = [];
      formworkStarts = [];
      startsDue = true;
      loaded = false;
      readError = false;
      render();
    }
    if (startsDue) {
      startsDue = false;
      void loadStarts();
    }
    if (!project) {
      render();
      return;
    }
    let nextRows;
    try {
      nextRows = await context.fetchContextRows(
        PLANNING_TABLE,
        forceRefresh ? { forceRefresh: true } : {}
      );
    } catch (error) {
      if (token !== loadToken || !active) return;
      console.error("Lecture des tâches Synthese impossible :", error);
      if (loaded) {
        setStatus(MESSAGES.readFailed, "error");
        return;
      }
      readError = true;
      loaded = true;
      render();
      return;
    }
    if (token !== loadToken || !active) return;
    rows = Array.isArray(nextRows) ? nextRows : [];
    floorColumn = detectFloorColumn(rows);
    templateColumns = detectTemplateColumns(rows);
    structureLinkColumn = detectStructureLinkColumn(rows);
    formworkCheckColumn = detectFormworkCheckColumn(rows);
    orderColumn = detectOrderColumn(rows);
    readError = false;
    loaded = true;
    render();
  }

  function findSection(zoneKey) {
    return sections.find((section) => section.zoneKey === zoneKey) || null;
  }

  function findTask(taskId) {
    for (const section of sections) {
      const task = section.tasks.find((candidate) => candidate.id === taskId);
      if (task) return task;
    }
    return null;
  }

  function allTasks() {
    return sections.flatMap((section) => section.tasks);
  }

  function findRow(rowId) {
    return rows.find((row) => Number(row?.[TASK_COLUMNS.id]) === rowId) || null;
  }

  // Revérifié au moment d'écrire : « Editer » ou le service ont pu changer pendant
  // la saisie.
  async function write(actions) {
    if (!isEditable()) {
      const error = new Error(lockedMessage());
      error.userMessage = lockedMessage();
      throw error;
    }
    return docApi.applyUserActions(actions);
  }

  // Contexte d'une écriture, mémorisé quand elle est demandée et revérifié quand vient son
  // tour : une écriture en attente ne part jamais dans un autre projet ou service.
  function captureContext() {
    const state = getState();
    return { service: toText(state.selectedService), projectKey: toProjectKey(state.currentProject?.name) };
  }

  function assertSameContext(expected) {
    const current = captureContext();
    if (current.service === expected.service && current.projectKey === expected.projectKey) return;
    const error = new Error(MESSAGES.contextChanged);
    error.userMessage = MESSAGES.contextChanged;
    throw error;
  }

  // « Enregistrement… » quand la file est occupée depuis plus d'une seconde.
  function startSavingTimer() {
    timers.clearTimeout(savingTimer);
    savingTimer = timers.setTimeout(() => {
      savingTimer = null;
      savingDue = true;
      if (queuedWrites && !errorShown) setStatus(MESSAGES.saving, "saving");
    }, SAVING_DELAY_MS);
  }

  function stopSavingIndicator() {
    timers.clearTimeout(savingTimer);
    savingTimer = null;
    savingDue = false;
    if (savingShown) setStatus("", "info");
  }

  // Les écritures partent une à une, dans l'ordre des demandes : une saisie peut s'appuyer
  // sur la précédente, encore en route vers Grist. Sans écriture en cours, elle part tout
  // de suite.
  function enqueue(job) {
    const run = queuedWrites ? writeQueue.then(job) : job();
    queuedWrites += 1;
    if (queuedWrites === 1) startSavingTimer();
    writeQueue = run.then(() => {}, () => {}).then(() => {
      queuedWrites -= 1;
      if (!queuedWrites) stopSavingIndicator();
    });
    return run;
  }

  // Une opération : ce qu'elle change à l'affichage en attendant Grist (valeurs par ligne,
  // lignes retirées), ses actions Grist — ou `perform`, quand l'écriture se fait en plusieurs
  // temps — et le contexte où elle a été demandée.
  function createOp({ changes = new Map(), removals = [], actions = [], perform = null }) {
    return { changes, removals: new Set(removals), actions, perform, context: captureContext() };
  }

  // Échec : l'opération est retirée, et avec elle les suivantes qui touchent les mêmes
  // lignes (elles avaient été calculées à partir de ce qu'elle affichait).
  function dropFrom(op) {
    const from = pendingOps.indexOf(op);
    const touched = new Set([...op.changes.keys(), ...op.removals]);
    const dropped = [op];
    pendingOps.slice(from + 1).forEach((candidate) => {
      const rowIds = [...candidate.changes.keys(), ...candidate.removals];
      if (!rowIds.some((rowId) => touched.has(rowId))) return;
      dropped.push(candidate);
      rowIds.forEach((rowId) => touched.add(rowId));
    });
    pendingOps = pendingOps.filter((candidate) => !dropped.includes(candidate));
    return dropped;
  }

  // Une opération est affichée tout de suite puis écrite dans la file. Réussie, les lignes
  // lues prennent ses valeurs en attendant la relecture ; échouée, elle disparaît de
  // l'affichage, avec les suivantes qui en dépendaient.
  function submit(op, { onSuccess, onFailure } = {}) {
    pendingOps.push(op);
    render();
    return enqueue(async () => {
      if (!pendingOps.includes(op)) return;
      let result;
      try {
        assertSameContext(op.context);
        result = op.perform ? await op.perform() : await write(op.actions);
      } catch (error) {
        const dropped = dropFrom(op);
        render();
        onFailure?.(error, dropped);
        return;
      }
      op.changes.forEach((fields, rowId) => {
        const row = findRow(rowId);
        if (row) Object.assign(row, fields);
      });
      if (op.removals.size) rows = rows.filter((row) => !op.removals.has(Number(row?.[TASK_COLUMNS.id])));
      pendingOps = pendingOps.filter((candidate) => candidate !== op);
      onSuccess?.(result);
    });
  }

  function refuseLocked() {
    setStatus(lockedMessage(), "error");
    render();
  }

  // Saisie : affichée tout de suite, enregistrée ensuite en arrière-plan, dans l'ordre. Une
  // date ou une durée changée entraîne les tâches liées en aval, dans la même écriture. Le
  // tableau passe aussitôt à la cellule suivante : rien de ce qui est tapé entre-temps n'est
  // perdu.
  function handleEdit(taskId, field, rawValue) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    const task = findTask(taskId);
    if (!task || !findRow(taskId)) return;
    // Toutes les tâches du projet, sans le filtre de zone : un lien peut viser une tâche d'une zone
    // masquée, et l'aval peut s'y trouver.
    const everyTask = allSections().flatMap((section) => section.tasks);
    // Son prédécesseur : une tâche qui finit avec lui (lien fin → fin) garde la Fin du lien.
    const predecessor = task.link ? everyTask.find((candidate) => candidate.id === task.link.predId) || null : null;
    const result = applyTaskEdit(task, field, rawValue, { today: now(), predecessor });
    if (!result.ok) {
      setStatus(result.error, "error");
      render();
      return;
    }
    if (!Object.keys(result.fields).length) {
      render();
      return;
    }
    const changes = new Map([[taskId, result.fields]]);
    let actions = [["UpdateRecord", PLANNING_TABLE, taskId, result.fields]];
    if (DATE_FIELDS.has(field)) {
      const updates = cascadeFrom(result.task, everyTask);
      if (updates.length) {
        const fieldsList = updates.map(dateFieldsOf);
        updates.forEach((update, index) => changes.set(update.id, fieldsList[index]));
        actions.push(["BulkUpdateRecord", PLANNING_TABLE, updates.map((update) => update.id), toColumns(fieldsList)]);
      }
      // Un cycle en parallèle dont une durée change garde sa tâche la plus longue comme tâche pilote
      // (voir planParallelRealign) : tout part dans la même écriture.
      const realign = parallelRealignOf(changes);
      if (realign.size) actions = buildUpdateActions(mergeChanges(changes, realign));
    }
    clearStatus();
    void submit(createOp({ changes, actions }), {
      onFailure: (error, dropped) => fail("Modification de la tâche impossible :", error, dropped),
    });
  }

  // « Modifier le lien… » (clic droit sur une tâche) : la fenêtre montre son lien, les tâches de sa
  // zone (avec leur numéro de ligne) et l'aperçu des dates ; « Valider » passe par handleLinkChange.
  let linkDialog = null;
  let linkTaskId = null;
  // Projet pour lequel la fenêtre a été ouverte : elle se ferme s'il change.
  let linkProject = "";
  function handleEditLink(taskId) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    if (templateColumns !== true) {
      setStatus(MESSAGES.noTaskLinkColumn, "error");
      return;
    }
    const all = allSections();
    const choices = linkChoices({ sections: all, taskId, numbering: lineNumbersOf(all) });
    if (!choices) return;
    linkDialog ||= createLinkDialog({ onSubmit: (link) => handleLinkChange(linkTaskId, link) });
    linkTaskId = taskId;
    linkProject = toText(getProject()?.name);
    linkDialog.open({
      ...choices,
      preview: (link) => previewLink({ sections: allSections(), taskId, link }),
    });
  }

  // Lien choisi (`link` : { predId, type, lag }, null pour plus de lien) : le lien, les dates qu'il
  // donne à la tâche et celles de l'aval (zones masquées comprises), dans la même écriture. Écrit tel
  // quel : aucun recalage des cycles en parallèle (un cycle dont on change un lien peut devenir
  // mélangé).
  function handleLinkChange(taskId, link) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    if (templateColumns !== true) {
      setStatus(MESSAGES.noTaskLinkColumn, "error");
      render();
      return;
    }
    const all = allSections();
    const result = planLinkChange({ sections: all, taskId, link });
    if (!result.ok) {
      setStatus(result.error, "error");
      render();
      return;
    }
    if (!Object.keys(result.fields).length) {
      render();
      return;
    }
    const changes = new Map([[taskId, result.fields]]);
    // L'aval sur tout le projet, zones masquées comprises.
    cascadeFrom(result.task, all.flatMap((section) => section.tasks)).forEach((update) => changes.set(update.id, dateFieldsOf(update)));
    clearStatus();
    void submit(createOp({ changes, actions: buildUpdateActions(changes) }), {
      onFailure: (error, dropped) => fail("Modification du lien impossible :", error, dropped),
    });
  }

  function findFloor(section, floorKey) {
    return section?.floors.find((floor) => floor.key === floorKey) || null;
  }

  // Second temps d'un ajout dont la tâche du dessous doit suivre la nouvelle : la tâche (son id
  // d'abord), puis le lien de la tâche du dessous et les dates qui suivent. Si ce second temps
  // échoue, la tâche créée est retirée : rien de bancal ne reste dans Grist.
  async function addThenFollow(op, plan, addActions, before) {
    const added = await write(addActions);
    const newId = Number(added?.retValues?.[0]);
    if (!Number.isInteger(newId) || newId <= 0) return { newId: null, followChanges: new Map() };
    try {
      assertSameContext(op.context);
      const followChanges = plan.follow
        ? planInsertFollowUp({
          sections: allSections(),
          newTask: { ...plan.task, id: newId },
          successorId: plan.follow.successorId,
          lag: plan.follow.lag,
        })
        : new Map();
      mergeChanges(followChanges, parallelRealignAfterAdd(before, plan, newId, followChanges));
      if (followChanges.size) await write(buildUpdateActions(followChanges));
      return { newId, followChanges };
    } catch (error) {
      let cleanupFailed = false;
      try {
        // Annulation de notre propre écriture : directement par docApi, comme pour un étage.
        await docApi.applyUserActions([["RemoveRecord", PLANNING_TABLE, newId]]);
      } catch (cleanupError) {
        console.error("Tâche incomplète non retirée :", cleanupError);
        cleanupFailed = true;
      }
      const failure = new Error(MESSAGES.insertFailed, { cause: error });
      failure.userMessage = cleanupFailed
        ? MESSAGES.insertCleanupFailed
        : describeWriteError(error) === MESSAGES.contextChanged
          ? MESSAGES.contextChanged
          : MESSAGES.insertFailed;
      throw failure;
    }
  }

  // Une tâche ajoutée (`plan` de planTaskInsert, d'id `newId`, puis `followChanges`) : les champs qui
  // gardent en parallèle les cycles qui l'étaient avant l'ajout (`before` : les sections d'alors).
  function parallelRealignAfterAdd(before, plan, newId, followChanges = new Map()) {
    if (templateColumns !== true) return new Map();
    const changes = mergeChanges(new Map(plan.changes), followChanges);
    // La ligne ajoutée, une fois (Grist a pu déjà la renvoyer).
    const others = displayedRows().filter((row) => Number(row?.[TASK_COLUMNS.id]) !== newId);
    const after = [...others, { [TASK_COLUMNS.id]: newId, ...plan.fields }].map((row) => {
      const fields = changes.get(Number(row?.[TASK_COLUMNS.id]));
      return fields ? { ...row, ...fields } : row;
    });
    return planParallelRealign({ before, rows: after, canLink: true });
  }

  // Un id qu'aucune ligne n'a encore, le temps d'évaluer un ajout.
  function nextFreeRowId() {
    return displayedRows().reduce((max, row) => Math.max(max, Number(row?.[TASK_COLUMNS.id]) || 0), 0) + 1;
  }

  // Nouvelle tâche dans un conteneur : un groupe (cycle ou sous-groupe), un étage, ou le
  // niveau zone ; juste sous la tâche cliquée (`afterTaskId`) avec la colonne Ordre, sinon à la
  // fin. Avec Ordre et Lien, elle suit la tâche du dessus (voir planTaskInsert) ; dans un cycle en
  // parallèle, elle finit avec sa tâche pilote, ou en devient la tâche pilote.
  function handleAddTask(zoneKey, floorKey = "", groupRowId = null, afterTaskId = null) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const project = getProject();
    const group = groupRowId ? findGroup(sections, groupRowId) : null;
    if (groupRowId && !group) return Promise.resolve();
    const section = findSection(group ? group.zoneKey : zoneKey);
    const wantedFloorKey = group ? group.floorKey : floorKey;
    const floor = wantedFloorKey ? findFloor(section, wantedFloorKey) : null;
    if (!project || !section || (wantedFloorKey && !floor)) return Promise.resolve();
    const all = allSections();
    const plan = planTaskInsert({
      sections: all,
      container: { zoneKey: section.zoneKey, floorKey: floor ? floor.key : "", groupRowId: group ? group.rowId : null },
      afterTaskId,
      canOrder: orderColumn === true,
      canLink: templateColumns === true,
      // Dans un cycle en parallèle (ou pris dans un cycle en parallèle), la nouvelle tâche finit avec
      // sa tâche pilote.
      finishWith: group ? parallelPilot(all, group.rowId) : null,
      today: now(),
      projectName: project.name,
    });
    if (!plan) return Promise.resolve();
    const { fields } = plan;
    const where = group ? `« ${group.name} »` : floor ? `l'étage « ${floor.name} »` : `« ${section.label} »`;
    const clicked = plan.atEnd ? findTask(afterTaskId) : null;
    const addedText = clicked
      ? `Tâche ajoutée à la fin de ${where} : la colonne « Ordre » (Texte) manque dans Planning_Projet pour la placer sous « ${clicked.name} ».`
      : `Tâche ajoutée dans ${where}.`;
    const addActions = [["AddRecord", PLANNING_TABLE, null, fields], ...buildUpdateActions(plan.changes)];
    clearStatus();
    // En deux temps si la tâche du dessous doit la suivre, ou si un cycle en parallèle doit être
    // rebâti autour d'elle (elle en devient la tâche pilote) : les liens vers elle attendent son id.
    const twoSteps = Boolean(plan.follow) || parallelRealignAfterAdd(all, plan, nextFreeRowId()).size > 0;
    const op = createOp({
      changes: plan.changes,
      ...(twoSteps ? { perform: () => addThenFollow(op, plan, addActions, all) } : { actions: addActions }),
    });
    return submit(op, {
      onSuccess: (result) => {
        const newId = Number(twoSteps ? result?.newId : result?.retValues?.[0]);
        const hasId = Number.isInteger(newId) && newId > 0;
        if (hasId && !findRow(newId)) rows = [...rows, { id: newId, ...fields }];
        (result?.followChanges || new Map()).forEach((followFields, rowId) => {
          const row = findRow(rowId);
          if (row) Object.assign(row, followFields);
        });
        collapsedZoneKeys.delete(section.zoneKey);
        if (floor) collapsedFloorKeys.delete(floorCollapseKey(section.zoneKey, floor.key));
        for (let container = group; container; container = container.parentGroup) {
          collapsedGroupKeys.delete(groupCollapseKey(container.rowId));
        }
        render();
        if (hasId) table.startEditing(newId, "name");
        info(addedText);
      },
      onFailure: (error, dropped) => fail("Ajout de la tâche impossible :", error, dropped),
    });
  }

  // Nouveau cycle à la fin d'un étage, ou sous-cycle à la fin d'un cycle : une seule écriture
  // (la ligne et, avec la colonne Ordre, les rangs du conteneur). Le nom passe aussitôt en saisie.
  function handleAddCycle(zoneKey, floorKey = "", parentGroupRowId = null) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    if (templateColumns === false) {
      setStatus(MESSAGES.noCycleColumns, "error");
      return Promise.resolve();
    }
    const project = getProject();
    if (!project) return Promise.resolve();
    const plan = planCycleInsert({
      sections: allSections(),
      zoneKey,
      floorKey,
      parentGroupRowId,
      canOrder: orderColumn === true,
      projectName: project.name,
    });
    if (!plan) return Promise.resolve();
    const { fields, parent, floor } = plan;
    clearStatus();
    return submit(createOp({
      changes: plan.changes,
      actions: [["AddRecord", PLANNING_TABLE, null, fields], ...buildUpdateActions(plan.changes)],
    }), {
      onSuccess: (result) => {
        const newId = Number(result?.retValues?.[0]);
        const hasId = Number.isInteger(newId) && newId > 0;
        if (hasId && !findRow(newId)) rows = [...rows, { id: newId, ...fields }];
        // Grist réutilise les ids : un ancien repli ne doit pas s'appliquer au nouveau cycle.
        if (hasId) collapsedGroupKeys.delete(groupCollapseKey(newId));
        collapsedZoneKeys.delete(zoneKey);
        collapsedFloorKeys.delete(floorCollapseKey(zoneKey, floor.key));
        for (let container = parent; container; container = container.parentGroup) {
          collapsedGroupKeys.delete(groupCollapseKey(container.rowId));
        }
        render();
        if (hasId) table.startEditingGroup(newId);
        info(parent ? `Sous-cycle ajouté dans « ${parent.name} ».` : `Cycle ajouté dans l'étage « ${floor.name} ».`);
      },
      onFailure: (error, dropped) => {
        if (describeWriteError(error) === MESSAGES.noTemplateColumns) {
          templateColumns = false;
          render();
          setStatus(MESSAGES.noCycleColumns, "error");
          return;
        }
        fail("Ajout du cycle impossible :", error, dropped);
      },
    });
  }

  function handleDeleteTask(taskId) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const task = findTask(taskId);
    if (!task || !findRow(taskId)) return Promise.resolve();
    if (!confirm(`Supprimer la tâche « ${task.name} » ?`)) return Promise.resolve();
    // Avec Lien : la chaîne se referme à sa place, les liens qui la désignaient sont effacés, et un
    // cycle en parallèle le reste.
    const changes = withParallelRealign(
      planTaskRemoval({ sections: allSections(), taskId, canLink: templateColumns === true }),
      [taskId]
    );
    clearStatus();
    return submit(createOp({
      changes,
      removals: [taskId],
      actions: [["RemoveRecord", PLANNING_TABLE, taskId], ...buildUpdateActions(changes)],
    }), {
      onSuccess: () => info(`Tâche « ${task.name} » supprimée.`),
      onFailure: (error, dropped) => fail("Suppression de la tâche impossible :", error, dropped),
    });
  }

  // Nouvel étage d'après le modèle : ses 26 lignes, puis Parent et Lien une fois les ids
  // connus. Si le second temps échoue, les lignes créées sont retirées : rien de bancal ne
  // reste dans Grist.
  function handleAddFloor(zoneKey) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    if (floorColumn === false) {
      setStatus(MESSAGES.noFloorColumn, "error");
      return Promise.resolve();
    }
    if (templateColumns === false) {
      setStatus(MESSAGES.noTemplateColumns, "error");
      return Promise.resolve();
    }
    const project = getProject();
    const section = findSection(zoneKey);
    if (!project || !section || section.zoneKey === NO_ZONE_KEY) return Promise.resolve();
    const name = nextFloorName(section.floors);
    const newRows = buildFloorFromTemplate({ floorName: name, zoneName: section.zoneName, projectName: project.name });
    clearStatus();
    // `op` est référencé depuis `perform` (fermeture) : le second temps de l'écriture doit
    // revérifier le contexte capturé au premier (submit ne le revérifie qu'une fois, avant
    // `perform`).
    const op = createOp({
      perform: async () => {
        const added = await write([buildBulkAddAction(newRows)]);
        const ids = Array.isArray(added?.retValues?.[0]) ? added.retValues[0].map(Number) : [];
        try {
          assertSameContext(op.context);
          const links = buildTemplateLinks(ids);
          await write([links.action]);
          return { ids, linkFields: links.fieldsById };
        } catch (error) {
          const created = ids.filter((id) => Number.isInteger(id) && id > 0);
          let cleanupFailed = false;
          if (created.length) {
            try {
              // Annulation de notre propre écriture : directement par docApi, pas par write(),
              // pour qu'un « Editer » désactivé entre les deux temps ne la bloque pas aussi.
              await docApi.applyUserActions([["BulkRemoveRecord", PLANNING_TABLE, created]]);
            } catch (cleanupError) {
              console.error("Lignes de l'étage incomplet non retirées :", cleanupError);
              cleanupFailed = true;
            }
          }
          const message = describeWriteError(error);
          const failure = new Error(MESSAGES.templateFailed, { cause: error });
          failure.userMessage = cleanupFailed
            ? floorCleanupFailedMessage(name)
            : message === MESSAGES.contextChanged
              ? MESSAGES.contextChanged
              : message === MESSAGES.noTemplateColumns
                ? MESSAGES.noTemplateColumns
                : MESSAGES.templateFailed;
          throw failure;
        }
      },
    });
    return submit(op, {
      onSuccess: ({ ids, linkFields }) => {
        const known = new Set(rows.map((row) => Number(row?.[TASK_COLUMNS.id])));
        // Une relecture partagée a pu arriver entre les deux temps de l'écriture : les 26
        // lignes sont alors déjà dans `rows`, sans Parent ni Lien — à compléter, pas à ignorer.
        rows = rows.map((row) => {
          const fields = linkFields.get(Number(row?.[TASK_COLUMNS.id]));
          return fields ? { ...row, ...fields } : row;
        });
        const added = newRows
          .map((fields, index) => ({ id: ids[index], ...fields, ...(linkFields.get(ids[index]) || {}) }))
          .filter((row) => !known.has(row.id));
        rows = [...rows, ...added];
        collapsedZoneKeys.delete(zoneKey);
        // Grist réutilise les ids : un ancien repli (étage ou cycle supprimé) ne doit pas
        // s'appliquer au nouvel étage. Le nouvel étage est aussi déplié d'après la spec.
        collapsedFloorKeys.delete(floorCollapseKey(zoneKey, floorKeyOf(name)));
        ids.forEach((id) => collapsedGroupKeys.delete(groupCollapseKey(id)));
        render();
        table.startEditingFloor(zoneKey, floorKeyOf(name));
        info(`Étage ajouté dans « ${section.label} ».`);
      },
      onFailure: (error, dropped) => {
        const message = describeWriteError(error);
        if (message === MESSAGES.noFloorColumn) floorColumn = false;
        if (message === MESSAGES.noTemplateColumns) templateColumns = false;
        render();
        fail("Ajout de l'étage impossible :", error, dropped);
      },
    });
  }

  // Renommer : la ligne-étage et le Groupe de ses tâches changent ensemble, affichés tout de
  // suite comme une saisie.
  function handleRenameFloor(zoneKey, floorKey, rawValue) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    const section = findSection(zoneKey);
    const floor = findFloor(section, floorKey);
    if (!floor) return;
    const result = validateFloorName(rawValue, { floors: section.floors, currentKey: floor.key });
    if (!result.ok) {
      setStatus(result.error, "error");
      render();
      return;
    }
    if (result.name === floor.name) {
      render();
      return;
    }
    const changes = buildFloorRenameChanges(floor, result.name);
    // Le repli suit l'étage sous son nouveau nom.
    if (collapsedFloorKeys.delete(floorCollapseKey(zoneKey, floor.key))) {
      collapsedFloorKeys.add(floorCollapseKey(zoneKey, result.key));
    }
    clearStatus();
    void submit(createOp({ changes, actions: buildFloorRenameActions(floor, result.name) }), {
      onFailure: (error, dropped) => fail("Renommage de l'étage impossible :", error, dropped),
    });
  }

  function handleDeleteFloor(zoneKey, floorKey) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const floor = findFloor(findSection(zoneKey), floorKey);
    if (!floor) return Promise.resolve();
    if (!confirm(buildFloorDeleteQuestion(floor))) return Promise.resolve();
    const removals = floorRemovalIds(floor);
    // Avec Lien : les liens des autres tâches vers les lignes supprimées sont effacés.
    const changes = planOrphanLinks({ sections: allSections(), removedIds: removals, canLink: templateColumns === true });
    clearStatus();
    return submit(createOp({
      changes,
      removals,
      actions: [...buildFloorDeleteActions(floor), ...buildUpdateActions(changes)],
    }), {
      onSuccess: () => {
        // Grist réutilise les ids : sans ce nettoyage, un étage recréé plus tard avec les
        // mêmes ids retrouverait les replis de celui-ci.
        collapsedFloorKeys.delete(floorCollapseKey(zoneKey, floor.key));
        floor.groups.forEach((group) => collapsedGroupKeys.delete(groupCollapseKey(group.rowId)));
        info(`Étage « ${floor.name} » supprimé.`);
      },
      onFailure: (error, dropped) => fail("Suppression de l'étage impossible :", error, dropped),
    });
  }

  // Renommer un cycle ou un sous-groupe : sa ligne seulement (ses tâches pointent vers son id).
  function handleRenameGroup(groupRowId, rawValue) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    const group = findGroup(sections, groupRowId);
    if (!group) return;
    const result = validateGroupName(rawValue);
    if (!result.ok) {
      setStatus(result.error, "error");
      render();
      return;
    }
    if (result.name === group.name) {
      render();
      return;
    }
    clearStatus();
    void submit(createOp({
      changes: new Map([[group.rowId, { [TASK_COLUMNS.name]: result.name }]]),
      actions: [buildGroupRenameAction(group, result.name)],
    }), {
      onFailure: (error, dropped) => fail("Renommage impossible :", error, dropped),
    });
  }

  // Supprimer un cycle ou un sous-groupe : sa ligne et tout son contenu, après confirmation.
  function handleDeleteGroup(groupRowId) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const group = findGroup(sections, groupRowId);
    if (!group) return Promise.resolve();
    if (!confirm(buildGroupDeleteQuestion(group))) return Promise.resolve();
    const removals = groupRemovalIds(group);
    // Avec Lien : la chaîne se referme à la place du cycle, les liens vers ses lignes sont effacés,
    // et un cycle en parallèle le reste.
    const changes = withParallelRealign(
      planCycleRemoval({ sections: allSections(), groupRowId, canLink: templateColumns === true }),
      removals
    );
    clearStatus();
    return submit(createOp({
      changes,
      removals,
      actions: [...buildGroupDeleteActions(group), ...buildUpdateActions(changes)],
    }), {
      onSuccess: () => {
        // Même raison que pour un étage supprimé : les ids réutilisés ne doivent pas hériter
        // d'un repli du cycle ou sous-groupe supprimé.
        collapsedGroupKeys.delete(groupCollapseKey(group.rowId));
        descendantGroups(group).forEach((child) => collapsedGroupKeys.delete(groupCollapseKey(child.rowId)));
        info(`« ${group.name} » supprimé.`);
      },
      onFailure: (error, dropped) => fail("Suppression impossible :", error, dropped),
    });
  }

  // Glisser-déposer : la tâche change de conteneur et / ou de place (colonne Ordre) ; avec Ordre
  // et Lien, la chaîne se referme à l'ancienne place et se renoue à la nouvelle, et les dates
  // suivent (voir planTaskMove) ; glissée dans un cycle en parallèle, elle finit avec sa tâche
  // pilote. Le conteneur visé est déplié.
  function handleMoveTask(taskId, target) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    const task = findTask(taskId);
    if (!task || !findRow(taskId) || !target) return;
    const changes = withParallelRealign(planTaskMove({
      sections: allSections(),
      taskId,
      target,
      canOrder: orderColumn === true,
      canLink: templateColumns === true,
    }));
    if (!changes.size) return;
    collapsedZoneKeys.delete(target.zoneKey);
    if (target.floorKey) collapsedFloorKeys.delete(floorCollapseKey(target.zoneKey, target.floorKey));
    for (let container = findGroup(sections, target.groupRowId); container; container = container.parentGroup) {
      collapsedGroupKeys.delete(groupCollapseKey(container.rowId));
    }
    clearStatus();
    void submit(createOp({ changes, actions: buildUpdateActions(changes) }), {
      onFailure: (error, dropped) => fail("Déplacement de la tâche impossible :", error, dropped),
    });
  }

  // Glisser-déposer d'un cycle ou d'un sous-cycle : une seule écriture (Parent, Nature, rangs et, avec
  // Lien, chaîne et dates : voir planCycleMove ; un cycle en parallèle le reste). Le conteneur
  // d'arrivée et ses parents sont dépliés.
  function handleMoveCycle(groupRowId, target) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    if (orderColumn !== true || templateColumns !== true || !target) return;
    const changes = withParallelRealign(planCycleMove({
      sections: allSections(),
      groupRowId,
      target,
      canLink: templateColumns === true,
    }));
    if (!changes.size) return;
    collapsedZoneKeys.delete(target.zoneKey);
    if (target.floorKey) collapsedFloorKeys.delete(floorCollapseKey(target.zoneKey, target.floorKey));
    for (let container = findGroup(sections, target.groupRowId); container; container = container.parentGroup) {
      collapsedGroupKeys.delete(groupCollapseKey(container.rowId));
    }
    clearStatus();
    void submit(createOp({ changes, actions: buildUpdateActions(changes) }), {
      onFailure: (error, dropped) => fail("Déplacement du cycle impossible :", error, dropped),
    });
  }

  // Passer un cycle en escalier ou en parallèle : une seule écriture, les liens de son contenu et de
  // la tâche qui le suit, et les dates qui en découlent (voir planCycleMode). Un lien qui fermerait
  // une boucle n'est pas posé : le message dit alors, d'après le mode relu, que le cycle n'a changé
  // qu'en partie, ou pas.
  function handleSetCycleMode(groupRowId, mode) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const group = findGroup(sections, groupRowId);
    if (templateColumns !== true || !group) return Promise.resolve();
    const changes = planCycleMode({ sections: allSections(), groupRowId, mode, canLink: true });
    // Un cycle qui l'englobe et se lit alors en parallèle garde sa tâche la plus longue comme tâche
    // pilote : même écriture.
    if (changes.size) mergeChanges(changes, planParentsParallel({ rows: rowsAfter(changes), groupRowId }));
    const modeLabel = mode === "series" ? "en escalier" : "en parallèle";
    // Le mode tel qu'affiché, écritures en attente comprises.
    const reached = () => cycleModes(sections).get(groupRowId) === mode;
    clearStatus();
    if (!changes.size) {
      info(reached()
        ? `« ${group.name} » est déjà ${modeLabel}.`
        : `« ${group.name} » n'a pas pu passer ${modeLabel}.`);
      return Promise.resolve();
    }
    return submit(createOp({ changes, actions: buildUpdateActions(changes) }), {
      onSuccess: () => info(reached()
        ? `« ${group.name} » passé ${modeLabel}.`
        : `« ${group.name} » n'est passé qu'en partie ${modeLabel}.`),
      onFailure: (error, dropped) => fail("Changement de mode du cycle impossible :", error, dropped),
    });
  }

  // Menu d'une tâche d'étage : la choisir comme tâche contrôlée par rapport au coffrage — les
  // autres tâches cochées de l'étage sont décochées dans la même écriture — ou la décocher,
  // ce qui rend à l'étage son choix par défaut.
  function handleSetFormworkCheck(taskId, checked) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const task = findTask(taskId);
    if (!task || !findRow(taskId) || !task.floorKey) return Promise.resolve();
    if (formworkCheckColumn === false) {
      setStatus(MESSAGES.noCheckColumn, "error");
      return Promise.resolve();
    }
    const controls = readControlTasks(displayedRows());
    const current = controls.get(taskId);
    const floorLabel = `l'étage « ${task.groupName} »`;
    if (checked && current && !current.chosen) {
      clearStatus();
      info(`« ${task.name} » est déjà la tâche contrôlée de ${floorLabel}, par défaut.`);
      return Promise.resolve();
    }
    if (Boolean(checked) === Boolean(current?.chosen)) return Promise.resolve();
    const column = TASK_COLUMNS.formworkCheck;
    const changes = new Map();
    if (checked) {
      controls.forEach((entry, otherId) => {
        const sameFloor = entry.zoneKey === task.zoneKey && entry.floorKey === task.floorKey;
        if (entry.chosen && sameFloor) changes.set(otherId, { [column]: false });
      });
    }
    changes.set(taskId, { [column]: Boolean(checked) });
    const rowIds = [...changes.keys()];
    clearStatus();
    return submit(createOp({
      changes,
      actions: [["BulkUpdateRecord", PLANNING_TABLE, rowIds, { [column]: rowIds.map((rowId) => changes.get(rowId)[column]) }]],
    }), {
      onSuccess: () => info(checked
        ? `« ${task.name} » est maintenant la tâche contrôlée par rapport au coffrage de ${floorLabel}.`
        : `L'étage « ${task.groupName} » revient à sa tâche contrôlée par défaut.`),
      onFailure: (error, dropped) => {
        if (describeWriteError(error) === MESSAGES.noCheckColumn) formworkCheckColumn = false;
        fail("Choix de la tâche contrôlée impossible :", error, dropped);
      },
    });
  }

  // Les lignes affichées une fois une opération faite (champs par ligne, lignes retirées).
  function rowsAfter(changes, removals = []) {
    const removed = new Set(removals);
    return displayedRows()
      .filter((row) => !removed.has(Number(row?.[TASK_COLUMNS.id])))
      .map((row) => {
        const fields = changes.get(Number(row?.[TASK_COLUMNS.id]));
        return fields ? { ...row, ...fields } : row;
      });
  }

  // Les champs qui, avec Lien, gardent en parallèle chaque cycle qui l'était, après une opération
  // (champs par ligne, lignes retirées) : voir planParallelRealign.
  function parallelRealignOf(changes, removals = []) {
    if (templateColumns !== true || (!changes.size && !removals.length)) return new Map();
    return planParallelRealign({ before: allSections(), rows: rowsAfter(changes, removals), canLink: true });
  }

  // Une opération complétée pour que chaque cycle qui était en parallèle le reste : tout part dans la
  // même écriture.
  function withParallelRealign(changes, removals = []) {
    return mergeChanges(changes, parallelRealignOf(changes, removals));
  }

  // Toutes les zones du projet, sans le filtre du bandeau : la fenêtre « Lien Structure » les
  // montre toutes.
  function allSections() {
    const project = getProject();
    return project ? buildSections({ rows: displayedRows(), sharedZones: getSharedZones(project) }) : [];
  }

  // Fenêtre « Lien Structure » : mémorise le coffrage d'un étage (formworkNumber : son N° ;
  // "" : délier ; absent : inchangé) et / ou pose une date de diffusion sur le début de l'étage
  // (date). Une seule opération : le lien et les dates s'écrivent ensemble, ou pas du tout. La
  // réponse arrive quand Grist a répondu.
  function applyStructureLink({ zoneKey, floorKey, formworkNumber, date } = {}) {
    const refusal = (error) => Promise.resolve({ ok: false, error });
    if (!isEditable()) return refusal(lockedMessage());
    const linking = formworkNumber !== undefined;
    if (linking && structureLinkColumn === false) return refusal(MESSAGES.noLinkColumn);
    const all = allSections();
    const floor = findFloor(all.find((section) => section.zoneKey === zoneKey) || null, floorKey);
    if (!floor) return refusal(MESSAGES.floorGone);
    const changes = new Map();
    const actions = [];
    if (linking) {
      if (!floor.rowIds.length) return refusal(MESSAGES.noFloorRow);
      const number = toText(formworkNumber);
      const shown = displayedRows();
      const rowIds = floor.rowIds.filter((rowId) => {
        const row = shown.find((candidate) => Number(candidate?.[TASK_COLUMNS.id]) === rowId);
        return toText(row?.[TASK_COLUMNS.structureLink]) !== number;
      });
      if (rowIds.length) {
        rowIds.forEach((rowId) => changes.set(rowId, { [TASK_COLUMNS.structureLink]: number }));
        actions.push(["BulkUpdateRecord", PLANNING_TABLE, rowIds, { [TASK_COLUMNS.structureLink]: rowIds.map(() => number) }]);
      }
    }
    if (date != null) {
      const { anchor } = findFloorStart(floor.tasks);
      if (!anchor) return refusal(MESSAGES.noPlanTask);
      const moved = moveTaskStart(anchor, date);
      if (!moved.ok) return refusal(MESSAGES.badIssueDate);
      if (Object.keys(moved.fields).length) {
        changes.set(anchor.id, moved.fields);
        actions.push(["UpdateRecord", PLANNING_TABLE, anchor.id, moved.fields]);
      }
      // Même si l'ancre ne bouge pas : un fond de plan retouché à la main est recalé sur elle.
      const updates = cascadeFrom(moved.task, all.flatMap((section) => section.tasks));
      if (updates.length) {
        const fieldsList = updates.map(dateFieldsOf);
        updates.forEach((update, index) => changes.set(update.id, fieldsList[index]));
        actions.push(["BulkUpdateRecord", PLANNING_TABLE, updates.map((update) => update.id), toColumns(fieldsList)]);
      }
    }
    if (!actions.length) return Promise.resolve({ ok: true });
    clearStatus();
    // Une opération écartée par l'échec d'une précédente n'appelle aucun des deux retours.
    let outcome = { ok: false, error: describeWriteError(null) };
    return submit(createOp({ changes, actions }), {
      onSuccess: () => {
        outcome = { ok: true };
      },
      onFailure: (error, dropped) => {
        const message = describeWriteError(error);
        if (message === MESSAGES.noLinkColumn) structureLinkColumn = false;
        fail("Lien Structure impossible :", error, dropped);
        outcome = { ok: false, error: message };
      },
    }).then(() => outcome);
  }

  function toggleZone(zoneKey) {
    if (collapsedZoneKeys.has(zoneKey)) collapsedZoneKeys.delete(zoneKey);
    else collapsedZoneKeys.add(zoneKey);
    render();
  }

  function toggleFloor(zoneKey, floorKey) {
    const key = floorCollapseKey(zoneKey, floorKey);
    if (collapsedFloorKeys.has(key)) collapsedFloorKeys.delete(key);
    else collapsedFloorKeys.add(key);
    render();
  }

  function toggleGroup(groupRowId) {
    const key = groupCollapseKey(groupRowId);
    if (collapsedGroupKeys.has(key)) collapsedGroupKeys.delete(key);
    else collapsedGroupKeys.add(key);
    render();
  }

  function bind() {
    if (bound) return;
    bound = true;
    // Les changements de Planning_Projet arrivent par la surveillance de main.js
    // (options de signal du relais, sans sondage), qui appelle refresh().
    context?.subscribe?.(() => {
      // Projet changé : la fenêtre de lien montrait l'ancien.
      if (linkDialog && toText(getProject()?.name) !== linkProject) linkDialog.close();
      void load();
    });
    context?.watchProjectZones?.((zones, meta = {}) => {
      sharedZones = Array.isArray(zones) ? zones : [];
      sharedZonesProjectKeys = new Set(
        (Array.isArray(meta.projectNames) ? meta.projectNames : []).map(toProjectKey).filter(Boolean)
      );
      render();
    });
  }

  return {
    setActive(nextActive) {
      const wasActive = active;
      active = Boolean(nextActive);
      if (!active) {
        loadToken += 1;
        linkDialog?.close();
        return;
      }
      bind();
      if (!wasActive) {
        // Le planning Structure a pu changer pendant que la vue était fermée.
        startsDue = true;
        void load();
      }
    },
    setEditingEnabled(enabled) {
      editingEnabled = Boolean(enabled);
      // Tableau verrouillé : la fenêtre de lien se ferme.
      if (!editingEnabled) linkDialog?.close();
      render();
    },
    setZoneFilter(zoneName) {
      const next = toText(zoneName);
      if (next === zoneFilter) return;
      zoneFilter = next;
      render();
    },
    // Appelée par la surveillance de Planning_Projet de main.js, qui vient de relire
    // la table : le cache partagé est frais, inutile de forcer une nouvelle lecture.
    refresh({ forceRefresh = false } = {}) {
      return load({ forceRefresh });
    },
    // Appelée par la même surveillance : un coffrage déplacé dans le planning Structure
    // déplace la limite de fin du plan de réservations. Le tableau n'écrit que des lignes
    // Synthese : un changement signalé pendant une de ses écritures vient de lui, les
    // coffrages n'ont pas bougé — pas de relecture.
    refreshFormworkStarts() {
      return queuedWrites ? Promise.resolve() : loadStarts();
    },
    // Ce que la fenêtre « Lien Structure » lit du tableau : les lignes telles qu'affichées
    // (écritures en attente comprises) et ce qui permet, ou non, d'y écrire.
    getStructureLinkSource() {
      const editable = isEditable();
      return {
        ready: loaded && !readError,
        rows: displayedRows(),
        editable,
        lockedMessage: editable ? "" : lockedMessage(),
        linkColumn: structureLinkColumn,
      };
    },
    applyStructureLink,
  };
}
