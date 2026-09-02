// Charge de reference d'un document de Planning_Projet.
//
// Trois colonnes portent la duree, de la plus generale a la plus precise :
//   Duree_Projet   defaut du type de document pour ce projet
//   Duree_Zone     ce type de document, dans cette zone
//   Duree_Force    ce document precis
// La charge RESOLUE n'est jamais stockee : elle se recalcule a chaque lecture.
// C'est ce qui fait qu'un document deplace (nouveau type, nouvelle zone) est
// reclasse tout seul, sans code de « reassignation » a maintenir.
//
// Module PUR : aucun DOM, aucun appel Grist. Testable sous `node --test`.

import { buildRowPhases } from "../top/phases.js";
import { isBusinessDay } from "../utils/timeSegments.js";

// Une duree lue en base. Vide, nulle, negative ou non numerique => null, ce qui
// laisse la main au niveau suivant de la cascade. Un 0 explicite ne veut donc
// PAS dire « zero jour » : pour cela on laisse les trois colonnes vides.
function readDuration(value) {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Les en-tetes de zone de Planning_Projet n'ont ni ID2 ni Type_doc : elles
// structurent l'affichage et ne representent aucun document.
export function isDocumentRow(row, columns) {
  return Boolean(toText(row?.[columns?.id2]) || toText(row?.[columns?.typeDoc]));
}

export function resolveDocumentCharge(row, columns) {
  return (
    readDuration(row?.[columns?.dureeForce]) ??
    readDuration(row?.[columns?.dureeZone]) ??
    readDuration(row?.[columns?.dureeProjet]) ??
    null
  );
}

// La plage de travail d'un document, telle que le pane haut la dessine deja.
// On reutilise buildRowPhases plutot que de redefinir la regle par type : une
// seconde definition divergerait tot ou tard de celle qui est affichee.
// Le marqueur `demarrage` est de largeur nulle (start === end) : on l'ecarte.
export function getDocumentWorkSpan(row, columns) {
  const phases = buildRowPhases(row, columns) || [];
  const workPhase = phases.find((phase) => phase?.type !== "demarrage" && phase?.start && phase?.end);
  if (!workPhase) return null;
  return { start: workPhase.start, end: workPhase.end };
}

function businessDaysByMonth(start, end) {
  const counts = new Map();
  if (!(start instanceof Date) || !(end instanceof Date)) return counts;

  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last) {
    if (isBusinessDay(cursor)) {
      const key = monthKeyOf(cursor);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return counts;
}

// Repartit `chargeDays` sur les mois traverses par [start, end], au prorata des
// JOURS OUVRES de chaque mois.
//
// On travaille en DEMI-JOURNEES entieres pour que l'arrondi a 0,5 soit exact,
// puis on distribue le reliquat au PLUS GRAND RESTE : sans ce report, arrondir
// chaque mois independamment ferait deriver le total du projet de plusieurs
// jours. C'est l'algorithme que portait getSegmentAllocationByMonth avant la
// bascule de TimeSegment au mois.
//
// Aucun plafonnement a la capacite du mois : la charge est une EXIGENCE, pas une
// allocation. 40 j demandes sur un mois de 22 restent 40 — c'est precisement ce
// que la couleur de la ligne Charge doit signaler.
export function spreadChargeOverMonths(chargeDays, start, end) {
  const result = new Map();
  const charge = readDuration(chargeDays);
  if (charge == null) return result;

  const counts = businessDaysByMonth(start, end);
  const totalBusinessDays = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (totalBusinessDays <= 0) return result;

  const totalHalfDays = Math.round(charge * 2);
  if (totalHalfDays <= 0) return result;

  const entries = [...counts.entries()].map(([key, count], index) => {
    const exact = (count / totalBusinessDays) * totalHalfDays;
    const floor = Math.floor(exact);
    return { key, index, halfDays: floor, remainder: exact - floor };
  });

  let left = totalHalfDays - entries.reduce((sum, entry) => sum + entry.halfDays, 0);
  entries
    .slice()
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach((entry) => {
      if (left <= 0) return;
      entry.halfDays += 1;
      left -= 1;
    });

  entries.forEach((entry) => result.set(entry.key, entry.halfDays / 2));
  return result;
}

// Valeur majoritaire d'un groupe, avec les lignes qui s'en ecartent. La fenetre
// ecrivant toujours TOUT le groupe d'un coup, une divergence ne peut venir que
// d'une edition manuelle dans la grille Grist : autant la rendre visible plutot
// que de la trancher en silence. Majorite plutot que « premiere valeur » pour
// qu'une seule ligne aberrante ne fasse pas basculer tout le groupe.
function pickMajority(entries) {
  const tally = new Map();
  entries.forEach(({ value }) => tally.set(value, (tally.get(value) || 0) + 1));
  let kept = null;
  let bestCount = -1;
  [...tally.entries()].forEach(([value, count]) => {
    if (count > bestCount || (count === bestCount && value < kept)) {
      kept = value;
      bestCount = count;
    }
  });
  return { kept, others: entries.filter((entry) => entry.value !== kept) };
}

function collectDivergences(documents, columns) {
  const groups = new Map();
  documents.forEach((doc) => {
    const projectValue = readDuration(doc.row?.[columns.dureeProjet]);
    if (projectValue != null) {
      const key = `project|${doc.typeDoc}`;
      if (!groups.has(key)) groups.set(key, { scope: "project", typeDoc: doc.typeDoc, zone: "", entries: [] });
      groups.get(key).entries.push({ id2: doc.id2, value: projectValue });
    }
    const zoneValue = readDuration(doc.row?.[columns.dureeZone]);
    if (zoneValue != null) {
      const key = `zone|${doc.typeDoc}|${doc.zone}`;
      if (!groups.has(key)) groups.set(key, { scope: "zone", typeDoc: doc.typeDoc, zone: doc.zone, entries: [] });
      groups.get(key).entries.push({ id2: doc.id2, value: zoneValue });
    }
  });

  const divergences = [];
  groups.forEach((group) => {
    const distinct = new Set(group.entries.map((entry) => entry.value));
    if (distinct.size <= 1) return;
    const { kept, others } = pickMajority(group.entries);
    divergences.push({ scope: group.scope, typeDoc: group.typeDoc, zone: group.zone, kept, others });
  });
  return divergences;
}

export function computeProjectCharge(planningRows, columns) {
  const byMonth = new Map();
  let unplacedDays = 0;
  let totalDays = 0;

  const documents = (planningRows || [])
    .filter((row) => isDocumentRow(row, columns))
    .map((row) => ({
      row,
      id2: toText(row?.[columns.id2]),
      typeDoc: toText(row?.[columns.typeDoc]),
      zone: toText(row?.[columns.zone]),
    }));

  documents.forEach((doc) => {
    const charge = resolveDocumentCharge(doc.row, columns);
    if (charge == null) return;
    totalDays += charge;

    const span = getDocumentWorkSpan(doc.row, columns);
    if (!span) {
      unplacedDays += charge;
      return;
    }

    spreadChargeOverMonths(charge, span.start, span.end).forEach((days, monthKey) => {
      byMonth.set(monthKey, Math.round(((byMonth.get(monthKey) || 0) + days) * 100) / 100);
    });
  });

  return {
    byMonth,
    unplacedDays: Math.round(unplacedDays * 100) / 100,
    totalDays: Math.round(totalDays * 100) / 100,
    divergences: collectDivergences(documents, columns),
  };
}
