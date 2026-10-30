// Contrôles de cohérence de la vue Global (Planning Projet) : retard de la Synthèse par
// rapport à Structure (tâche contrôlée, démarrage du gros œuvre), fond de plan à mettre à
// jour, coffrage introuvable, retard d'un document Structure ; puis ce que chaque ligne
// affiche dans sa colonne « État » et les compteurs de la barre d'état.
// Module pur, sans DOM ni Grist. Les retards se comptent en jours calendaires.
import { formatDate } from "./syntheseTaskModel.js";

const DAY_MS = 86400000;

// Familles d'alertes, de la plus grave à la moins grave.
export const FAMILIES = Object.freeze(["synthese", "missing", "stale", "structure"]);

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function toDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function plural(count) {
  return count > 1 ? "s" : "";
}

// Nombre de jours calendaires de `from` à `to` (négatif si `to` est avant).
export function daysBetween(from, to) {
  if (!(from instanceof Date) || !(to instanceof Date)) return 0;
  return Math.round((toDay(to).getTime() - toDay(from).getTime()) / DAY_MS);
}

export function emptyCounts() {
  return { synthese: 0, missing: 0, stale: 0, structure: 0 };
}

export function addCounts(target, source) {
  FAMILIES.forEach((family) => {
    target[family] += source?.[family] || 0;
  });
  return target;
}

export function hasAlerts(counts) {
  return FAMILIES.some((family) => counts?.[family] > 0);
}

export function countAlerts(alerts) {
  const counts = emptyCounts();
  (alerts || []).forEach((alert) => {
    if (alert?.family in counts) counts[alert.family] += 1;
  });
  return counts;
}

// Retard d'un document Structure. Non terminé : jours entre sa Fin et aujourd'hui ; une
// justification (Remarque) le passe en orange. Terminé : le retard stocké reste lisible,
// sans alerte. Renvoie l'alerte (ou null), ce que la ligne affiche (ou null) et l'infobulle.
export function checkDocument(doc, today) {
  if (Number(doc?.realise) >= 100) {
    const stored = Number(doc?.storedRetard);
    const text = stored > 0 ? `terminé (retard ${stored} j)` : "terminé";
    return { alert: null, part: { text, tone: "muted" }, title: "" };
  }
  const days = doc?.end instanceof Date ? Math.max(0, daysBetween(doc.end, today)) : 0;
  if (!days) return { alert: null, part: null, title: "" };
  const justification = toText(doc.remarque);
  const tone = justification ? "warn" : "error";
  const text = justification ? `retard ${days} j (justifié)` : `retard ${days} j`;
  const title = justification
    ? `Retard justifié : ${justification}`
    : `Fin prévue le ${formatDate(doc.end)} : ${days} j de retard.`;
  return {
    alert: { code: "docLate", family: "structure", tone, days, text, title },
    part: { text, tone },
    title,
  };
}

function lateAlert(code, days, title) {
  return { code, family: "synthese", tone: "late", days, text: `retard ${days} j`, title };
}

// Contrôles d'un étage de Synthèse. `tasks` : ses tâches ; `link` : l'étage vu par
// buildStructureLink (state, formworkNumber, formwork) ; `controls` : les tâches contrôlées
// (readControlTasks) ; `limits` : leur limite de fin (controlTaskEndLimits) ; `worksStart` : le
// plus ancien « Démarrage travaux » du coffrage et de ses armatures.
// Renvoie : linked (un coffrage est trouvé), alerts (portées par l'étage : à mettre à jour,
// coffrage introuvable), taskAlerts (id de tâche → alertes de retard), unverifiable (raisons)
// et passed (nombre de contrôles faits et passés).
export function checkFloor({ tasks = [], link = null, controls = new Map(), limits = new Map(), worksStart = null } = {}) {
  const result = { linked: false, alerts: [], taskAlerts: new Map(), unverifiable: [], passed: 0 };
  const state = link?.state || "none";
  if (state === "none") return result;
  const number = toText(link.formworkNumber);
  if (state === "missing") {
    result.alerts.push({
      code: "missing",
      family: "missing",
      tone: "error",
      days: 0,
      text: `coffrage ${number} introuvable`,
      title: `Le coffrage ${number} mémorisé sur cet étage n'existe plus dans le planning Structure.`,
    });
    return result;
  }
  result.linked = true;
  const list = Array.isArray(tasks) ? tasks : [];
  const addTaskAlert = (taskId, alert) => {
    if (!result.taskAlerts.has(taskId)) result.taskAlerts.set(taskId, []);
    result.taskAlerts.get(taskId).push(alert);
  };

  // 1. La tâche contrôlée finit au plus tard le jour où commence le plan de coffrage.
  const controlled = list.filter((task) => controls.has(task.id));
  if (!controlled.length) {
    result.unverifiable.push("pas de tâche contrôlée dans l'étage");
  } else {
    let late = 0;
    let checked = 0;
    controlled.forEach((task) => {
      const entry = limits.get(task.id);
      if (!entry) {
        const reason = `le coffrage ${number} n'a pas de date de début`;
        if (!result.unverifiable.includes(reason)) result.unverifiable.push(reason);
        return;
      }
      if (!(task.end instanceof Date)) {
        result.unverifiable.push(`la tâche contrôlée « ${task.name} » n'a pas de date de fin`);
        return;
      }
      checked += 1;
      if (task.end <= entry.limit) return;
      late += 1;
      addTaskAlert(task.id, lateAlert(
        "late",
        daysBetween(entry.limit, task.end),
        `Fin trop tardive : à finir au plus tard le ${formatDate(entry.limit)} ` +
          `(début du plan de coffrage ${entry.formworkNumber} dans le planning Structure).`
      ));
    });
    if (checked && !late) result.passed += 1;
  }

  // 2. Le jalon de démarrage du gros œuvre ne tombe pas après le démarrage des travaux.
  const kickoff = list
    .filter((task) => task.natureKey === "demarrage")
    .sort((left, right) => left.id - right.id)[0];
  if (!(kickoff?.start instanceof Date)) {
    result.unverifiable.push("pas de jalon de démarrage daté dans l'étage");
  } else if (!(worksStart instanceof Date)) {
    result.unverifiable.push(`aucun démarrage des travaux pour le coffrage ${number}`);
  } else if (kickoff.start > worksStart) {
    addTaskAlert(kickoff.id, lateAlert(
      "goLate",
      daysBetween(worksStart, kickoff.start),
      `Démarrage prévu après le démarrage des travaux de Structure (${formatDate(worksStart)}).`
    ));
  } else {
    result.passed += 1;
  }

  // 3. Le fond de plan démarre à la date 0 Prev du coffrage.
  if (state === "stale") {
    result.alerts.push({
      code: "stale",
      family: "stale",
      tone: "warn",
      days: 0,
      text: `à mettre à jour : 0 Prev le ${formatDate(link.formwork?.issueDate)}`,
      title: `Le fond de plan de synthèse ne démarre pas à la date 0 Prev du coffrage ${number} (${formatDate(link.formwork?.issueDate)}).`,
    });
  } else if (state === "noPlan") {
    result.unverifiable.push("pas de tâche « FOND DE PLAN DE SYNTHESE » dans l'étage");
  } else if (state === "waiting") {
    result.unverifiable.push(`le coffrage ${number} n'a pas de date 0 Prev`);
  } else {
    result.passed += 1;
  }
  return result;
}

// Toutes les alertes d'un étage : les siennes, puis celles de ses tâches.
export function floorAlerts(check) {
  return [...(check?.alerts || []), ...[...(check?.taskAlerts?.values() || [])].flat()];
}

function joinTitles(lines) {
  return lines.filter(Boolean).join("\n");
}

function unverifiableLines(reasons) {
  return (reasons || []).map((reason) => `Non vérifiable : ${reason}.`);
}

// État d'une tâche en retard : le plus grand de ses retards.
export function taskState(alerts) {
  if (!alerts?.length) return null;
  const days = Math.max(...alerts.map((alert) => alert.days));
  return {
    parts: [{ text: `retard ${days} j`, tone: "late" }],
    title: joinTitles(alerts.map((alert) => alert.title)),
  };
}

// Résumé du contenu d'une ligne (cycle, étage, zone) : une part par famille, la plus grave
// d'abord ; null sans alerte.
export function summaryState(counts) {
  const parts = [];
  if (counts?.synthese) {
    parts.push({ text: `${counts.synthese} retard${plural(counts.synthese)} Synthèse`, tone: "late" });
  }
  if (counts?.missing) {
    parts.push({
      text: `${counts.missing} coffrage${plural(counts.missing)} introuvable${plural(counts.missing)}`,
      tone: "error",
    });
  }
  if (counts?.stale) parts.push({ text: `${counts.stale} à mettre à jour`, tone: "warn" });
  if (counts?.structure) {
    parts.push({ text: `${counts.structure} retard${plural(counts.structure)} Structure`, tone: "error" });
  }
  return parts.length ? { parts, title: "" } : null;
}

// État d'une ligne « Synthèse · étage ». `check` : checkFloor ; `link` : l'étage vu par
// buildStructureLink ; `counts` : les alertes de son contenu ; `otherZoneLabel` : la zone du
// coffrage quand elle n'est pas celle de l'étage.
export function floorState({ check, link, counts, otherZoneLabel = "" } = {}) {
  const state = link?.state || "none";
  if (state === "none") {
    return { parts: [{ text: "non lié à un coffrage", tone: "muted" }], title: "" };
  }
  const parts = (check?.alerts || []).map((alert) => ({ text: alert.text, tone: alert.tone }));
  if (counts?.synthese) {
    parts.unshift({ text: `${counts.synthese} retard${plural(counts.synthese)} Synthèse`, tone: "late" });
  }
  if (otherZoneLabel) {
    parts.push({ text: `lié au coffrage ${toText(link.formworkNumber)} (${otherZoneLabel})`, tone: "muted" });
  }
  if (!parts.length) return null;
  return {
    parts,
    title: joinTitles([...floorAlerts(check).map((alert) => alert.title), ...unverifiableLines(check?.unverifiable)]),
  };
}

// État d'un niveau lié (étage ⇄ coffrage). `checks` : checkFloor de chacun de ses étages ;
// `counts` : les alertes de tout son contenu (étages, coffrage, armatures).
export function levelState({ checks = [], counts = emptyCounts() } = {}) {
  const alerts = checks.flatMap(floorAlerts);
  const late = alerts.filter((alert) => alert.family === "synthese");
  const stale = alerts.filter((alert) => alert.family === "stale");
  const unverifiable = checks.flatMap((check) => check.unverifiable || []);
  const passed = checks.reduce((total, check) => total + (check.passed || 0), 0);
  const parts = [];
  if (late.length) {
    const days = Math.max(...late.map((alert) => alert.days));
    parts.push({ text: `Synthèse en retard de ${days} j`, tone: "late" });
  }
  if (stale.length) {
    parts.push({ text: stale.length > 1 ? `${stale.length} à mettre à jour` : "à mettre à jour", tone: "warn" });
  }
  if (!parts.length) {
    if (!passed) parts.push({ text: "non vérifiable", tone: "muted" });
    else if (unverifiable.length) {
      parts.push({
        text: `✓ cohérent (${unverifiable.length} contrôle${plural(unverifiable.length)} non vérifiable${plural(unverifiable.length)})`,
        tone: "muted",
      });
    } else parts.push({ text: "✓ cohérent", tone: "ok" });
  }
  if (counts?.structure) {
    parts.push({ text: `${counts.structure} retard${plural(counts.structure)} Structure`, tone: "error" });
  }
  return { parts, title: joinTitles([...alerts.map((alert) => alert.title), ...unverifiableLines(unverifiable)]) };
}

// État d'un coffrage : le sien (checkDocument), puis ses armatures en retard.
export function formworkState({ own = null, lateRebars = 0 } = {}) {
  const parts = own?.part ? [own.part] : [];
  if (lateRebars) {
    parts.push({ text: `${lateRebars} armature${plural(lateRebars)} en retard`, tone: "error" });
  }
  return parts.length ? { parts, title: own?.title || "" } : null;
}

// Phrase de la barre d'état. `totals` : linkedFloors, unlinkedFloors et les compteurs d'alertes.
export function describeCounts(totals = {}) {
  const linked = totals.linkedFloors || 0;
  const unlinked = totals.unlinkedFloors || 0;
  const synthese = totals.synthese || 0;
  const stale = totals.stale || 0;
  const structure = totals.structure || 0;
  const missing = totals.missing || 0;
  const parts = [
    `${linked} étage${plural(linked)} lié${plural(linked)}`,
    `${unlinked} non lié${plural(unlinked)}`,
    `${synthese} retard${plural(synthese)} Synthèse`,
    `${stale} à mettre à jour`,
    `${structure} retard${plural(structure)} Structure`,
  ];
  if (missing) parts.push(`${missing} coffrage${plural(missing)} introuvable${plural(missing)}`);
  return parts.join(" · ");
}
