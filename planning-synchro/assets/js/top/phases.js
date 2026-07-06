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
import { buildTimelineDataFromPlanningRows } from "./vendor/planningProjetBuilder.js";

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

// Left-column tint per document type, mirroring Planning Projet's
// `.group-row-grid.row-type-*` backgrounds (coffrage/ndc/coupes/demolition/
// generic). ARMATURES has no tint in the source (default white). Returns the
// class name to hang on the vis group so styles.css can colour the left label
// cell; "" for zone headers or untyped rows.
const ROW_TYPE_CLASS_BY_KEY = {
  COFFRAGE: "row-type-coffrage",
  ARMATURES: "row-type-armature",
  NDC: "row-type-ndc",
  COUPES: "row-type-coupes",
  DEMOLITION: "row-type-demolition",
};

function getRowTypeClass(rawTypeDoc) {
  const raw = toText(rawTypeDoc);
  if (!raw) return "";
  const typeKey = normalizePlanningDocumentType(raw);
  return ROW_TYPE_CLASS_BY_KEY[typeKey] || "row-type-generic";
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

// --- non-aggregated view: EXACT Planning Projet rendering (vendored builder) ---
//
// One timeline row per record + Zone header rows, with the exact phase bands,
// realisation/retard states, inline styles and tooltips of Planning Projet —
// produced by the vendored buildTimelineDataFromPlanningRows (top/vendor/). We
// only ADAPT its rich output for the shared-frise pane: the visible left label
// is the Tâche alone (or the zone name on a header row), so the left column
// stays aligned at --ps-left-col-width; the record's ID2/Zone/Groupe linkage
// goes to the hover title. Rendering stays strictly read-only (planningRenderer).

// Plain-text hover title for a task row: task name on line 1, then the
// ID2/Zone/Groupe linkage (the identity the task-only column deliberately hides).
function buildTaskTitleText(group) {
  const meta = [
    group.id2Label && `ID2 : ${group.id2Label}`,
    group.zoneLabel && `Zone : ${group.zoneLabel}`,
    group.groupeLabel && `Groupe : ${group.groupeLabel}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return [group.tachesLabel || "", meta].filter(Boolean).join("\n");
}

export function buildPlanningItems(rows, columns, options = {}) {
  const { project = "", zone = "", targetLookup = null, referenceReceptionLookup = null } = options;
  const { groups, items } = buildTimelineDataFromPlanningRows(
    rows || [],
    project,
    zone,
    targetLookup,
    referenceReceptionLookup
  );

  const adaptedGroups = (groups || []).map((group) => ({
    id: group.id,
    isZoneHeader: Boolean(group.isZoneHeader),
    className: group.className || "",
    // Left-column tint per Planning Projet document type (zone headers keep none).
    typeClass: group.isZoneHeader ? "" : getRowTypeClass(group.typeDocLabel),
    label: group.isZoneHeader
      ? group.zoneHeaderLabel || group.zoneLabel || ""
      : group.tachesLabel || "",
    titleText: group.isZoneHeader
      ? group.zoneHeaderLabel || group.zoneLabel || ""
      : buildTaskTitleText(group),
  }));

  const adaptedItems = (items || []).map((item) => ({
    id: item.id,
    group: item.group,
    start: item.start,
    end: item.end,
    type: item.type || "range",
    className: item.className || "",
    style: item.style || "",
    phaseLabel: item.phaseLabel ?? item.content ?? "",
    tooltip: item.title || item.tooltipHtml || "",
  }));

  return { groups: adaptedGroups, items: adaptedItems };
}

// Date range (ISO { startDate, endDate }) covered by the top-pane PHASE segments
// (coffrage/armature/…/démarrage) from the vendored builder's dateBounds. Used to
// WIDEN the shared frise (union with the TimeSegment bounds) so every phase row
// stays visible/scrollable.
//
// Reception ("Données d'entrées") bands are intentionally NOT counted (the
// reference lookup is not passed to the builder here): a band precedes its phase,
// so including it would drag bounds.start left of all phases and park the band at
// the far-left edge of the frise. Left out of the bounds, a band that precedes
// the first phase is simply out of range (never a stray leftmost segment), and
// vis `align:'center'` keeps it from pinning its content to the edge either.
export function computePlanningPhaseBounds(rows, project = "") {
  const { dateBounds } = buildTimelineDataFromPlanningRows(
    rows || [], project, "", null, null
  );
  return dateBounds && dateBounds.startDate && dateBounds.endDate
    ? { startDate: dateBounds.startDate, endDate: dateBounds.endDate }
    : null;
}

// --- planning task ranges (for the bottom-pane segment hover count) -----------
//
// One work-period range { startAt, endAt } per planning row, derived from its
// phases (reusing buildRowPhases). The démarrage marker is a milestone, not a
// work period, so it does NOT define the range; a row carrying ONLY a démarrage
// falls back to that single day. Mirrors gestion-depenses2's per-row
// getPlanningTaskRange — used by the bottom pane to show, when hovering a
// TimeSegment bar, how many planning tasks fall within that period.
export function buildPlanningTaskRanges(rows, columns) {
  const ranges = [];

  (rows || []).forEach((row) => {
    const phases = buildRowPhases(row, columns);
    let startAt = null;
    let endAt = null;

    phases.forEach((phase) => {
      if (phase.type === "demarrage") return;
      if (!(phase.start instanceof Date) || !(phase.end instanceof Date)) return;
      if (!startAt || phase.start < startAt) startAt = phase.start;
      if (!endAt || phase.end > endAt) endAt = phase.end;
    });

    if (!startAt || !endAt) {
      const demarrage = phases.find((phase) => phase.type === "demarrage");
      if (demarrage && demarrage.start instanceof Date) {
        startAt = demarrage.start;
        endAt = demarrage.start;
      }
    }

    if (startAt && endAt) ranges.push({ startAt, endAt });
  });

  return ranges;
}

function taskDayFloor(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function taskDayCeil(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

// Number of planning task ranges overlapping [startAt, endAt] at day granularity.
// Ported from gestion-depenses2's countPlanningTasksOverlappingRange /
// getPlanningTasksOverlappingRange (services/projectService.js).
export function countPlanningTasksOverlappingRange(taskRanges, startAt, endAt) {
  if (!(startAt instanceof Date) || !(endAt instanceof Date)) return 0;
  const rangeStart = taskDayFloor(startAt);
  const rangeEnd = taskDayCeil(endAt);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) return 0;

  let count = 0;
  (taskRanges || []).forEach((task) => {
    const taskStart = task?.startAt instanceof Date ? taskDayFloor(task.startAt) : null;
    const taskEnd = task?.endAt instanceof Date ? taskDayCeil(task.endAt) : null;
    if (!taskStart || !taskEnd) return;
    if (taskStart <= rangeEnd && taskEnd >= rangeStart) count += 1;
  });
  return count;
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
      // Aggregate view ("Rassembler visuellement") drops the start-of-works
      // markers: they clutter the merged type-doc bands and Planning Projet's own
      // timeline shows no separate démarrage segment either.
      if (phase.type === "demarrage") return;
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
    groups.push({
      id: group.id,
      label: group.label,
      typeDoc: group.typeDoc,
      typeClass: ROW_TYPE_CLASS_BY_KEY[group.typeDoc] || (group.typeDoc ? "row-type-generic" : ""),
    });

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
