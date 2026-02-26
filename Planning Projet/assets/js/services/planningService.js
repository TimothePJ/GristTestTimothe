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
  if (!date) return "â€”";
  return date.toLocaleDateString("fr-FR");
}

function buildGroupContent(row) {
  return `
    <div class="group-row-grid" style="display:grid;grid-template-columns:var(--col-id2) var(--col-task) var(--col-type) var(--col-line) var(--col-indice) var(--col-retards);align-items:center;width:var(--left-grid-width);min-height:var(--planning-row-height);padding:0 var(--left-pad-x);box-sizing:content-box;">
      <div class="cell-id2">${escapeHtml(row.id2 ?? "")}</div>
      <div class="cell-task">${escapeHtml(row.taches ?? "")}</div>
      <div class="cell-type">${escapeHtml(row.typeDoc ?? "")}</div>
      <div class="cell-line">${escapeHtml(row.lignePlanning ?? "")}</div>
      <div class="cell-indice">${escapeHtml(row.indice ?? "")}</div>
      <div class="cell-retards">${escapeHtml(row.retards ?? "")}</div>
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

function createRangeBetweenDates(startDateRaw, endDateRaw) {
  const start = parseDate(startDateRaw);
  const end = parseDate(endDateRaw);
  if (!start || !end) return null;
  if (end <= start) return null;
  return { start, end };
}

export function buildTimelineDataFromPlanningRows(rawRows, selectedProject = "") {
  const cfg = APP_CONFIG.grist.planningTable.columns;
  const projectLinkCol = cfg.projectLink || cfg.nomProjet;

  let rows = rawRows.map((r) => {
    const id2Text = toText(r[cfg.id2]);
    const lignePlanningText = toText(r[cfg.lignePlanning]);
    const tachesText = toText(r[cfg.taches]) || toText(r[cfg.tacheAlt]);

    return {
      rowId: r[cfg.id] ?? null,
      projectLink: projectLinkCol ? toText(r[projectLinkCol]) : "",

      // Colonnes affichÃ©es
      id2: id2Text,
      taches: tachesText,
      typeDoc: toText(r[cfg.typeDoc]),
      lignePlanning: lignePlanningText,

      // Valeurs numÃ©riques de tri (robustes)
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
      retards: toText(r[cfg.retards]),

      indice: toText(r[cfg.indice]),
      realise: toText(r[cfg.realise]),
    };
  });

  // Filtre projet (actif seulement si colonne configurÃ©e)
  if (!selectedProject) {
    rows = [];
  } else if (projectLinkCol) {
    rows = rows.filter((r) => r.projectLink === selectedProject);
  }

  // âœ… TRI ROBUSTE (ordre mÃ©tier demandÃ©)
  // 1) Ligne_planning (numÃ©rique)
  // 2) ID2 (numÃ©rique)
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

    // âœ… Groupe avec champs de tri explicites (pour vis-timeline)
    groups.push({
      id: groupId,
      content: buildGroupContent(row),
      id2Label: row.id2 ?? "",
      tachesLabel: row.taches ?? "",
      typeDocLabel: row.typeDoc ?? "",
      lignePlanningLabel: row.lignePlanning ?? "",
      indiceLabel: row.indice ?? "",
      retardsLabel: row.retards ?? "",

      // Champs de tri explicites (plus fiable que meta uniquement)
      sortIndex: index,
      sortLignePlanning: row.lignePlanningNum ?? Number.MAX_SAFE_INTEGER,
      sortID2: row.id2Num ?? Number.MAX_SAFE_INTEGER,

      // On garde meta pour debug / usages futurs
      meta: row,
    });
    // Coffrage : Date_limite -> Diff_coffrage
    const pCoffrage = createRangeBetweenDates(row.dateLimite, row.diffCoffrage);
    if (pCoffrage) {
      items.push(
        createPhaseItem({
          itemId: `${groupId}-p-coffrage`,
          groupId,
          start: pCoffrage.start,
          end: pCoffrage.end,
          label: "Coffrage",
          className: "phase-coffrage",
          title: `
            <b>${escapeHtml(row.taches || "Tache")}</b><br>
            Date_limite -> Diff_coffrage<br>
            ${fmtDate(pCoffrage.start)} -> ${fmtDate(pCoffrage.end)}
          `,
        })
      );
    }

    // Armature : Diff_coffrage -> Diff_armature
    const pArmature = createRangeBetweenDates(row.diffCoffrage, row.diffArmature);
    if (pArmature) {
      items.push(
        createPhaseItem({
          itemId: `${groupId}-p-armature`,
          groupId,
          start: pArmature.start,
          end: pArmature.end,
          label: "Armature",
          className: "phase-armature",
          title: `
            <b>${escapeHtml(row.taches || "Tache")}</b><br>
            Diff_coffrage -> Diff_armature<br>
            ${fmtDate(pArmature.start)} -> ${fmtDate(pArmature.end)}
          `,
        })
      );
    }

    // Debut des travaux : case coloree sur 1 jour a Demarrages_travaux
    const demarrageTravauxDate = parseDate(row.demarragesTravaux);
    if (demarrageTravauxDate) {
      const demarrageTravauxEnd = addDays(demarrageTravauxDate, 1);
      items.push(
        createPhaseItem({
          itemId: `${groupId}-demarrage`,
          groupId,
          start: demarrageTravauxDate,
          end: demarrageTravauxEnd,
          label: "",
          className: "phase-demarrage",
          title: `
            <b>${escapeHtml(row.taches || "Tache")}</b><br>
            Debut des travaux<br>
            ${fmtDate(demarrageTravauxDate)}
          `,
        })
      );
    }

    // Pas de barre "Retard" dans la timeline: affichage en colonne dédiée.
  });

  return {
    groups,
    items,
    rowCount: rows.length,
  };
}

