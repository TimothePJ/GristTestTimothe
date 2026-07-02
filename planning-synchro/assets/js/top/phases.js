// Planning_Projet phase model + Type-doc aggregation for the top (read-only) pane.
// No top-level access to window/document/localStorage: safe to import under Node.
//
// normalizePlanningDocumentType is ported verbatim from
// `gestion-depenses2/assets/js/utils/planningRealisation.js` (~lines 1-48).
//
// The phase construction rules (which columns feed each phase type) and the
// tooltip builder (buildPhaseTooltipHtml / getPhaseTooltipMetaFromClassName)
// are ported/adapted from `Planning Projet/assets/js/ui/timeline.js`
// (~lines 603-641, 764-929) and `Planning Projet/assets/js/services/planningService.js`
// (~lines 118-144, 1803-2046: isCoffrageTypeDoc/isArmaturesTypeDoc/.../isCustomTypeDoc
// gating and the Date_limite/Diff_coffrage/Diff_armature/Demarrages_travaux -> phase
// mapping). Business-day splitting, retard-based styling and zone-header grouping
// from the source file are intentionally NOT ported: this is a simplified read-only
// model for the mini top-pane timeline (see task-6 brief for the exact rules).
// Type-doc aggregation (aggregatePlanningItems, aggregateTasks) is NEW logic; the
// source codebase only *consumes* an `aggregateTasks` shape in its tooltip, it never
// builds one.

import { parseCalendarDate, formatIsoDate, toText } from "../utils/dates.js";

// --- normalizePlanningDocumentType (ported) ---------------------------------

function toCleanText(value) {
  return String(value ?? "").trim();
}

function normalizeLookupText(value) {
  return toCleanText(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function normalizeCompactLookupText(value) {
  return normalizeLookupText(value).replace(/\s+/g, "");
}

export function normalizePlanningDocumentType(value) {
  const normalized = normalizeLookupText(value);
  const compact = normalizeCompactLookupText(value);

  if (
    compact === "NDC" ||
    normalized.includes("NOTE DE CALCUL") ||
    normalized.includes("NOTES DE CALCUL") ||
    normalized.includes("NOTE CALCUL") ||
    normalized.includes("NOTES CALCUL")
  ) {
    return "NDC";
  }

  if (normalized.includes("COFFRAGE")) return "COFFRAGE";
  if (normalized.includes("ARMATURE")) return "ARMATURES";
  if (
    normalized.includes("DEMOLITION") ||
    compact.includes("DEMOLITION") ||
    (normalized.startsWith("D") && normalized.includes("MOLITION"))
  ) {
    return "DEMOLITION";
  }
  if (normalized.includes("COUPE")) return "COUPES";

  return normalized || "NON SPECIFIE";
}

const TYPE_DISPLAY_LABELS = {
  COFFRAGE: "Coffrage",
  ARMATURES: "Armature",
  NDC: "NDC",
  COUPES: "COUPES",
  DEMOLITION: "DÉMOLITION",
};

function getTypeDisplayLabel(typeKey, rawTypeDoc) {
  return TYPE_DISPLAY_LABELS[typeKey] || rawTypeDoc || typeKey || "Type personnalisé";
}

// --- phase construction -------------------------------------------------------

function getRowTaskLabel(row, columns) {
  return toText(row?.[columns.taskName]) || toText(row?.[columns.taskNameAlt]);
}

export function buildRowPhases(row, columns) {
  const taskLabel = getRowTaskLabel(row, columns);
  const rawTypeDoc = toText(row?.[columns.typeDoc]);

  // Zone-only row: no task and no document type carried by this row.
  if (!taskLabel && !rawTypeDoc) return [];

  const typeDoc = normalizePlanningDocumentType(rawTypeDoc);
  const phases = [];

  const pushRangePhase = (type, className, start, end, label) => {
    if (!start || !end) return;
    phases.push({ type, className, start, end, label, taskLabel });
  };

  const dateLimite = parseCalendarDate(row?.[columns.dateLimite]);
  const diffCoffrage = parseCalendarDate(row?.[columns.diffCoffrage]);
  const diffArmature = parseCalendarDate(row?.[columns.diffArmature]);

  if (typeDoc === "COFFRAGE") {
    pushRangePhase("coffrage", "phase-coffrage", dateLimite, diffCoffrage, "Coffrage");
  } else if (typeDoc === "ARMATURES") {
    pushRangePhase("armature", "phase-armature", diffCoffrage, diffArmature, "Armature");
  } else if (typeDoc === "NDC") {
    pushRangePhase("ndc", "phase-ndc", dateLimite, diffCoffrage, "NDC");
  } else if (typeDoc === "COUPES") {
    pushRangePhase("coupes", "phase-coupes", dateLimite, diffCoffrage, "COUPES");
  } else if (typeDoc === "DEMOLITION") {
    pushRangePhase("demolition", "phase-demolition", dateLimite, diffCoffrage, "DÉMOLITION");
  } else if (rawTypeDoc) {
    // Custom/unrecognized non-empty type doc -> generic phase.
    pushRangePhase("generic", "phase-generic", dateLimite, diffCoffrage, rawTypeDoc);
  }

  const demarrage = parseCalendarDate(row?.[columns.demarragesTravaux]);
  if (demarrage) {
    phases.push({
      type: "demarrage",
      className: "phase-demarrage",
      start: demarrage,
      end: demarrage,
      label: "Début des travaux",
      taskLabel,
    });
  }

  return phases;
}

// --- non-aggregated view: 1 group per Ligne_planning (fallback task label) ---

export function buildPlanningItems(rows, columns) {
  const groups = [];
  const groupByKey = new Map();
  const items = [];
  let itemSeq = 0;

  (rows || []).forEach((row, rowIndex) => {
    const phases = buildRowPhases(row, columns);
    if (!phases.length) return;

    const taskLabel = getRowTaskLabel(row, columns);
    const lignePlanning = toText(row?.[columns.lignePlanning]);
    const groupKey = lignePlanning || taskLabel || `__row-${rowIndex}`;

    let group = groupByKey.get(groupKey);
    if (!group) {
      const rawTypeDoc = toText(row?.[columns.typeDoc]);
      group = {
        id: `g-${groupKey}`,
        label: taskLabel || groupKey,
        typeDoc: normalizePlanningDocumentType(rawTypeDoc),
      };
      groupByKey.set(groupKey, group);
      groups.push(group);
    }

    phases.forEach((phase) => {
      const item = {
        id: `i-${itemSeq++}`,
        group: group.id,
        start: phase.start,
        end: phase.end,
        className: phase.className,
        taskLabel: phase.taskLabel,
        phaseLabel: phase.label,
      };
      item.tooltip = buildPhaseTooltipHtml(item);
      items.push(item);
    });
  });

  return { groups, items };
}

// --- aggregated view: 1 group per Type_doc, overlapping same-type phases merged ---

export function aggregatePlanningItems(rows, columns) {
  const groupByType = new Map();

  (rows || []).forEach((row) => {
    const phases = buildRowPhases(row, columns);
    if (!phases.length) return;

    const rawTypeDoc = toText(row?.[columns.typeDoc]);
    const typeKey = normalizePlanningDocumentType(rawTypeDoc);

    let group = groupByType.get(typeKey);
    if (!group) {
      group = {
        id: `type-${typeKey}`,
        label: getTypeDisplayLabel(typeKey, rawTypeDoc),
        typeDoc: typeKey,
        bucketsByPhaseType: new Map(),
      };
      groupByType.set(typeKey, group);
    }

    phases.forEach((phase) => {
      if (!group.bucketsByPhaseType.has(phase.type)) {
        group.bucketsByPhaseType.set(phase.type, []);
      }
      group.bucketsByPhaseType.get(phase.type).push(phase);
    });
  });

  const groups = [];
  const items = [];
  let itemSeq = 0;

  groupByType.forEach((group) => {
    groups.push({ id: group.id, label: group.label, typeDoc: group.typeDoc });

    group.bucketsByPhaseType.forEach((phaseList) => {
      const sorted = [...phaseList].sort((a, b) => a.start - b.start);
      let current = null;

      const flush = () => {
        if (!current) return;
        const item = {
          id: `i-${itemSeq++}`,
          group: group.id,
          start: current.start,
          end: current.end,
          className: current.className,
          taskLabel: current.tasks.map((t) => t.label).filter(Boolean).join(", "),
          phaseLabel: current.phaseLabel,
        };
        if (current.tasks.length > 1) {
          item.aggregateTasks = current.tasks;
        }
        item.tooltip = buildPhaseTooltipHtml(item);
        items.push(item);
        current = null;
      };

      sorted.forEach((phase) => {
        const task = { label: phase.taskLabel, start: phase.start, end: phase.end };

        if (!current) {
          current = {
            className: phase.className,
            phaseLabel: phase.label,
            start: phase.start,
            end: phase.end,
            tasks: [task],
          };
          return;
        }

        if (phase.start <= current.end) {
          if (phase.end > current.end) current.end = phase.end;
          current.tasks.push(task);
        } else {
          flush();
          current = {
            className: phase.className,
            phaseLabel: phase.label,
            start: phase.start,
            end: phase.end,
            tasks: [task],
          };
        }
      });

      flush();
    });
  });

  return { groups, items };
}

// --- first phase date ---------------------------------------------------------

export function getFirstPhaseDate(rows, columns) {
  let earliest = null;

  (rows || []).forEach((row) => {
    buildRowPhases(row, columns).forEach((phase) => {
      if (!earliest || phase.start < earliest) earliest = phase.start;
    });
  });

  return earliest ? formatIsoDate(earliest) : "";
}

// --- tooltip (port of buildPhaseTooltipHtml / getPhaseTooltipMetaFromClassName) ---

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTooltipDate(date) {
  return formatIsoDate(date instanceof Date ? date : null) || "—";
}

function getPhaseTooltipMetaFromClassName(className) {
  const cls = String(className || "");

  if (cls.includes("phase-coffrage")) {
    return { label: "Coffrage", startLabel: "Date limite", endLabel: "Diff coffrage" };
  }
  if (cls.includes("phase-armature")) {
    return { label: "Armature", startLabel: "Diff coffrage", endLabel: "Diff armature" };
  }
  if (cls.includes("phase-ndc")) {
    return { label: "NDC", startLabel: "Date limite", endLabel: "Diff coffrage" };
  }
  if (cls.includes("phase-coupes")) {
    return { label: "COUPES", startLabel: "Date limite", endLabel: "Diff coffrage" };
  }
  if (cls.includes("phase-demolition")) {
    return { label: "DÉMOLITION", startLabel: "Date limite", endLabel: "Diff coffrage" };
  }
  if (cls.includes("phase-generic")) {
    return { label: "Type personnalisé", startLabel: "Date limite", endLabel: "Diff coffrage" };
  }

  return null;
}

export function buildPhaseTooltipHtml(item) {
  const cls = String(item?.className || "");
  const tache = String(item?.taskLabel || "Tache");
  const start = item?.start;
  const end = item?.end;
  const aggregateTasks = Array.isArray(item?.aggregateTasks)
    ? item.aggregateTasks.filter(Boolean)
    : [];

  if (aggregateTasks.length > 0) {
    const meta = getPhaseTooltipMetaFromClassName(cls) || {
      label: "Phase",
      startLabel: "Debut",
      endLabel: "Fin",
    };
    const label = cls.includes("phase-generic")
      ? String(item?.phaseLabel || "Type personnalisé")
      : meta.label;

    const rows = aggregateTasks
      .map((task) => {
        const taskLabel = escapeHtml(task.label || "Tache");
        const startLabel = escapeHtml(formatTooltipDate(task.start));
        const endLabel = escapeHtml(formatTooltipDate(task.end));
        return `<div><strong>${taskLabel}</strong> : ${meta.startLabel} ${startLabel} -> ${meta.endLabel} ${endLabel}</div>`;
      })
      .join("");

    return `
      <div><strong>${escapeHtml(label)}</strong></div>
      ${rows}
    `;
  }

  if (cls.includes("phase-coffrage")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>Coffrage</div>
      <div>Date limite : <strong>${escapeHtml(formatTooltipDate(start))}</strong></div>
      <div>Diff coffrage : <strong>${escapeHtml(formatTooltipDate(end))}</strong></div>
    `;
  }

  if (cls.includes("phase-armature")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>Armature</div>
      <div>Diff coffrage : <strong>${escapeHtml(formatTooltipDate(start))}</strong></div>
      <div>Diff armature : <strong>${escapeHtml(formatTooltipDate(end))}</strong></div>
    `;
  }

  if (cls.includes("phase-ndc")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>NDC</div>
      <div>Date limite : <strong>${escapeHtml(formatTooltipDate(start))}</strong></div>
      <div>Diff coffrage : <strong>${escapeHtml(formatTooltipDate(end))}</strong></div>
    `;
  }

  if (cls.includes("phase-coupes")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>COUPES</div>
      <div>Date limite : <strong>${escapeHtml(formatTooltipDate(start))}</strong></div>
      <div>Diff coffrage : <strong>${escapeHtml(formatTooltipDate(end))}</strong></div>
    `;
  }

  if (cls.includes("phase-demolition")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>DÉMOLITION</div>
      <div>Date limite : <strong>${escapeHtml(formatTooltipDate(start))}</strong></div>
      <div>Diff coffrage : <strong>${escapeHtml(formatTooltipDate(end))}</strong></div>
    `;
  }

  if (cls.includes("phase-generic")) {
    const typeLabel = String(item?.phaseLabel || "Type personnalisé");
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>${escapeHtml(typeLabel)}</div>
      <div>Date limite : <strong>${escapeHtml(formatTooltipDate(start))}</strong></div>
      <div>Diff coffrage : <strong>${escapeHtml(formatTooltipDate(end))}</strong></div>
    `;
  }

  if (cls.includes("phase-demarrage")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>Début des travaux</div>
      <div>Date : <strong>${escapeHtml(formatTooltipDate(start))}</strong></div>
    `;
  }

  return "";
}
