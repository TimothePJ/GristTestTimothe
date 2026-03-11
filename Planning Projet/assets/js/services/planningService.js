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

function subtractWeeks(date, weeks) {
  return addDays(date, -(weeks * 7));
}

function getCurrentInstant() {
  return new Date();
}

function isAllowedTypeDoc(value) {
  const normalized = String(value ?? "").toUpperCase();
  return normalized.includes("COFFRAGE") || normalized.includes("ARMATURES");
}

function isCoffrageTypeDoc(value) {
  const normalized = String(value ?? "").toUpperCase();
  return normalized.includes("COFFRAGE");
}

function isArmaturesTypeDoc(value) {
  const normalized = String(value ?? "").toUpperCase();
  return normalized.includes("ARMATURES");
}

function resolveCoffrageDateLimiteDate(dateLimiteRaw, diffCoffrageRaw, duree1Raw) {
  const diffCoffrageDate = parseDate(diffCoffrageRaw);
  const duree1Weeks = toNumber(duree1Raw);

  if (diffCoffrageDate && duree1Weeks != null && duree1Weeks >= 0) {
    return subtractWeeks(diffCoffrageDate, duree1Weeks);
  }

  return parseDate(dateLimiteRaw);
}

function resolveBandStartDate(typeDoc, dateLimiteRaw, diffCoffrageRaw, duree1Raw) {
  const normalized = String(typeDoc ?? "").toUpperCase();
  if (normalized.includes("ARMATURES")) return parseDate(diffCoffrageRaw);
  if (normalized.includes("COFFRAGE")) {
    return resolveCoffrageDateLimiteDate(dateLimiteRaw, diffCoffrageRaw, duree1Raw);
  }
  return null;
}

function resolveBandEndDate(typeDoc, diffCoffrageRaw, diffArmatureRaw) {
  const normalized = String(typeDoc ?? "").toUpperCase();
  if (normalized.includes("ARMATURES")) return parseDate(diffArmatureRaw);
  if (normalized.includes("COFFRAGE")) return parseDate(diffCoffrageRaw);
  return null;
}

function resolveDisplayedDurations(typeDoc, duree1Raw, duree2Raw, duree3Raw) {
  if (isArmaturesTypeDoc(typeDoc)) {
    return {
      dureeDebutFin: toText(duree2Raw),
      dureeFinDemarrage: toText(duree3Raw),
    };
  }

  if (isCoffrageTypeDoc(typeDoc)) {
    return {
      dureeDebutFin: toText(duree1Raw),
      dureeFinDemarrage: "",
    };
  }

  return {
    dureeDebutFin: "",
    dureeFinDemarrage: "",
  };
}

function fmtCellDate(date) {
  if (!date) return "";
  return date.toLocaleDateString("fr-FR");
}

function fmtIsoCellDate(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function fmtDateIso(date) {
  if (!date) return "â€”";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildGroupContent(row) {
  return `
    <div class="group-row-grid" style="display:grid;grid-template-columns:var(--col-id2) var(--col-task) var(--col-ligne-planning) var(--col-start) var(--col-duration-1) var(--col-end) var(--col-duration-2) var(--col-demarrage) var(--col-indice) var(--col-retards);align-items:center;width:var(--left-grid-width);min-height:var(--planning-row-height);padding:0 var(--left-pad-x);box-sizing:content-box;">
      <div class="cell-id2">${escapeHtml(row.id2 ?? "")}</div>
      <div class="cell-task">${escapeHtml(row.taches ?? "")}</div>
      <div class="cell-ligne-planning">${escapeHtml(row.lignePlanning ?? "")}</div>
      <div class="cell-start">${escapeHtml(row.debut ?? "")}</div>
      <div class="cell-duration-1">${escapeHtml(row.dureeDebutFin ?? "")}</div>
      <div class="cell-end">${escapeHtml(row.fin ?? "")}</div>
      <div class="cell-duration-2">${escapeHtml(row.dureeFinDemarrage ?? "")}</div>
      <div class="cell-demarrage">${escapeHtml(row.demarrage ?? "")}</div>
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

function createSplitPhaseItems({
  itemIdBase,
  groupId,
  start,
  end,
  label,
  className,
  title,
}) {
  const currentInstant = getCurrentInstant();

  if (!(start instanceof Date) || !(end instanceof Date) || end <= start) {
    return [];
  }

  if (end <= currentInstant) {
    return [
      createPhaseItem({
        itemId: itemIdBase,
        groupId,
        start,
        end,
        label,
        className: `${className} phase-past`,
        title,
      }),
    ];
  }

  if (start >= currentInstant) {
    return [
      createPhaseItem({
        itemId: itemIdBase,
        groupId,
        start,
        end,
        label,
        className,
        title,
      }),
    ];
  }

  return [
    createPhaseItem({
      itemId: `${itemIdBase}-past`,
      groupId,
      start,
      end: currentInstant,
      label: "",
      className: `${className} phase-past`,
      title,
    }),
    createPhaseItem({
      itemId: `${itemIdBase}-current`,
      groupId,
      start: currentInstant,
      end,
      label,
      className,
      title,
    }),
  ];
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

function resolveDurationEditMeta(typeDoc, bandEndDate, demarrageDate) {
  if (isArmaturesTypeDoc(typeDoc)) {
    return {
      dureeDebutFinColumnKey: "duree2",
      dureeDebutFinLeftDateColumnKey: "diffCoffrage",
      dureeDebutFinRightIso: fmtIsoCellDate(bandEndDate),
      dureeDebutFinEditable: Boolean(bandEndDate),
      dureeFinDemarrageColumnKey: "duree3",
      dureeFinDemarrageLeftDateColumnKey: "diffArmature",
      dureeFinDemarrageRightIso: fmtIsoCellDate(demarrageDate),
      dureeFinDemarrageEditable: Boolean(demarrageDate),
    };
  }

  if (isCoffrageTypeDoc(typeDoc)) {
    return {
      dureeDebutFinColumnKey: "duree1",
      dureeDebutFinLeftDateColumnKey: "dateLimite",
      dureeDebutFinRightIso: fmtIsoCellDate(bandEndDate),
      dureeDebutFinEditable: Boolean(bandEndDate),
      dureeFinDemarrageColumnKey: "",
      dureeFinDemarrageLeftDateColumnKey: "",
      dureeFinDemarrageRightIso: "",
      dureeFinDemarrageEditable: false,
    };
  }

  return {
    dureeDebutFinColumnKey: "",
    dureeDebutFinLeftDateColumnKey: "",
    dureeDebutFinRightIso: "",
    dureeDebutFinEditable: false,
    dureeFinDemarrageColumnKey: "",
    dureeFinDemarrageLeftDateColumnKey: "",
    dureeFinDemarrageRightIso: "",
    dureeFinDemarrageEditable: false,
  };
}

function compareRowsBaseOrder(a, b) {
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
}

function compareNullableDatesAsc(aDate, bDate) {
  const aValid = aDate instanceof Date && !Number.isNaN(aDate.getTime());
  const bValid = bDate instanceof Date && !Number.isNaN(bDate.getTime());
  if (aValid && bValid) {
    if (aDate.valueOf() !== bDate.valueOf()) {
      return aDate - bDate;
    }
    return 0;
  }
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  return 0;
}

function compareRowsChronologicalOrder(a, b) {
  const dateCmp = compareNullableDatesAsc(a?.dateLimiteDate, b?.dateLimiteDate);
  if (dateCmp !== 0) return dateCmp;
  return compareRowsBaseOrder(a, b);
}

function compareArmaturesByDemarrageOrder(a, b) {
  const demarrageCmp = compareNullableDatesAsc(
    a?.demarragesTravauxDate,
    b?.demarragesTravauxDate
  );
  if (demarrageCmp !== 0) return demarrageCmp;
  return compareRowsChronologicalOrder(a, b);
}

function getGroupMinDateLimite(rows) {
  let minDate = null;
  for (const row of rows || []) {
    const date = row?.dateLimiteDate;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue;
    if (!minDate || date < minDate) {
      minDate = date;
    }
  }
  return minDate;
}

function compareZoneKeys(a, b) {
  const aKey = String(a ?? "");
  const bKey = String(b ?? "");
  if (aKey && bKey) {
    const cmp = aKey.localeCompare(bKey, "fr", {
      sensitivity: "base",
      numeric: true,
    });
    if (cmp !== 0) return cmp;
  }
  if (aKey && !bKey) return -1;
  if (!aKey && bKey) return 1;
  return 0;
}

function buildGroupCompositeKey(zoneKey, groupeKey) {
  const g = String(groupeKey ?? "");
  if (!g) return "";
  const z = String(zoneKey ?? "");
  return `${z}||${g}`;
}

function formatZoneHeaderLabel(zoneLabel) {
  const normalized = String(zoneLabel ?? "").trim();
  if (!normalized) return "Batiment Sans zone";
  return `Batiment ${normalized}`;
}

export function buildTimelineDataFromPlanningRows(
  rawRows,
  selectedProject = "",
  selectedZone = ""
) {
  const cfg = APP_CONFIG.grist.planningTable.columns;
  const projectLinkCol = cfg.projectLink || cfg.nomProjet;
  const selectedZoneKey = String(selectedZone ?? "")
    .trim()
    .toLocaleLowerCase("fr");

  let rows = rawRows.map((r) => {
    const id2Text = toText(r[cfg.id2]);
    const groupeText = toText(r[cfg.groupe]);
    const zoneText = toText(r[cfg.zone]);
    const lignePlanningText = toText(r[cfg.lignePlanning]);
    const tachesText = toText(r[cfg.taches]) || toText(r[cfg.tacheAlt]);
    const typeDocText = toText(r[cfg.typeDoc]);
    const dateLimiteValue = r[cfg.dateLimite];
    const diffCoffrageValue = r[cfg.diffCoffrage];
    const diffArmatureValue = r[cfg.diffArmature];
    const duree1Value = r[cfg.duree1];
    const duree2Value = r[cfg.duree2];
    const duree3Value = r[cfg.duree3];
    const isCoffrage = isCoffrageTypeDoc(typeDocText);
    const dateLimiteDate = isCoffrage
      ? resolveCoffrageDateLimiteDate(dateLimiteValue, diffCoffrageValue, duree1Value)
      : parseDate(dateLimiteValue);
    const bandStartDate = resolveBandStartDate(
      typeDocText,
      dateLimiteValue,
      diffCoffrageValue,
      duree1Value
    );
    const bandEndDate = resolveBandEndDate(
      typeDocText,
      diffCoffrageValue,
      diffArmatureValue
    );
    const demarrageTravauxValue = r[cfg.demarragesTravaux];
    const demarrageTravauxDate = parseDate(demarrageTravauxValue);
    const demarrageDisplayDate = isCoffrage ? null : demarrageTravauxDate;
    const displayedDurations = resolveDisplayedDurations(
      typeDocText,
      duree1Value,
      duree2Value,
      duree3Value
    );
    const durationEditMeta = resolveDurationEditMeta(
      typeDocText,
      bandEndDate,
      demarrageTravauxDate
    );

    return {
      rowId: r[cfg.id] ?? null,
      projectLink: projectLinkCol ? toText(r[projectLinkCol]) : "",

      // Colonnes affichees
      id2: id2Text,
      groupe: groupeText,
      groupeKey: groupeText ? groupeText.toLocaleLowerCase("fr") : "",
      zone: zoneText,
      zoneKey: zoneText ? zoneText.toLocaleLowerCase("fr") : "",
      groupCompositeKey: buildGroupCompositeKey(
        zoneText ? zoneText.toLocaleLowerCase("fr") : "",
        groupeText ? groupeText.toLocaleLowerCase("fr") : ""
      ),
      taches: tachesText,
      typeDoc: typeDocText,
      debut: fmtCellDate(bandStartDate),
      fin: fmtCellDate(bandEndDate),
      demarrage: fmtCellDate(demarrageDisplayDate),
      debutIso: fmtIsoCellDate(bandStartDate),
      finIso: fmtIsoCellDate(bandEndDate),
      demarrageIso: fmtIsoCellDate(demarrageDisplayDate),
      dureeDebutFin: displayedDurations.dureeDebutFin,
      dureeFinDemarrage: displayedDurations.dureeFinDemarrage,
      dureeDebutFinColumnKey: durationEditMeta.dureeDebutFinColumnKey,
      dureeDebutFinLeftDateColumnKey: durationEditMeta.dureeDebutFinLeftDateColumnKey,
      dureeDebutFinRightIso: durationEditMeta.dureeDebutFinRightIso,
      dureeDebutFinEditable: durationEditMeta.dureeDebutFinEditable,
      dureeFinDemarrageColumnKey: durationEditMeta.dureeFinDemarrageColumnKey,
      dureeFinDemarrageLeftDateColumnKey: durationEditMeta.dureeFinDemarrageLeftDateColumnKey,
      dureeFinDemarrageRightIso: durationEditMeta.dureeFinDemarrageRightIso,
      dureeFinDemarrageEditable: durationEditMeta.dureeFinDemarrageEditable,
      lignePlanning: lignePlanningText,

      // Valeurs numeriques de tri (robustes)
      id2Num: toNumber(id2Text),
      lignePlanningNum: toNumber(lignePlanningText),

      // Phases planning
      dateLimite: dateLimiteDate || dateLimiteValue,
      dateLimiteDate,
      duree1: duree1Value,

      diffCoffrage: diffCoffrageValue,
      duree2: duree2Value,

      diffArmature: diffArmatureValue,
      duree3: duree3Value,

      demarragesTravaux: demarrageTravauxValue,
      demarragesTravauxDate: demarrageTravauxDate,
      retards: toText(r[cfg.retards]),

      indice: toText(r[cfg.indice]),
      realise: toText(r[cfg.realise]),
    };
  });

  // Filtre projet (actif seulement si colonne configuree)
  if (!selectedProject) {
    rows = [];
  } else if (projectLinkCol) {
    rows = rows.filter((r) => r.projectLink === selectedProject);
  }

  if (selectedZoneKey) {
    rows = rows.filter((row) => row.zoneKey === selectedZoneKey);
  }

  rows = rows.filter((row) => isAllowedTypeDoc(row.typeDoc));

  const minArmatureDiffByGroup = new Map();
  rows.forEach((row) => {
    if (!row.groupCompositeKey || !isArmaturesTypeDoc(row.typeDoc)) return;
    const armatureDiffDate = parseDate(row.diffCoffrage);
    if (!armatureDiffDate) return;

    const existingMin = minArmatureDiffByGroup.get(row.groupCompositeKey);
    if (!existingMin || armatureDiffDate < existingMin) {
      minArmatureDiffByGroup.set(row.groupCompositeKey, armatureDiffDate);
    }
  });

  rows = rows.map((row) => {
    if (!row.groupCompositeKey || !isCoffrageTypeDoc(row.typeDoc)) return row;

    const resolvedDiffCoffrage = minArmatureDiffByGroup.get(row.groupCompositeKey);
    if (!resolvedDiffCoffrage) return row;

    const normalizedDiffCoffrage = new Date(resolvedDiffCoffrage);
    const normalizedDateLimite = resolveCoffrageDateLimiteDate(
      row.dateLimite,
      normalizedDiffCoffrage,
      row.duree1
    );
    const durationEditMeta = resolveDurationEditMeta(
      row.typeDoc,
      normalizedDiffCoffrage,
      parseDate(row.demarragesTravaux)
    );

    return {
      ...row,
      dateLimite: normalizedDateLimite || row.dateLimite,
      dateLimiteDate: normalizedDateLimite || row.dateLimiteDate,
      debut: fmtCellDate(normalizedDateLimite || row.dateLimiteDate),
      debutIso: fmtIsoCellDate(normalizedDateLimite || row.dateLimiteDate),
      diffCoffrage: normalizedDiffCoffrage,
      fin: fmtCellDate(normalizedDiffCoffrage),
      finIso: fmtIsoCellDate(normalizedDiffCoffrage),
      ...durationEditMeta,
    };
  });

  rows.sort(compareRowsChronologicalOrder);

  const groupedRows = new Map();
  const ungroupedRows = [];

  rows.forEach((row) => {
    if (!row.groupCompositeKey) {
      ungroupedRows.push(row);
      return;
    }

    if (!groupedRows.has(row.groupCompositeKey)) {
      groupedRows.set(row.groupCompositeKey, {
        zoneKey: row.zoneKey || "",
        zoneLabel: row.zone || "",
        groupeKey: row.groupeKey || "",
        groupeLabel: row.groupe || "",
        coffrage: [],
        armatures: [],
        others: [],
      });
    }

    const bucket = groupedRows.get(row.groupCompositeKey);
    if (isCoffrageTypeDoc(row.typeDoc)) {
      bucket.coffrage.push(row);
    } else if (isArmaturesTypeDoc(row.typeDoc)) {
      bucket.armatures.push(row);
    } else {
      bucket.others.push(row);
    }
  });

  const groupedEntries = [...groupedRows.values()].map((bucket) => {
    bucket.coffrage.sort(compareRowsChronologicalOrder);
    bucket.armatures.sort(compareArmaturesByDemarrageOrder);
    bucket.others.sort(compareRowsChronologicalOrder);

    const orderedRows = [...bucket.coffrage, ...bucket.armatures, ...bucket.others];
    const minDateLimite = getGroupMinDateLimite(orderedRows);

    return {
      zoneKey: bucket.zoneKey || "",
      zoneLabel: bucket.zoneLabel || "",
      groupeKey: bucket.groupeKey || "",
      groupeLabel: bucket.groupeLabel || "",
      minDateLimite,
      orderedRows,
    };
  });

  groupedEntries.sort((a, b) => {
    const zoneCmp = compareZoneKeys(a.zoneKey, b.zoneKey);
    if (zoneCmp !== 0) return zoneCmp;

    const chronoCmp = compareNullableDatesAsc(a.minDateLimite, b.minDateLimite);
    if (chronoCmp !== 0) return chronoCmp;

    const groupCmp = String(a.groupeLabel || a.groupeKey || "").localeCompare(
      String(b.groupeLabel || b.groupeKey || ""),
      "fr",
      { sensitivity: "base", numeric: true }
    );
    if (groupCmp !== 0) return groupCmp;

    const aFirst = a.orderedRows[0];
    const bFirst = b.orderedRows[0];
    if (aFirst && bFirst) {
      return compareRowsBaseOrder(aFirst, bFirst);
    }

    return 0;
  });

  ungroupedRows.sort((a, b) => {
    const zoneCmp = compareZoneKeys(a.zoneKey, b.zoneKey);
    if (zoneCmp !== 0) return zoneCmp;
    return compareRowsChronologicalOrder(a, b);
  });

  rows = [];
  groupedEntries.forEach((entry) => {
    rows.push(...entry.orderedRows);
  });
  rows.push(...ungroupedRows);

  const groups = [];
  const items = [];
  let previousZoneKey = "__initial__";
  let groupSortIndex = 0;
  let zoneHeaderIndex = 0;

  rows.forEach((row, index) => {
    const rowZoneKey = String(row.zoneKey || "");
    if (rowZoneKey !== previousZoneKey) {
      previousZoneKey = rowZoneKey;
      const zoneHeaderId = `zone-${zoneHeaderIndex}-${rowZoneKey || "sans-zone"}`;
      zoneHeaderIndex += 1;

      groups.push({
        id: zoneHeaderId,
        rowId: null,
        isZoneHeader: true,
        zoneLabel: row.zone || "",
        zoneHeaderLabel: formatZoneHeaderLabel(row.zone || ""),
        className: "zone-header-group",
        sortIndex: groupSortIndex++,
        sortLignePlanning: Number.MIN_SAFE_INTEGER,
        sortID2: Number.MIN_SAFE_INTEGER,
        meta: {
          isZoneHeader: true,
          zoneKey: rowZoneKey,
          zoneLabel: row.zone || "",
        },
      });

      items.push({
        id: `${zoneHeaderId}-bg`,
        group: zoneHeaderId,
        start: new Date(1900, 0, 1),
        end: new Date(2200, 0, 1),
        type: "background",
        className: "zone-header-fill",
        content: "",
      });
    }

    const groupId = `g-${row.rowId ?? `${row.id2 || "x"}-${row.lignePlanning || "x"}-${index}`}`;

    // Groupe avec champs de tri explicites (pour vis-timeline)
    groups.push({
      id: groupId,
      rowId: row.rowId,
      isZoneHeader: false,
      className: "planning-row-group",
      content: buildGroupContent(row),
      id2Label: row.id2 ?? "",
      tachesLabel: row.taches ?? "",
      typeDocLabel: row.typeDoc ?? "",
      groupeLabel: row.groupe ?? "",
      zoneLabel: row.zone ?? "",
      debutLabel: row.debut ?? "",
      debutIso: row.debutIso ?? "",
      dureeDebutFinLabel: row.dureeDebutFin ?? "",
      dureeDebutFinColumnKey: row.dureeDebutFinColumnKey ?? "",
      dureeDebutFinLeftDateColumnKey: row.dureeDebutFinLeftDateColumnKey ?? "",
      dureeDebutFinRightIso: row.dureeDebutFinRightIso ?? "",
      dureeDebutFinEditable: Boolean(row.dureeDebutFinEditable),
      finLabel: row.fin ?? "",
      finIso: row.finIso ?? "",
      dureeFinDemarrageLabel: row.dureeFinDemarrage ?? "",
      dureeFinDemarrageColumnKey: row.dureeFinDemarrageColumnKey ?? "",
      dureeFinDemarrageLeftDateColumnKey: row.dureeFinDemarrageLeftDateColumnKey ?? "",
      dureeFinDemarrageRightIso: row.dureeFinDemarrageRightIso ?? "",
      dureeFinDemarrageEditable: Boolean(row.dureeFinDemarrageEditable),
      demarrageLabel: row.demarrage ?? "",
      demarrageIso: row.demarrageIso ?? "",
      lignePlanningLabel: row.lignePlanning ?? "",
      indiceLabel: row.indice ?? "",
      retardsLabel: row.retards ?? "",

      // Champs de tri explicites (plus fiable que meta uniquement)
      sortIndex: groupSortIndex++,
      sortLignePlanning: row.lignePlanningNum ?? Number.MAX_SAFE_INTEGER,
      sortID2: row.id2Num ?? Number.MAX_SAFE_INTEGER,

      // On garde meta pour debug / usages futurs
      meta: row,
    });
    if (isCoffrageTypeDoc(row.typeDoc)) {
      // COFFRAGE : Date_limite -> Diff_coffrage
      const pCoffrage = createRangeBetweenDates(row.dateLimite, row.diffCoffrage);
      if (pCoffrage) {
        items.push(
          ...createSplitPhaseItems({
            itemIdBase: `${groupId}-p-coffrage`,
            groupId,
            start: pCoffrage.start,
            end: pCoffrage.end,
            label: "Coffrage",
            className: "phase-coffrage",
            title: `
              <b>${escapeHtml(row.taches || "Tache")}</b><br>
              Coffrage<br>
              Date limite : ${fmtDate(pCoffrage.start)} (${fmtDateIso(pCoffrage.start)})<br>
              Diff coffrage : ${fmtDate(pCoffrage.end)} (${fmtDateIso(pCoffrage.end)})
            `,
          })
        );
      }
    } else if (isArmaturesTypeDoc(row.typeDoc)) {
      // ARMATURES : Diff_coffrage -> Diff_armature
      const pArmature = createRangeBetweenDates(row.diffCoffrage, row.diffArmature);
      if (pArmature) {
        items.push(
          ...createSplitPhaseItems({
            itemIdBase: `${groupId}-p-armature`,
            groupId,
            start: pArmature.start,
            end: pArmature.end,
            label: "Armature",
            className: "phase-armature",
            title: `
              <b>${escapeHtml(row.taches || "Tache")}</b><br>
              Armature<br>
              Diff coffrage : ${fmtDate(pArmature.start)} (${fmtDateIso(pArmature.start)})<br>
              Diff armature : ${fmtDate(pArmature.end)} (${fmtDateIso(pArmature.end)})
            `,
          })
        );
      }
    }

    // Debut des travaux : non affiche pour les lignes COFFRAGE
    const demarrageTravauxDate = parseDate(row.demarragesTravaux);
    if (demarrageTravauxDate && !isCoffrageTypeDoc(row.typeDoc)) {
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
            ${fmtDate(demarrageTravauxDate)} (${fmtDateIso(demarrageTravauxDate)})
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
