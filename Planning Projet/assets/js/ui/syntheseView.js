// Vue du service Synthese : l'équipe affectée au projet (ProjectTeam) sur une
// chronologie, et en dessous les tâches non affectées. Les tâches sont des
// lignes SYNTHESE de Planning_Projet ; la personne est dans la colonne Ressource.
// La fenêtre de dates suit le bandeau (Semaine / Mois / Année) : la timeline du
// planning reste la référence, cette vue la reflète et lui renvoie les
// déplacements faits à la souris.
import {
  getPlanningWindow,
  setPlanningWindow,
  subscribePlanningWindowChanges,
} from "./timeline.js";
import { isFrenchHoliday } from "../utils/frenchHolidays.js";
import { buildAbsenceIndex, normalizeName } from "../utils/leaveAbsences.js";
import {
  SYNTHESE_TASK_COLUMNS,
  buildSyntheseTaskFields,
  buildSyntheseTasks,
  getProgressState,
  isTaskLate,
  snapToWorkingRange,
} from "../services/syntheseTasks.js";
import { openSyntheseTaskDialog } from "./syntheseTaskDialog.js";
import { bindSyntheseTaskInteractions, toTaskItemId } from "./syntheseTaskInteractions.js";

const PROJECT_TEAM_TABLE = "ProjectTeam";
const PLANNING_TABLE = "Planning_Projet";
const TEAM_TABLE = "Team";
const TIME_OUT_TABLE_CANDIDATES = ["Time-Out", "Time_Out", "TimeOut"];
const TIME_OUT_COLUMNS = {
  owner: "Owner",
  startDate: "Start_Date",
  startPeriod: "Start_Period",
  endDate: "End_Date",
  endPeriod: "End_Period",
  type: "Type",
};
const TEAM_COLUMNS = { email: "Email", prenomNom: "PrenomNom", prenom: "Prenom", nom: "Nom" };
const ROLE_ORDER = ["Ingénieur", "Projeteur"];
const BACKLOG_GROUP = "backlog";
const DAY_MS = 86400000;

let active = false;
let loadToken = 0;
let windowSyncBound = false;
let timeOutTableId = "";
let axis = null;
let top = null;
let bottom = null;
let team = [];
let tasks = [];
let absenceIndex = new Map();
let selectedTaskId = null;
let dropTargetKey = "";

function getElements() {
  const byId = (id) => document.getElementById(id);
  return {
    root: byId("syntheseView"),
    axisHost: byId("syntheseAxis"),
    topHost: byId("syntheseTimeline"),
    bottomHost: byId("syntheseBacklogTimeline"),
    count: byId("syntheseTeamCount"),
    message: byId("syntheseMessage"),
    backlogCount: byId("syntheseBacklogCount"),
    notice: byId("syntheseNotice"),
    tooltip: byId("syntheseTooltip"),
    menu: byId("syntheseContextMenu"),
  };
}

function getContext() {
  return window.GristServiceContext || null;
}

// Comme le planning, la vue ne se modifie qu'une fois « Editer » activé dans le
// bandeau, et seulement si le service sélectionné est modifiable.
let editingEnabled = false;

function hasWriteAccess() {
  return getContext()?.getState?.()?.accessMode === "editable";
}

function isEditable() {
  return editingEnabled && hasWriteAccess();
}

function explainLocked() {
  setNotice(hasWriteAccess()
    ? "Cliquez sur « Editer » dans le bandeau pour créer ou modifier des tâches."
    : "Ce service est en lecture seule pour vous : les tâches ne sont pas modifiables.", "error");
}

function assertEditable() {
  if (isEditable()) return;
  const error = new Error("Vue Synthese verrouillée.");
  error.userMessage = hasWriteAccess()
    ? "L'édition a été verrouillée : cliquez sur « Editer » puis réessayez."
    : "Ce service est en lecture seule pour vous.";
  throw error;
}

function applyEditingState() {
  const editable = isEditable();
  document.body.classList.toggle("is-synthese-readonly", !editable);
  const hint = document.querySelector("#syntheseView .synthese-backlog-hint");
  if (hint) {
    hint.textContent = editable
      ? "Cliquez-glissez dans cette zone pour créer une tâche"
      : hasWriteAccess()
        ? "Cliquez sur « Editer » pour créer ou modifier des tâches"
        : "Lecture seule";
  }
}

export function setSyntheseEditingEnabled(enabled) {
  editingEnabled = Boolean(enabled);
  applyEditingState();
  if (isEditable()) setNotice("");
}

function toText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.slice(value[0] === "L" ? 1 : 0).map(toText).join(", ");
  return String(value).trim();
}

function dayAfter(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function parseDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function setNotice(text, tone = "info") {
  const { notice } = getElements();
  if (!notice) return;
  notice.textContent = text || "";
  notice.dataset.tone = tone;
  notice.hidden = !text;
}

/* ---------- Équipe ---------- */

function roleRank(role) {
  const index = ROLE_ORDER.indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

// Une même personne peut figurer deux fois (casse différente, rôle en double) :
// on n'affiche qu'une ligne par personne. La clé est aussi celle de l'index des
// absences et de la colonne Ressource des tâches.
function buildTeam(rows) {
  const byName = new Map();
  rows.forEach((row) => {
    const name = toText(row?.Name);
    if (!name) return;
    const key = normalizeName(name);
    const role = toText(row?.Role);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { key, name, roles: role ? [role] : [] });
    } else if (role && !existing.roles.includes(role)) {
      existing.roles.push(role);
    }
  });
  return [...byName.values()].sort((left, right) => (
    roleRank(left.roles[0]) - roleRank(right.roles[0]) ||
    left.name.localeCompare(right.name, "fr", { sensitivity: "base" })
  ));
}

function buildInitials(name) {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function buildPersonLabel(group) {
  const wrapper = document.createElement("div");
  wrapper.className = "synthese-person";

  const avatar = document.createElement("span");
  avatar.className = "synthese-person__avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = buildInitials(group.name);

  const text = document.createElement("div");
  text.className = "synthese-person__text";
  const name = document.createElement("span");
  name.className = "synthese-person__name";
  name.textContent = group.name;
  name.title = group.name;
  text.appendChild(name);
  if (group.roles?.length) {
    const role = document.createElement("span");
    role.className = "synthese-person__role";
    role.textContent = group.roles.join(", ");
    text.appendChild(role);
  }

  wrapper.append(avatar, text);
  return wrapper;
}

/* ---------- Fonds : jours non travaillés et absences ---------- */

// Week-ends et jours fériés sous forme de fonds pleine hauteur. Un fond par
// jour garde la grille lisible à tous les zooms, là où les classes de
// vis-timeline ne marquent les week-ends qu'à l'échelle du jour.
function syncOffDays(pane) {
  if (!pane) return;
  const { start, end } = pane.timeline.getWindow();
  const spanMs = Math.max(end - start, 7 * DAY_MS);
  const from = new Date(start.getTime() - spanMs);
  const to = new Date(end.getTime() + spanMs);
  const additions = [];
  for (
    let cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    cursor <= to;
    cursor = dayAfter(cursor)
  ) {
    const weekDay = cursor.getDay();
    const isWeekend = weekDay === 0 || weekDay === 6;
    const isHoliday = !isWeekend && isFrenchHoliday(cursor);
    if (!isWeekend && !isHoliday) continue;
    const key = dateKey(cursor);
    if (pane.offDayKeys.has(key)) continue;
    pane.offDayKeys.add(key);
    additions.push({
      id: `offday:${key}`,
      start: cursor,
      end: dayAfter(cursor),
      type: "background",
      className: isHoliday ? "synthese-offday synthese-offday--holiday" : "synthese-offday",
      title: isHoliday ? "Jour férié" : "",
    });
  }
  if (additions.length) pane.items.add(additions);
}

// Demi-journées d'absence regroupées en plages continues : matin = 0 h-12 h,
// après-midi = 12 h-24 h, pour que le bloc couvre visuellement la bonne moitié.
function buildAbsenceBlocks(personKey, slotKeys) {
  const slots = [...slotKeys].sort().map((slotKey) => {
    const [key, part] = slotKey.split(":");
    const day = parseDateKey(key);
    const startHour = part === "pm" ? 12 : 0;
    return {
      start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour),
      end: new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour + 12),
    };
  });
  const blocks = [];
  slots.forEach((slot) => {
    const previous = blocks[blocks.length - 1];
    if (previous && previous.end.getTime() === slot.start.getTime()) {
      previous.end = slot.end;
    } else {
      blocks.push({ ...slot });
    }
  });
  return blocks.map((block, index) => ({
    id: `absence:${personKey}:${index}`,
    group: personKey,
    start: block.start,
    end: block.end,
    type: "background",
    className: "synthese-absence",
    title: "Absence (Time-Out)",
  }));
}

function renderAbsences() {
  const staleIds = top.items.getIds({ filter: (item) => String(item.id).startsWith("absence:") });
  if (staleIds.length) top.items.remove(staleIds);
  const blocks = team.flatMap((person) => {
    const slotKeys = absenceIndex.get(person.key);
    return slotKeys?.size ? buildAbsenceBlocks(person.key, slotKeys) : [];
  });
  if (blocks.length) top.items.add(blocks);
}

/* ---------- Segments ---------- */

function buildTaskContent(task) {
  const content = document.createElement("div");
  content.className = "synthese-task__body";
  const fill = document.createElement("span");
  fill.className = "synthese-task__fill";
  fill.style.width = `${task.realise}%`;
  const label = document.createElement("span");
  label.className = "synthese-task__label";
  label.textContent = task.name;
  content.append(fill, label);
  return content;
}

function buildTaskItem(task, group) {
  const classes = ["synthese-task", `synthese-task--${getProgressState(task.realise)}`];
  if (isTaskLate(task)) classes.push("synthese-task--late");
  if (task.id === selectedTaskId) classes.push("is-selected");
  return {
    id: toTaskItemId(task.id),
    group,
    start: task.start,
    end: dayAfter(task.end),
    content: buildTaskContent(task),
    className: classes.join(" "),
  };
}

// Mise à jour différentielle des segments d'un volet : la vue ne clignote pas
// et garde son défilement quand une tâche change.
function syncTaskItems(pane, nextItems) {
  const nextIds = new Set(nextItems.map((item) => item.id));
  const staleIds = pane.items.getIds({
    filter: (item) => String(item.id).startsWith("task:") && !nextIds.has(item.id),
  });
  if (staleIds.length) pane.items.remove(staleIds);
  if (nextItems.length) pane.items.update(nextItems);
}

function renderTasks() {
  const teamKeys = new Set(team.map((person) => person.key));
  const assigned = [];
  const backlog = [];
  tasks.forEach((task) => {
    if (task.resourceKey && teamKeys.has(task.resourceKey)) {
      assigned.push(buildTaskItem(task, task.resourceKey));
    } else {
      backlog.push(buildTaskItem(task, BACKLOG_GROUP));
    }
  });
  syncTaskItems(top, assigned);
  syncTaskItems(bottom, backlog);
  const { backlogCount } = getElements();
  if (backlogCount) backlogCount.textContent = String(backlog.length);
}

function renderTeamGroups() {
  const { count } = getElements();
  if (count) count.textContent = team.length ? String(team.length) : "";
  const nextIds = new Set(team.map((person) => person.key));
  const staleIds = top.groups.getIds().filter((id) => !nextIds.has(id));
  if (staleIds.length) top.groups.remove(staleIds);
  top.groups.update(team.map((person, index) => ({
    id: person.key,
    order: index,
    name: person.name,
    roles: person.roles,
    className: person.key === dropTargetKey ? "synthese-person-row is-drop-target" : "synthese-person-row",
  })));
}

function getTask(taskId) {
  return tasks.find((task) => task.id === taskId) || null;
}

function selectTask(taskId) {
  if (selectedTaskId === taskId) return;
  selectedTaskId = taskId;
  renderTasks();
}

function setDropTarget(target) {
  const nextKey = target?.kind === "person" ? target.key : "";
  const { bottomHost } = getElements();
  bottomHost?.classList.toggle("is-drop-target", target?.kind === "backlog");
  if (nextKey === dropTargetKey) return;
  dropTargetKey = nextKey;
  renderTeamGroups();
}

/* ---------- Écritures ---------- */

function describeWriteError(error) {
  const message = String(error?.message || "");
  if (/Ressource/i.test(message)) {
    return "La colonne « Ressource » est absente de Planning_Projet : ajoutez-la (type Texte) puis réessayez.";
  }
  if (/lecture seule|read.?only/i.test(message)) {
    return "Ce service est en lecture seule pour vous : la tâche n'a pas été enregistrée.";
  }
  return "L'enregistrement dans Grist a échoué. Réessayez.";
}

async function applyActions(actions) {
  // Revérifié à l'écriture : l'édition a pu être verrouillée pendant qu'une
  // fenêtre de saisie était ouverte.
  assertEditable();
  const docApi = window.grist?.docApi;
  if (typeof docApi?.applyUserActions !== "function") {
    throw new Error("API Grist indisponible.");
  }
  try {
    await docApi.applyUserActions(actions);
  } catch (error) {
    error.userMessage = describeWriteError(error);
    throw error;
  }
}

async function createTask(values) {
  const state = getContext()?.getState?.();
  const fields = buildSyntheseTaskFields({
    ...values,
    resourceName: "",
    projectName: state?.currentProject?.name,
    service: state?.selectedService,
  });
  await applyActions([["AddRecord", PLANNING_TABLE, null, fields]]);
  setNotice(`Tâche « ${fields[SYNTHESE_TASK_COLUMNS.name]} » créée.`);
  await loadData({ forceRefresh: true });
}

async function updateTask(taskId, values) {
  const fields = buildSyntheseTaskFields(values);
  await applyActions([["UpdateRecord", PLANNING_TABLE, taskId, fields]]);
  await loadData({ forceRefresh: true });
}

async function assignTask(taskId, personKey) {
  const task = getTask(taskId);
  if (!task) return;
  const person = team.find((member) => member.key === personKey) || null;
  const nextName = person ? person.name : "";
  const currentKey = team.some((member) => member.key === task.resourceKey) ? task.resourceKey : "";
  if ((person?.key || "") === currentKey) return;

  // Affichage immédiat, puis relecture : le glisser doit paraître instantané.
  const previous = { resourceName: task.resourceName, resourceKey: task.resourceKey };
  task.resourceName = nextName;
  task.resourceKey = normalizeName(nextName);
  renderTasks();
  try {
    await applyActions([[
      "UpdateRecord",
      PLANNING_TABLE,
      taskId,
      { [SYNTHESE_TASK_COLUMNS.resource]: nextName },
    ]]);
    setNotice(person ? `« ${task.name} » attribuée à ${person.name}.` : `« ${task.name} » n'est plus affectée.`);
    await loadData({ forceRefresh: true });
  } catch (error) {
    console.error("Attribution de la tâche impossible :", error);
    Object.assign(task, previous);
    renderTasks();
    setNotice(error.userMessage || "L'attribution a échoué.", "error");
  }
}

async function deleteTask(taskId) {
  const task = getTask(taskId);
  if (!task) return;
  if (!window.confirm(`Supprimer la tâche « ${task.name} » ?`)) return;
  try {
    await applyActions([["RemoveRecord", PLANNING_TABLE, taskId]]);
    if (selectedTaskId === taskId) selectedTaskId = null;
    setNotice(`Tâche « ${task.name} » supprimée.`);
    await loadData({ forceRefresh: true });
  } catch (error) {
    console.error("Suppression de la tâche impossible :", error);
    setNotice(error.userMessage || "La suppression a échoué.", "error");
  }
}

function openCreateDialog(start, end) {
  const range = snapToWorkingRange(start, end);
  if (!range) {
    setNotice("Ce segment ne contient aucun jour ouvré : dessinez-le sur au moins un jour de semaine.", "error");
    return;
  }
  openSyntheseTaskDialog({
    mode: "create",
    task: { name: "", start: range.start, end: range.end, realise: 0 },
    onSubmit: createTask,
  });
}

function openEditDialog(taskId) {
  const task = getTask(taskId);
  if (!task) return;
  openSyntheseTaskDialog({
    mode: "edit",
    task,
    onSubmit: (values) => updateTask(taskId, values),
  });
}

/* ---------- Timelines ---------- */

function isSameWindow(left, right) {
  return Boolean(left && right) &&
    Math.abs(left.start - right.start) < 1 &&
    Math.abs(left.end - right.end) < 1;
}

function followPlanningWindow(range) {
  if (!active || !range) return;
  [axis, top, bottom].forEach((pane) => {
    if (!pane || isSameWindow(pane.timeline.getWindow(), range)) return;
    pane.timeline.setWindow(range.start, range.end, { animation: false });
  });
}

function defaultWindow() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function createPane(host, options, groups) {
  const items = new window.vis.DataSet([]);
  const groupSet = new window.vis.DataSet(groups);
  const initialWindow = getPlanningWindow() || defaultWindow();
  const timeline = new window.vis.Timeline(host, items, groupSet, {
    locale: "fr",
    orientation: { axis: "top", item: "top" },
    start: initialWindow.start,
    end: initialWindow.end,
    stack: true,
    selectable: false,
    editable: false,
    showTooltips: false,
    groupHeightMode: "auto",
    margin: { item: { horizontal: 0, vertical: 4 }, axis: 0 },
    showCurrentTime: true,
    groupOrder: "order",
    ...options,
  });
  // vis-timeline (8.x) ne retire son écran de chargement, posé par-dessus la vue,
  // qu'après un premier changement de fenêtre quand start/end sont fournis. Sans
  // ce décalage d'une milliseconde, il reste en place et capte toute la souris.
  timeline.setWindow(initialWindow.start, new Date(initialWindow.end.getTime() + 1), {
    animation: false,
  });
  const pane = { host, timeline, items, groups: groupSet, offDayKeys: new Set() };
  timeline.on("rangechanged", () => syncOffDays(pane));
  syncOffDays(pane);
  return pane;
}

const WHEEL_ZOOM_FACTOR = 1.25;
const MIN_VISIBLE_MS = 2 * DAY_MS;
const MAX_VISIBLE_MS = 10 * 365 * DAY_MS;

// Molette sur l'échelle des dates (ou l'en-tête « Chronologie ») : zoom centré
// sur la date sous le curseur. vis n'écoute la molette que sur sa zone
// centrale, masquée sur cette échelle : on la traite nous-mêmes.
function bindHeaderWheelZoom(targets) {
  const onWheel = (event) => {
    if (!top || !event.deltaY) return;
    event.preventDefault();
    const centerRect = top.host.querySelector(".vis-panel.vis-center")?.getBoundingClientRect();
    if (!centerRect?.width) return;
    const { start, end } = top.timeline.getWindow();
    const span = end - start;
    const ratio = Math.min(1, Math.max(0, (event.clientX - centerRect.left) / centerRect.width));
    const pointer = start.getTime() + ratio * span;
    const factor = event.deltaY < 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR;
    const nextSpan = Math.min(MAX_VISIBLE_MS, Math.max(MIN_VISIBLE_MS, span * factor));
    const nextStart = pointer - ratio * nextSpan;
    setPlanningWindow(new Date(nextStart), new Date(nextStart + nextSpan), { byUser: true });
  };
  targets.filter(Boolean).forEach((target) => {
    target.addEventListener("wheel", onWheel, { passive: false });
  });
}

// Glisser l'en-tête de la chronologie déplace la période, à la même vitesse que
// le curseur : la date saisie reste sous la souris. Même raison que pour la
// molette : vis ne gère le glisser que sur sa zone centrale.
function releaseCapture(target, pointerId) {
  try {
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
  } catch (_error) {
    // Capture déjà rendue par le navigateur.
  }
}

function bindHeaderDragPan(targets) {
  let drag = null;

  const onMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const shift = -((event.clientX - drag.startX) / drag.width) * drag.span;
    setPlanningWindow(new Date(drag.start + shift), new Date(drag.end + shift), { byUser: true });
  };
  const onEnd = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    releaseCapture(drag.target, drag.pointerId);
    drag.target.classList.remove("is-panning");
    drag = null;
  };

  targets.filter(Boolean).forEach((target) => {
    target.classList.add("synthese-pannable");
    target.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !top) return;
      const centerRect = top.host.querySelector(".vis-panel.vis-center")?.getBoundingClientRect();
      if (!centerRect?.width) return;
      // vis démarrerait aussi son propre glisser sur l'échelle : on garde la main.
      event.stopPropagation();
      event.preventDefault();
      const { start, end } = top.timeline.getWindow();
      drag = {
        target,
        pointerId: event.pointerId,
        startX: event.clientX,
        width: centerRect.width,
        start: start.getTime(),
        end: end.getTime(),
        span: end - start,
      };
      // La capture garde le glisser actif même si la souris sort de l'en-tête.
      try {
        target.setPointerCapture?.(event.pointerId);
      } catch (_error) {
        // Pointeur déjà relâché : le glisser s'arrêtera au prochain pointerup.
      }
      target.classList.add("is-panning");
    }, true);
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
  });
}

// Trois timelines alignées sur la même fenêtre de dates :
//  - l'échelle des dates, fixe en haut ;
//  - l'équipe, sans échelle, qui s'allonge avec ses lignes et défile dans son
//    conteneur (barre à droite) ;
//  - les tâches non affectées, de hauteur fixe, qui défile de même.
// Le défilement vertical interne de vis élargit la colonne des noms de la largeur
// de sa barre et décalerait les dates entre les volets : on laisse le navigateur
// défiler, et chaque volet réserve la même gouttière de barre (CSS).
function ensureTimelines() {
  if (top) return true;
  const { axisHost, topHost, bottomHost, tooltip, menu } = getElements();
  if (!axisHost || !topHost || !bottomHost || !window.vis?.Timeline) return false;

  axis = createPane(axisHost, {
    zoomable: true,
    moveable: true,
    showCurrentTime: false,
  }, []);
  // Molette simple = défilement de la liste ; Ctrl + molette = zoom, comme sur
  // l'échelle des dates où la molette seule zoome.
  top = createPane(topHost, {
    zoomable: true,
    zoomKey: "ctrlKey",
    moveable: true,
    minHeight: "100%",
    showMajorLabels: false,
    showMinorLabels: false,
    groupTemplate: (group) => (group?.name ? buildPersonLabel(group) : ""),
  }, []);
  // La zone du bas suit la fenêtre du haut ; on n'y déplace pas la vue pour que
  // le clic-glisser y dessine un segment.
  bottom = createPane(bottomHost, {
    zoomable: false,
    moveable: false,
    minHeight: "100%",
    showMajorLabels: false,
    showMinorLabels: false,
    groupTemplate: () => "",
  }, [{ id: BACKLOG_GROUP, order: 0, className: "synthese-backlog-row" }]);

  // Seuls les gestes de l'utilisateur remontent vers le planning : les
  // changements programmatiques viennent déjà de lui.
  const forwardUserRange = ({ byUser, start, end } = {}) => {
    if (byUser) setPlanningWindow(start, end, { byUser: true });
  };
  [axis, top].forEach((pane) => {
    pane.timeline.on("rangechange", forwardUserRange);
    pane.timeline.on("rangechanged", forwardUserRange);
  });
  const headerTargets = [axisHost, document.querySelector("#syntheseView .synthese-header-right")];
  bindHeaderWheelZoom(headerTargets);
  bindHeaderDragPan(headerTargets);

  if (!windowSyncBound) {
    windowSyncBound = true;
    subscribePlanningWindowChanges(followPlanningWindow);
  }

  bindSyntheseTaskInteractions({
    top,
    bottom,
    tooltip,
    menu,
    getTask,
    isEditable,
    onSelect: selectTask,
    onAssign: (taskId, personKey) => void assignTask(taskId, personKey),
    onCreateRange: openCreateDialog,
    onEdit: openEditDialog,
    onDelete: (taskId) => void deleteTask(taskId),
    onDropTargetChange: setDropTarget,
    onLockedAttempt: explainLocked,
  });
  return true;
}

function showMessage(text) {
  const { message, topHost } = getElements();
  if (message) {
    message.textContent = text;
    message.hidden = !text;
  }
  if (topHost) topHost.hidden = Boolean(text);
}

/* ---------- Données ---------- */

async function fetchTimeOutRows(context) {
  const candidates = timeOutTableId ? [timeOutTableId] : TIME_OUT_TABLE_CANDIDATES;
  for (const tableId of candidates) {
    try {
      const rows = await context.fetchContextRows(tableId);
      timeOutTableId = tableId;
      return rows;
    } catch (_error) {
      // Nom de table suivant.
    }
  }
  return [];
}

// Les absences sont un complément : si Team ou Time-Out est illisible, l'équipe
// s'affiche quand même, sans congés.
async function loadAbsenceIndex(context) {
  try {
    const [teamRows, timeOutRows] = await Promise.all([
      context.fetchContextRows(TEAM_TABLE),
      fetchTimeOutRows(context),
    ]);
    return buildAbsenceIndex(timeOutRows, teamRows, TIME_OUT_COLUMNS, TEAM_COLUMNS, []);
  } catch (error) {
    console.warn("Absences Time-Out indisponibles :", error);
    return new Map();
  }
}

async function loadTasks(context, options) {
  try {
    return buildSyntheseTasks(await context.fetchContextRows(PLANNING_TABLE, options));
  } catch (error) {
    console.error("Lecture des tâches Synthese impossible :", error);
    setNotice("Les tâches du projet n'ont pas pu être lues. Rechargez le widget.", "error");
    return [];
  }
}

async function loadData({ forceRefresh = false } = {}) {
  const token = ++loadToken;
  const context = getContext();
  const project = context?.getState?.()?.currentProject;
  if (!project || !top) {
    team = [];
    tasks = [];
    renderTeamGroups();
    renderTasks();
    showMessage("Choisissez un projet pour afficher son équipe.");
    return;
  }

  const readOptions = forceRefresh ? { forceRefresh: true } : {};
  const absencesPromise = loadAbsenceIndex(context);
  const tasksPromise = loadTasks(context, readOptions);
  let teamRows = [];
  try {
    teamRows = await context.fetchContextRows(PROJECT_TEAM_TABLE, readOptions);
  } catch (error) {
    if (token !== loadToken) return;
    console.error("Lecture de ProjectTeam impossible :", error);
    showMessage("L'équipe du projet n'a pas pu être lue. Rechargez le widget.");
  }
  const loadedTasks = await tasksPromise;
  if (token !== loadToken || !active) return;

  team = buildTeam(teamRows);
  tasks = loadedTasks;
  if (selectedTaskId && !getTask(selectedTaskId)) selectedTaskId = null;
  renderTeamGroups();
  renderTasks();
  showMessage(team.length
    ? ""
    : "Personne n'est affecté à ce projet en Synthese. Ajoutez l'équipe dans la table ProjectTeam.");
  top.timeline.redraw();
  bottom.timeline.redraw();

  const loadedAbsences = await absencesPromise;
  if (token !== loadToken || !active) return;
  absenceIndex = loadedAbsences;
  renderAbsences();
}

export function setSyntheseViewActive(nextActive) {
  active = Boolean(nextActive);
  if (!active) {
    loadToken += 1;
    return;
  }
  if (!ensureTimelines()) return;
  applyEditingState();
  // La vue était masquée : vis-timeline doit recalculer ses dimensions.
  requestAnimationFrame(() => {
    if (!active || !top) return;
    followPlanningWindow(getPlanningWindow());
    [axis, top, bottom].forEach((pane) => pane.timeline.redraw());
  });
  void loadData();
}

export function refreshSyntheseView() {
  if (active && top) void loadData({ forceRefresh: true });
}
