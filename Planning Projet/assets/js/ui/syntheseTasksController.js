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
  buildMoveFields,
  buildNewTask,
  buildRowModel,
  buildSections,
  buildTaskFields,
  dateFieldsOf,
  detectFloorColumn,
  detectStructureLinkColumn,
  detectTemplateColumns,
  findGroup,
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
import {
  applyEndLimits,
  applyFloorLinks,
  findFloorStart,
  readFloorLinks,
  reservationEndLimits,
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
  templateFailed: "L'étage n'a pas pu être créé complètement : rien n'a été gardé. Réessayez.",
  noLinkColumn: "La colonne « Lien_Structure » (Texte) manque dans Planning_Projet : ajoutez-la pour lier les étages aux coffrages.",
  floorGone: "Cet étage n'existe plus : fermez la fenêtre puis rouvrez-la.",
  noFloorRow: "Cet étage n'a pas de ligne « étage » dans Planning_Projet : le lien ne peut pas être mémorisé.",
  noPlanTask: "Cet étage n'a pas de tâche « FOND DE PLAN DE SYNTHESE » : aucune date ne peut être posée.",
  badIssueDate: "La date 0 Prev de ce coffrage n'est pas utilisable (elle doit être entre 2000 et 2100) : corrigez-la dans la liste de plans.",
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
    onAddTask: (zoneKey, floorKey = "", groupRowId = null) => handleAddTask(zoneKey, floorKey, groupRowId),
    onAddFloor: (zoneKey) => handleAddFloor(zoneKey),
    onDeleteTask: (taskId) => handleDeleteTask(taskId),
    onDeleteFloor: (zoneKey, floorKey) => handleDeleteFloor(zoneKey, floorKey),
    onDeleteGroup: (groupRowId) => handleDeleteGroup(groupRowId),
    onMoveTask: (taskId, target) => handleMoveTask(taskId, target),
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
    // Le plan de réservations du cycle 3 porte sa limite de fin (début du plan de coffrage de
    // son étage) : le tableau et le Gantt le signalent quand il la dépasse. Chaque étage porte
    // son lien Structure, que son emblème montre.
    const lines = applyFloorLinks(
      applyEndLimits(
        buildRowModel(sections, { collapsedZoneKeys, collapsedFloorKeys, collapsedGroupKeys }),
        reservationEndLimits({ syntheseRows: shownRows, formworkStarts })
      ),
      readFloorLinks(shownRows)
    );
    let emptyMessage = "";
    if (!project) emptyMessage = MESSAGES.noProject;
    else if (!loaded) emptyMessage = MESSAGES.loading;
    else if (readError) emptyMessage = MESSAGES.readFailed;
    else if (!lines.length) emptyMessage = MESSAGES.noZone;
    table.render(lines, {
      editable: isEditable(),
      emptyMessage,
      canAddFloor: floorColumn !== false && templateColumns !== false,
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
    const result = applyTaskEdit(task, field, rawValue, { today: now() });
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
    const actions = [["UpdateRecord", PLANNING_TABLE, taskId, result.fields]];
    if (DATE_FIELDS.has(field)) {
      const updates = cascadeFrom(result.task, allTasks());
      if (updates.length) {
        const fieldsList = updates.map(dateFieldsOf);
        updates.forEach((update, index) => changes.set(update.id, fieldsList[index]));
        actions.push(["BulkUpdateRecord", PLANNING_TABLE, updates.map((update) => update.id), toColumns(fieldsList)]);
      }
    }
    clearStatus();
    void submit(createOp({ changes, actions }), {
      onFailure: (error, dropped) => fail("Modification de la tâche impossible :", error, dropped),
    });
  }

  function findFloor(section, floorKey) {
    return section?.floors.find((floor) => floor.key === floorKey) || null;
  }

  // Nouvelle tâche dans un conteneur : un groupe (cycle ou sous-groupe), un étage, ou le
  // niveau zone.
  function handleAddTask(zoneKey, floorKey = "", groupRowId = null) {
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
    const groupTasks = group
      ? group.tasks
      : floor
        ? floor.tasks
        : section.items.filter((item) => item.kind === "task").map((item) => item.task);
    const task = buildNewTask({
      zoneName: section.zoneName,
      groupName: floor ? floor.name : "",
      groupTasks,
      today: now(),
      parentId: group ? group.rowId : null,
    });
    const fields = buildTaskFields(task, { projectName: project.name });
    const where = group ? `« ${group.name} »` : floor ? `l'étage « ${floor.name} »` : `« ${section.label} »`;
    clearStatus();
    return submit(createOp({ actions: [["AddRecord", PLANNING_TABLE, null, fields]] }), {
      onSuccess: (result) => {
        const newId = Number(result?.retValues?.[0]);
        const hasId = Number.isInteger(newId) && newId > 0;
        if (hasId && !findRow(newId)) rows = [...rows, { id: newId, ...fields }];
        collapsedZoneKeys.delete(section.zoneKey);
        if (floor) collapsedFloorKeys.delete(floorCollapseKey(section.zoneKey, floor.key));
        for (let container = group; container; container = container.parentGroup) {
          collapsedGroupKeys.delete(groupCollapseKey(container.rowId));
        }
        render();
        if (hasId) table.startEditing(newId, "name");
        info(`Tâche ajoutée dans ${where}.`);
      },
      onFailure: (error, dropped) => fail("Ajout de la tâche impossible :", error, dropped),
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
    clearStatus();
    return submit(createOp({
      removals: [taskId],
      actions: [["RemoveRecord", PLANNING_TABLE, taskId]],
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
    clearStatus();
    return submit(createOp({
      removals: floorRemovalIds(floor),
      actions: buildFloorDeleteActions(floor),
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
    clearStatus();
    return submit(createOp({ removals: groupRemovalIds(group), actions: buildGroupDeleteActions(group) }), {
      onSuccess: () => {
        // Même raison que pour un étage supprimé : les ids réutilisés ne doivent pas hériter
        // d'un repli du cycle ou sous-groupe supprimé.
        collapsedGroupKeys.delete(groupCollapseKey(group.rowId));
        (group.groups || []).forEach((child) => collapsedGroupKeys.delete(groupCollapseKey(child.rowId)));
        info(`« ${group.name} » supprimé.`);
      },
      onFailure: (error, dropped) => fail("Suppression impossible :", error, dropped),
    });
  }

  // Glisser-déposer : la tâche change de zone et / ou d'étage ; le conteneur visé est déplié.
  function handleMoveTask(taskId, target) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    const task = findTask(taskId);
    if (!task || !findRow(taskId) || !target) return;
    const fields = buildMoveFields(task, target);
    if (!Object.keys(fields).length) return;
    collapsedZoneKeys.delete(target.zoneKey);
    if (target.floorKey) collapsedFloorKeys.delete(floorCollapseKey(target.zoneKey, target.floorKey));
    for (let container = findGroup(sections, target.groupRowId); container; container = container.parentGroup) {
      collapsedGroupKeys.delete(groupCollapseKey(container.rowId));
    }
    clearStatus();
    void submit(createOp({
      changes: new Map([[taskId, fields]]),
      actions: [["UpdateRecord", PLANNING_TABLE, taskId, fields]],
    }), {
      onFailure: (error, dropped) => fail("Déplacement de la tâche impossible :", error, dropped),
    });
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
