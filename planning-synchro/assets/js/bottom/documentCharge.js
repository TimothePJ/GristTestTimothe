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
// CHARGE PAR METIER (2026-10-26) : chaque colonne porte deux durees, celle des
// ingenieurs puis celle des projeteurs, separees par « ; » : « 2,5;3 ». Un
// nombre seul (l'ancien format, ou une colonne numerique) vaut pour les
// ingenieurs. Une part vide (« ;3 », « 2,5 ») n'a pas de valeur a ce niveau. La
// cascade Force > Zone > Projet se resout METIER PAR METIER : une Force « ;5 »
// ne fixe que les projeteurs, les ingenieurs reprennent la Zone ou le Projet.
//
// Module PUR : aucun DOM, aucun appel Grist. Testable sous `node --test`.

import { buildRowPhases } from "../top/phases.js";
import { isBusinessDay } from "../utils/timeSegments.js";

// Les deux metiers, dans l'ordre de la cellule (« ingenieurs;projeteurs »).
export const CHARGE_ROLES = ["ingenieurs", "projeteurs"];

// Une duree lue en base. Vide, nulle, negative ou non numerique => null, ce qui
// laisse la main au niveau suivant de la cascade. Un 0 explicite ne veut donc
// PAS dire « zero jour » : pour cela on laisse les trois colonnes vides.
function readDuration(value) {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

// Valeur d'une colonne Duree_* -> { ingenieurs, projeteurs } (nombre ou null
// chacun). Un nombre, ou un texte sans « ; », vaut pour les ingenieurs.
export function parseDurationPair(value) {
  if (typeof value === "number") return { ingenieurs: readDuration(value), projeteurs: null };
  const parts = value == null ? [] : String(value).split(";");
  return { ingenieurs: readDuration(parts[0]), projeteurs: readDuration(parts[1]) };
}

// Une duree en texte francais : 2.5 -> "2,5" ; null -> "".
function formatDuration(value) {
  return value == null ? "" : String(value).replace(".", ",");
}

// { ingenieurs, projeteurs } -> texte a ecrire dans la colonne : « 2,5;3 »,
// « ;3 », l'ancien format « 2,5 » quand seuls les ingenieurs ont une valeur, et
// "" quand aucun (ce qui rend la main au niveau du dessus).
export function formatDurationPair(pair) {
  const ingenieurs = formatDuration(pair?.ingenieurs ?? null);
  const projeteurs = formatDuration(pair?.projeteurs ?? null);
  if (!projeteurs) return ingenieurs;
  return `${ingenieurs};${projeteurs}`;
}

function hasDuration(pair) {
  return CHARGE_ROLES.some((role) => pair[role] != null);
}

// Cle de comparaison d'une paire (divergences) : « 2;3 », « 2; », « ;3 ».
function pairKey(pair) {
  return `${pair.ingenieurs ?? ""};${pair.projeteurs ?? ""}`;
}

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Tache de la vue Synthese de Planning Projet (service Synthese, nom de tache rempli,
// sans type de document) : meme avec un N° (ID2), ce n'est pas un document.
function isSynthesePlanningTask(row, columns) {
  const service = toText(row?.[columns?.service ?? "Service"])
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return (
    service === "synthese" &&
    !toText(row?.[columns?.typeDoc]) &&
    Boolean(
      toText(row?.[columns?.taskName ?? "Taches"]) ||
        toText(row?.[columns?.taskNameAlt ?? "Tache"])
    )
  );
}

// Les en-tetes de zone de Planning_Projet n'ont ni ID2 ni Type_doc : elles
// structurent l'affichage et ne representent aucun document.
export function isDocumentRow(row, columns) {
  if (isSynthesePlanningTask(row, columns)) return false;
  return Boolean(toText(row?.[columns?.id2]) || toText(row?.[columns?.typeDoc]));
}

// Charge d'un document -> { ingenieurs, projeteurs }, chaque metier par sa
// propre cascade Force > Zone > Projet.
export function resolveDocumentCharge(row, columns) {
  const levels = [columns?.dureeForce, columns?.dureeZone, columns?.dureeProjet].map((column) =>
    parseDurationPair(row?.[column])
  );
  const charge = {};
  CHARGE_ROLES.forEach((role) => {
    charge[role] = levels.map((level) => level[role]).find((value) => value != null) ?? null;
  });
  return charge;
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
// qu'une seule ligne aberrante ne fasse pas basculer tout le groupe. Les
// valeurs sont des PAIRES (ingenieurs, projeteurs) : deux lignes divergent des
// que l'une des deux parts differe. `kept` est la paire majoritaire.
// A egalite de voix, la plus petite paire l'emporte : ingenieurs d'abord, puis
// projeteurs, une part vide passant apres une part remplie.
function comparePairs(left, right) {
  for (const role of CHARGE_ROLES) {
    const a = left[role] ?? Number.POSITIVE_INFINITY;
    const b = right[role] ?? Number.POSITIVE_INFINITY;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

function pickMajority(entries) {
  const tally = new Map();
  entries.forEach(({ key, value }) => {
    const slot = tally.get(key) || { value, count: 0 };
    slot.count += 1;
    tally.set(key, slot);
  });
  let keptKey = null;
  let kept = null;
  let bestCount = -1;
  tally.forEach((slot, key) => {
    if (slot.count > bestCount || (slot.count === bestCount && comparePairs(slot.value, kept) < 0)) {
      keptKey = key;
      kept = slot.value;
      bestCount = slot.count;
    }
  });
  return {
    kept,
    others: entries.filter((entry) => entry.key !== keptKey).map(({ id2, value }) => ({ id2, value })),
  };
}

function collectDivergences(documents, columns) {
  const groups = new Map();
  const addEntry = (key, group, doc, value) => {
    if (!groups.has(key)) groups.set(key, { ...group, entries: [] });
    groups.get(key).entries.push({ id2: doc.id2, value, key: pairKey(value) });
  };
  documents.forEach((doc) => {
    const projectValue = parseDurationPair(doc.row?.[columns.dureeProjet]);
    if (hasDuration(projectValue)) {
      addEntry(`project|${doc.typeDoc}`, { scope: "project", typeDoc: doc.typeDoc, zone: "" }, doc, projectValue);
    }
    const zoneValue = parseDurationPair(doc.row?.[columns.dureeZone]);
    if (hasDuration(zoneValue)) {
      addEntry(
        `zone|${doc.typeDoc}|${doc.zone}`,
        { scope: "zone", typeDoc: doc.typeDoc, zone: doc.zone },
        doc,
        zoneValue
      );
    }
  });

  const divergences = [];
  groups.forEach((group) => {
    const distinct = new Set(group.entries.map((entry) => entry.key));
    if (distinct.size <= 1) return;
    const { kept, others } = pickMajority(group.entries);
    divergences.push({ scope: group.scope, typeDoc: group.typeDoc, zone: group.zone, kept, others });
  });
  return divergences;
}

// Lignes Planning_Projet -> charge du projet :
//   { byRole: { ingenieurs: RoleCharge, projeteurs: RoleCharge }, divergences }
//   RoleCharge = { byMonth: Map "AAAA-MM" -> jours, unplacedDays, totalDays }
// Chaque metier se repartit sur la plage de travail du document, comme avant.
export function computeProjectCharge(planningRows, columns) {
  const byRole = {};
  CHARGE_ROLES.forEach((role) => {
    byRole[role] = { byMonth: new Map(), unplacedDays: 0, totalDays: 0 };
  });

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
    if (!hasDuration(charge)) return;
    const span = getDocumentWorkSpan(doc.row, columns);

    CHARGE_ROLES.forEach((role) => {
      const days = charge[role];
      if (days == null) return;
      const target = byRole[role];
      target.totalDays += days;
      if (!span) {
        target.unplacedDays += days;
        return;
      }
      spreadChargeOverMonths(days, span.start, span.end).forEach((monthDays, monthKey) => {
        target.byMonth.set(monthKey, Math.round(((target.byMonth.get(monthKey) || 0) + monthDays) * 100) / 100);
      });
    });
  });

  CHARGE_ROLES.forEach((role) => {
    byRole[role].unplacedDays = Math.round(byRole[role].unplacedDays * 100) / 100;
    byRole[role].totalDays = Math.round(byRole[role].totalDays * 100) / 100;
  });

  return { byRole, divergences: collectDivergences(documents, columns) };
}
