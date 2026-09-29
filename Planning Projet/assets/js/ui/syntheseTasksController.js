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
  buildFloorFields,
  buildFloorRenameActions,
  buildMoveFields,
  buildNewTask,
  buildRowModel,
  buildSections,
  buildTaskFields,
  detectFloorColumn,
  floorCollapseKey,
  floorKeyOf,
  nextFloorName,
  validateFloorName,
} from "../services/syntheseTaskModel.js";

const SAVING_DELAY_MS = 1000;

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
});

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
  // Grist refuse une colonne inconnue : seule l'écriture d'un étage utilise Etage.
  if (/\bEtage\b/.test(message)) return MESSAGES.noFloorColumn;
  return "L'enregistrement dans Grist a échoué. Réessayez.";
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
  const collapsedZoneKeys = new Set();
  const collapsedFloorKeys = new Set();
  // Colonne Etage : true / false d'après les lignes lues, null tant qu'on ne sait pas.
  let floorColumn = null;
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
    onAddTask: (zoneKey, floorKey = "") => handleAddTask(zoneKey, floorKey),
    onAddFloor: (zoneKey) => handleAddFloor(zoneKey),
    onDeleteTask: (taskId) => handleDeleteTask(taskId),
    onDeleteFloor: (zoneKey, floorKey) => handleDeleteFloor(zoneKey, floorKey),
    onMoveTask: (taskId, target) => handleMoveTask(taskId, target),
    onToggleZone: (zoneKey) => toggleZone(zoneKey),
    onToggleFloor: (zoneKey, floorKey) => toggleFloor(zoneKey, floorKey),
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
    sections = project
      ? buildSections({ rows: displayedRows(), sharedZones: getSharedZones(project), zoneFilter })
      : [];
    const lines = buildRowModel(sections, { collapsedZoneKeys, collapsedFloorKeys });
    let emptyMessage = "";
    if (!project) emptyMessage = MESSAGES.noProject;
    else if (!loaded) emptyMessage = MESSAGES.loading;
    else if (readError) emptyMessage = MESSAGES.readFailed;
    else if (!lines.length) emptyMessage = MESSAGES.noZone;
    table.render(lines, { editable: isEditable(), emptyMessage, canAddFloor: floorColumn !== false });
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
      floorColumn = null;
      rows = [];
      loaded = false;
      readError = false;
      render();
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
  // lignes retirées), ses actions Grist et le contexte où elle a été demandée.
  function createOp({ changes = new Map(), removals = [], actions }) {
    return { changes, removals: new Set(removals), actions, context: captureContext() };
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
        result = await write(op.actions);
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

  // Saisie : affichée tout de suite, enregistrée ensuite en arrière-plan, dans l'ordre. Le
  // tableau passe aussitôt à la cellule suivante : rien de ce qui est tapé entre-temps
  // n'est perdu.
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
    clearStatus();
    void submit(createOp({
      changes: new Map([[taskId, result.fields]]),
      actions: [["UpdateRecord", PLANNING_TABLE, taskId, result.fields]],
    }), {
      onFailure: (error, dropped) => fail("Modification de la tâche impossible :", error, dropped),
    });
  }

  function findFloor(section, floorKey) {
    return section?.floors.find((floor) => floor.key === floorKey) || null;
  }

  // Nouvelle tâche dans un groupe : l'étage floorKey, ou le niveau zone ("").
  function handleAddTask(zoneKey, floorKey = "") {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const project = getProject();
    const section = findSection(zoneKey);
    const floor = floorKey ? findFloor(section, floorKey) : null;
    if (!project || !section || (floorKey && !floor)) return Promise.resolve();
    const groupTasks = floor
      ? floor.tasks
      : section.items.filter((item) => item.kind === "task").map((item) => item.task);
    const task = buildNewTask({
      zoneName: section.zoneName,
      groupName: floor ? floor.name : "",
      groupTasks,
      today: now(),
    });
    const fields = buildTaskFields(task, { projectName: project.name });
    const where = floor ? `l'étage « ${floor.name} »` : `« ${section.label} »`;
    clearStatus();
    return submit(createOp({ actions: [["AddRecord", PLANNING_TABLE, null, fields]] }), {
      onSuccess: (result) => {
        const newId = Number(result?.retValues?.[0]);
        const hasId = Number.isInteger(newId) && newId > 0;
        if (hasId && !findRow(newId)) rows = [...rows, { id: newId, ...fields }];
        collapsedZoneKeys.delete(zoneKey);
        if (floor) collapsedFloorKeys.delete(floorCollapseKey(zoneKey, floor.key));
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

  function handleAddFloor(zoneKey) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    if (floorColumn === false) {
      setStatus(MESSAGES.noFloorColumn, "error");
      return Promise.resolve();
    }
    const project = getProject();
    const section = findSection(zoneKey);
    if (!project || !section || section.zoneKey === NO_ZONE_KEY) return Promise.resolve();
    const name = nextFloorName(section.floors);
    const fields = buildFloorFields({ name, zoneName: section.zoneName, projectName: project.name });
    clearStatus();
    return submit(createOp({ actions: [["AddRecord", PLANNING_TABLE, null, fields]] }), {
      onSuccess: (result) => {
        const newId = Number(result?.retValues?.[0]);
        const hasId = Number.isInteger(newId) && newId > 0;
        if (hasId && !findRow(newId)) rows = [...rows, { id: newId, ...fields }];
        collapsedZoneKeys.delete(zoneKey);
        render();
        if (hasId) table.startEditingFloor(zoneKey, floorKeyOf(name));
        info(`Étage ajouté dans « ${section.label} ».`);
      },
      onFailure: (error, dropped) => {
        if (describeWriteError(error) === MESSAGES.noFloorColumn) {
          floorColumn = false;
          render();
        }
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
    const changes = new Map();
    floor.rowIds.forEach((rowId) => changes.set(rowId, { [TASK_COLUMNS.name]: result.name }));
    floor.tasks.forEach((task) => changes.set(task.id, { [TASK_COLUMNS.group]: result.name }));
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
      removals: [...floor.rowIds, ...floor.tasks.map((task) => task.id)],
      actions: buildFloorDeleteActions(floor),
    }), {
      onSuccess: () => info(`Étage « ${floor.name} » supprimé.`),
      onFailure: (error, dropped) => fail("Suppression de l'étage impossible :", error, dropped),
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
    clearStatus();
    void submit(createOp({
      changes: new Map([[taskId, fields]]),
      actions: [["UpdateRecord", PLANNING_TABLE, taskId, fields]],
    }), {
      onFailure: (error, dropped) => fail("Déplacement de la tâche impossible :", error, dropped),
    });
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
      if (!wasActive) void load();
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
  };
}
