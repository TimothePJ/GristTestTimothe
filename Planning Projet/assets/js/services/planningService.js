import { APP_CONFIG } from "../config.js";
import { toText } from "./gristService.js";

function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (value == null || value === "") return null;

  // Date JS
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  // Nombre (cas Grist fréquent)
  if (typeof value === "number") {
    let n = value;

    // Cas 1 : timestamp en secondes (Grist/Unix)
    // Exemple ~ 1640649600 (2021)
    if (n > 1e9 && n < 1e11) {
      n = n * 1000;
    }

    // Cas 2 : timestamp déjà en millisecondes
    // Exemple ~ 1640649600000
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) return d;

    return null;
  }

  const str = String(value).trim();
  if (!str) return null;

  // DD/MM/YYYY (éventuellement avec heure derrière)
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

  // ISO (ex: 2021-12-28T00:00:00.000Z)
  const iso = new Date(str);
  if (!Number.isNaN(iso.getTime())) {
    return iso;
  }

  return null;
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
    <div class="group-row-grid">
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

/**
 * Transforme les lignes de Planning_Projet en datasets vis-timeline.
 *
 * selectedProject: string
 * - Pour l'instant, si aucun champ de liaison n'est configuré, on n'applique pas le filtre.
 */
export function buildTimelineDataFromPlanningRows(rawRows, selectedProject = "") {
  const cfg = APP_CONFIG.grist.planningTable.columns;
  const projectLinkCol = cfg.projectLink; // null pour l’instant dans ton JSON exemple

  // 1) Normalisation des lignes métier
  let rows = rawRows.map((r) => ({
    rowId: r[cfg.id] ?? null,
    projectLink: projectLinkCol ? toText(r[projectLinkCol]) : "",
    id2: toText(r[cfg.id2]),
    taches: toText(r[cfg.taches]),
    typeDoc: toText(r[cfg.typeDoc]),
    lignePlanning: toText(r[cfg.lignePlanning]),

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
  }));

  // 2) Filtre projet (seulement si colonne de liaison configurée)
  if (selectedProject && projectLinkCol) {
    rows = rows.filter((r) => r.projectLink === selectedProject);
  }

  // 3) Tri (par ligne planning puis ID2)
  rows.sort((a, b) => {
    const la = Number(a.lignePlanning);
    const lb = Number(b.lignePlanning);

    if (Number.isFinite(la) && Number.isFinite(lb) && la !== lb) return la - lb;

    const ia = Number(a.id2);
    const ib = Number(b.id2);
    if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;

    return (a.taches || "").localeCompare(b.taches || "", "fr");
  });

  // 4) Groups + Items
  const groups = [];
  const items = [];

  for (const row of rows) {
    const groupId = `g-${row.rowId ?? `${row.id2}-${row.lignePlanning}`}`;

    groups.push({
      id: groupId,
      content: buildGroupContent(row),
      // utiles si on veut récupérer les infos au clic plus tard
      meta: row,
    });

    // Phase 1 : Date_limite + Duree_1 semaines
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
            Phase 1 (Date_limite + Duree_1)<br>
            ${fmtDate(p1.start)} → ${fmtDate(p1.end)} (${p1.durationLabel})<br>
            Indice: ${escapeHtml(row.indice || "—")} | Réalisé: ${escapeHtml(row.realise || "—")}%
          `,
        })
      );
    }

    // Phase 2 : Diff_coffrage + Duree_2 semaines
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
            Coffrage (Diff_coffrage + Duree_2)<br>
            ${fmtDate(p2.start)} → ${fmtDate(p2.end)} (${p2.durationLabel})
          `,
        })
      );
    }

    // Phase 3 : Diff_armature + Duree_3 semaines
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
            Armature (Diff_armature + Duree_3)<br>
            ${fmtDate(p3.start)} → ${fmtDate(p3.end)} (${p3.durationLabel})
          `,
        })
      );
    }

    // Phase 4 : Demarrages_travaux + Retards jours
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
            Retards (Demarrages_travaux + Retards)<br>
            ${fmtDate(p4.start)} → ${fmtDate(p4.end)} (${p4.durationLabel})
          `,
        })
      );
    }
  }

  return { groups, items, rowCount: rows.length };
}