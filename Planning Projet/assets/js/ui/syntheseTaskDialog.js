// Fenêtre de création / modification d'un segment de travail Synthese.
// Déplacer le début garde la durée (le segment glisse), changer la fin ou la
// durée redimensionne le segment. Les dates sont toujours recalées sur des
// jours ouvrés, et l'utilisateur voit quand c'est le cas.
import {
  clampPercent,
  computeRemainingHours,
  computeWorkHours,
  countWorkingDays,
  endAfterWorkingDays,
  formatHours,
  parseGristDate,
  snapToWorkingRange,
  toIsoDate,
} from "../services/syntheseTasks.js";

let current = null;
let bound = false;

function getElements() {
  const root = document.getElementById("syntheseTaskDialog");
  if (!root) return null;
  const byId = (id) => document.getElementById(id);
  return {
    root,
    form: byId("syntheseTaskForm"),
    title: byId("syntheseTaskDialogTitle"),
    name: byId("syntheseTaskName"),
    start: byId("syntheseTaskStart"),
    end: byId("syntheseTaskEnd"),
    duration: byId("syntheseTaskDuration"),
    realise: byId("syntheseTaskRealise"),
    realiseRange: byId("syntheseTaskRealiseRange"),
    work: byId("syntheseTaskWork"),
    remaining: byId("syntheseTaskRemaining"),
    resource: byId("syntheseTaskResource"),
    hint: byId("syntheseTaskHint"),
    error: byId("syntheseTaskError"),
    submit: byId("syntheseTaskSubmit"),
    cancel: byId("syntheseTaskCancel"),
    close: byId("syntheseTaskClose"),
  };
}

function setError(els, message) {
  els.error.textContent = message || "";
  els.error.hidden = !message;
}

function setHint(els, message) {
  els.hint.textContent = message || "";
  els.hint.hidden = !message;
}

function readRange(els) {
  return {
    start: parseGristDate(els.start.value),
    end: parseGristDate(els.end.value),
  };
}

function writeRange(els, range) {
  els.start.value = toIsoDate(range.start);
  els.end.value = toIsoDate(range.end);
  els.duration.value = String(countWorkingDays(range.start, range.end));
}

function refreshWork(els) {
  const days = Number(els.duration.value) || 0;
  const work = computeWorkHours(days);
  const realise = clampPercent(els.realise.value);
  els.work.textContent = formatHours(work);
  els.remaining.textContent = formatHours(computeRemainingHours(work, realise));
}

// Applique une plage demandée : recalage sur jours ouvrés, message si les
// bornes ont bougé, erreur si la plage ne contient aucun jour travaillé.
function applyRange(els, requested) {
  if (!requested.start || !requested.end) {
    setError(els, "Renseignez une date de début et une date de fin.");
    return false;
  }
  if (requested.end < requested.start) {
    setError(els, "La fin doit être après le début.");
    return false;
  }
  const snapped = snapToWorkingRange(requested.start, requested.end);
  if (!snapped) {
    setError(els, "Aucun jour ouvré entre ces dates : choisissez au moins un jour de semaine non férié.");
    return false;
  }
  const moved =
    snapped.start.getTime() !== requested.start.getTime() ||
    snapped.end.getTime() !== requested.end.getTime();
  writeRange(els, snapped);
  setError(els, "");
  setHint(els, moved
    ? "Dates recalées sur les jours ouvrés : un segment ne commence ni ne finit un week-end ou un jour férié."
    : "");
  refreshWork(els);
  return true;
}

function onStartChange(els) {
  const start = parseGristDate(els.start.value);
  if (!start) return applyRange(els, readRange(els));
  const snappedStart = snapToWorkingRange(start, endAfterWorkingDays(start, 1))?.start || start;
  const days = Math.max(1, Number(els.duration.value) || 1);
  return applyRange(els, { start, end: endAfterWorkingDays(snappedStart, days) });
}

function onDurationChange(els) {
  const start = parseGristDate(els.start.value);
  const days = Math.round(Number(els.duration.value));
  if (!start || !(days >= 1)) {
    setError(els, "La durée doit être d'au moins 1 jour ouvré.");
    return false;
  }
  const snappedStart = snapToWorkingRange(start, endAfterWorkingDays(start, 1))?.start || start;
  return applyRange(els, { start, end: endAfterWorkingDays(snappedStart, days) });
}

function syncRealise(els, source) {
  const value = clampPercent(source.value);
  els.realise.value = String(value);
  els.realiseRange.value = String(value);
  refreshWork(els);
}

function close() {
  const els = getElements();
  current = null;
  if (!els) return;
  if (typeof els.root.close === "function" && els.root.open) els.root.close();
  else els.root.removeAttribute("open");
}

function setBusy(els, busy) {
  els.form.querySelectorAll("input, button").forEach((control) => {
    control.disabled = busy;
  });
}

async function submit(els) {
  if (!current) return;
  const name = els.name.value.trim();
  if (!name) {
    setError(els, "Donnez un nom à la tâche.");
    els.name.focus();
    return;
  }
  if (!applyRange(els, readRange(els))) return;
  const { start, end } = readRange(els);
  setBusy(els, true);
  try {
    await current.onSubmit({ name, start, end, realise: clampPercent(els.realise.value) });
    close();
  } catch (error) {
    console.error("Enregistrement du segment impossible :", error);
    setError(els, error?.userMessage || "L'enregistrement a échoué. Réessayez.");
  } finally {
    setBusy(els, false);
  }
}

function bindOnce(els) {
  if (bound) return;
  bound = true;
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit(els);
  });
  els.start.addEventListener("change", () => onStartChange(els));
  els.end.addEventListener("change", () => applyRange(els, readRange(els)));
  els.duration.addEventListener("change", () => onDurationChange(els));
  els.realise.addEventListener("input", () => syncRealise(els, els.realise));
  els.realiseRange.addEventListener("input", () => syncRealise(els, els.realiseRange));
  els.cancel.addEventListener("click", close);
  els.close.addEventListener("click", close);
  els.root.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
}

// task : { name, start, end, realise, resourceName }. onSubmit reçoit
// { name, start, end, realise } et lève une erreur (avec userMessage) en cas d'échec.
export function openSyntheseTaskDialog({ mode = "create", task = {}, onSubmit } = {}) {
  const els = getElements();
  if (!els || typeof onSubmit !== "function") return;
  bindOnce(els);
  current = { mode, onSubmit };

  els.title.textContent = mode === "edit" ? "Modifier la tâche" : "Nouvelle tâche";
  els.submit.textContent = mode === "edit" ? "Enregistrer" : "Créer la tâche";
  els.name.value = task.name || "";
  els.resource.textContent = task.resourceName || "Non affectée";
  const realise = clampPercent(task.realise);
  els.realise.value = String(realise);
  els.realiseRange.value = String(realise);
  setError(els, "");
  setHint(els, "");
  applyRange(els, { start: task.start, end: task.end });

  if (typeof els.root.showModal === "function") {
    if (!els.root.open) els.root.showModal();
  } else {
    els.root.setAttribute("open", "");
  }
  els.name.focus();
  els.name.select();
}
