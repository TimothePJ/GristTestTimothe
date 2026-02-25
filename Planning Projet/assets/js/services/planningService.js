import { APP_CONFIG } from "../config.js";
import { toText } from "./gristService.js";

function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    let n = value;

    // timestamp en secondes -> ms
    if (n > 1e9 && n < 1e11) n *= 1000;

    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const str = String(value).trim();
  if (!str) return null;

  // DD/MM/YYYY
  const frMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+.*)?$/);
  if (frMatch) {
    const day = Number(frMatch[1]);
    const month = Number(frMatch[2]);
    const year = Number(frMatch[3]);

    const d = new Date(year, month - 1, day);
    if (
      d.getFullYear() === year &&
      d.getMonth() === month - 1 &&
      d.getDate() === day
    ) {
      return d;
    }
    return null;
  }

  // ISO
  const iso = new Date(str);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addWeeks(date, weeks) {
  return addDays(date, weeks * 7);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(date) {
  if (!date) return "—";
  return date.toLocaleDateString("fr-FR");
}

function buildGroupContent(row) {
  return `
    <div class="group-row-grid" style="display:grid;grid-template-columns:var(--col-id2) var(--col-task) var(--col-type) var(--col-line);align-items:center;width:var(--left-grid-width);min-height:var(--planning-row-height);padding:0 var(--left-pad-x);box-sizing:content-box;">
      <div class="cell-id2">${escapeHtml(row.id2 ?? "")}</div>
      <div class="cell-task">${escapeHtml(row.taches ?? "")}</div>
      <div class="cell-type">${escapeHtml(row.typeDoc ?? "")}</div>
      <div class="cell-line">${escapeHtml(row.lignePlanning ?? "")}</div>
    </div>
  `;
}

function createPhaseItem({
  itemId,
  groupId,
  start,
  end,
  label,
  className,
  title,
}) {
  return {
    id: itemId,
    group: groupId,
    start,
    end,
    content: label,
    className,
    title,
    type: "range",
  };
}

function createRangeFromStartAndWeeks(startDateRaw, weeksRaw) {
  const start = parseDate(startDateRaw);
  const weeks = toNumber(weeksRaw);

  if (!start || weeks == null || weeks <= 0) return null;

  const end = addWeeks(start, weeks);
  return { start, end, durationLabel: `${weeks} sem.` };
}

function createRangeFromStartAndDays(startDateRaw, daysRaw) {
  const start = parseDate(startDateRaw);
  const days = toNumber(daysRaw);

  if (!start || days == null || days <= 0) return null;

  const end = addDays(start, days);
  return { start, end, durationLabel: `${days} j` };
}

export function buildTimelineDataFromPlanningRows(rawRows, selectedProject = "") {
  const cfg = APP_CONFIG.grist.planningTable.columns;
  const projectLinkCol = cfg.projectLink;

  let rows = rawRows.map((r) => {
    const id2Text = toText(r[cfg.id2]);
    const lignePlanningText = toText(r[cfg.lignePlanning]);
    const tachesText = toText(r[cfg.taches]) || toText(r[cfg.tacheAlt]);

    return {
      rowId: r[cfg.id] ?? null,
      projectLink: projectLinkCol ? toText(r[projectLinkCol]) : "",

      // Colonnes affichées
      id2: id2Text,
      taches: tachesText,
      typeDoc: toText(r[cfg.typeDoc]),
      lignePlanning: lignePlanningText,

      // Valeurs numériques de tri (robustes)
      id2Num: toNumber(id2Text),
      lignePlanningNum: toNumber(lignePlanningText),

      // Phases planning
      dateLimite: r[cfg.dateLimite],
      duree1: r[cfg.duree1],

      diffCoffrage: r[cfg.diffCoffrage],
      duree2: r[cfg.duree2],

      diffArmature: r[cfg.diffArmature],
      duree3: r[cfg.duree3],

      demarragesTravaux: r[cfg.demarragesTravaux],
      retards: r[cfg.retards],

      indice: toText(r[cfg.indice]),
      realise: toText(r[cfg.realise]),
    };
  });

  // Filtre projet (actif seulement si colonne configurée)
  if (selectedProject && projectLinkCol) {
    rows = rows.filter((r) => r.projectLink === selectedProject);
  }

  // ✅ TRI ROBUSTE (ordre métier demandé)
  // 1) Ligne_planning (numérique)
  // 2) ID2 (numérique)
  // 3) Type_doc
  // 4) Taches
  rows.sort((a, b) => {
    const aLine = a.lignePlanningNum;
    const bLine = b.lignePlanningNum;
    if (aLine != null && bLine != null && aLine !== bLine) return aLine - bLine;
    if (aLine != null && bLine == null) return -1;
    if (aLine == null && bLine != null) return 1;

    const aId2 = a.id2Num;
    const bId2 = b.id2Num;
    if (aId2 != null && bId2 != null && aId2 !== bId2) return aId2 - bId2;
    if (aId2 != null && bId2 == null) return -1;
    if (aId2 == null && bId2 != null) return 1;

    const typeCmp = (a.typeDoc || "").localeCompare(b.typeDoc || "", "fr");
    if (typeCmp !== 0) return typeCmp;

    return (a.taches || "").localeCompare(b.taches || "", "fr");
  });

  const groups = [];
  const items = [];

  rows.forEach((row, index) => {
    const groupId = `g-${row.rowId ?? `${row.id2 || "x"}-${row.lignePlanning || "x"}-${index}`}`;

    // ✅ Groupe avec champs de tri explicites (pour vis-timeline)
    groups.push({
      id: groupId,
      content: buildGroupContent(row),
      id2Label: row.id2 ?? "",
      tachesLabel: row.taches ?? "",
      typeDocLabel: row.typeDoc ?? "",
      lignePlanningLabel: row.lignePlanning ?? "",

      // Champs de tri explicites (plus fiable que meta uniquement)
      sortIndex: index,
      sortLignePlanning: row.lignePlanningNum ?? Number.MAX_SAFE_INTEGER,
      sortID2: row.id2Num ?? Number.MAX_SAFE_INTEGER,

      // On garde meta pour debug / usages futurs
      meta: row,
    });

    // Phase 1 : Date_limite + Duree_1 (semaines)
    const p1 = createRangeFromStartAndWeeks(row.dateLimite, row.duree1);
    if (p1) {
      items.push(
        createPhaseItem({
          itemId: `${groupId}-p1`,
          groupId,
          start: p1.start,
          end: p1.end,
          label: "P1",
          className: "phase-limite",
          title: `
            <b>${escapeHtml(row.taches || "Tâche")}</b><br>
            Date_limite + Duree_1<br>
            ${fmtDate(p1.start)} → ${fmtDate(p1.end)} (${p1.durationLabel})
          `,
        })
      );
    }

    // Phase 2 : Diff_coffrage + Duree_2 (semaines)
    const p2 = createRangeFromStartAndWeeks(row.diffCoffrage, row.duree2);
    if (p2) {
      items.push(
        createPhaseItem({
          itemId: `${groupId}-p2`,
          groupId,
          start: p2.start,
          end: p2.end,
          label: "Coffrage",
          className: "phase-coffrage",
          title: `
            <b>${escapeHtml(row.taches || "Tâche")}</b><br>
            Diff_coffrage + Duree_2<br>
            ${fmtDate(p2.start)} → ${fmtDate(p2.end)} (${p2.durationLabel})
          `,
        })
      );
    }

    // Phase 3 : Diff_armature + Duree_3 (semaines)
    const p3 = createRangeFromStartAndWeeks(row.diffArmature, row.duree3);
    if (p3) {
      items.push(
        createPhaseItem({
          itemId: `${groupId}-p3`,
          groupId,
          start: p3.start,
          end: p3.end,
          label: "Armature",
          className: "phase-armature",
          title: `
            <b>${escapeHtml(row.taches || "Tâche")}</b><br>
            Diff_armature + Duree_3<br>
            ${fmtDate(p3.start)} → ${fmtDate(p3.end)} (${p3.durationLabel})
          `,
        })
      );
    }

    // Phase 4 : Demarrages_travaux + Retards (jours)
    const p4 = createRangeFromStartAndDays(row.demarragesTravaux, row.retards);
    if (p4) {
      items.push(
        createPhaseItem({
          itemId: `${groupId}-p4`,
          groupId,
          start: p4.start,
          end: p4.end,
          label: "Retard",
          className: "phase-travaux",
          title: `
            <b>${escapeHtml(row.taches || "Tâche")}</b><br>
            Demarrages_travaux + Retards<br>
            ${fmtDate(p4.start)} → ${fmtDate(p4.end)} (${p4.durationLabel})
          `,
        })
      );
    }
  });

  return {
    groups,
    items,
    rowCount: rows.length,
  };
}
