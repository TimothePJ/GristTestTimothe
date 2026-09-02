import {
  getMonthBounds,
  getMonthShareForRange,
} from "./monthSegments.js";
import { availableDaysAfterLeave } from "./leaveAbsences.js";
import {
  compareText,
  toText,
} from "./utils.js";

function getProjectLabel(projectNumber, projects) {
  const number = toText(projectNumber);
  const project = projects.get(number);
  if (!project) return `${number || "Sans projet"} - Projet introuvable`;
  return project.name ? `${number} - ${project.name}` : number;
}

// Jeu d'absences unique partage par tous les collaborateurs qui n'en ont
// aucune : c'est ce qui leur fait partager la meme entree de cache plus bas.
// Ne jamais y ecrire.
const EMPTY_ABSENCE_SET = new Set();

// Etats possibles d'une cellule de semaine.
//   ""                 : semaine travaillee, le pourcentage fait foi.
//   "leave"            : capacite nulle, aucune charge planifiee.
//   "leave-overloaded" : capacite nulle MAIS des jours y sont planifies. Sans
//                        cet etat la charge disparaitrait de la matrice : aucun
//                        pourcentage n'est calculable (division par zero), donc
//                        les jours se lisent dans weekLeaveDays.
const LEAVE_STATE = "leave";
const LEAVE_OVERLOADED_STATE = "leave-overloaded";

// Un segment couvre un mois : sa charge sur une semaine est la part du mois que
// cette semaine represente, ponderee par la disponibilite reelle de la personne.
// Somme sur toutes les semaines touchant le mois == segment.effectif.
//
// `shareCache` est une simple memoisation de getMonthShareForRange, pure a
// absences constantes : la fonction vendorisee reparcourt le mois ENTIER a
// chaque appel, alors que le meme couple (mois, semaine) revient pour chaque
// projet du collaborateur. Omettre le cache ne change que le temps de calcul.
export function getSegmentDaysInRange(segment, range, absenceSet, shareCache = null) {
  if (!shareCache) {
    return segment.effectif * getMonthShareForRange(segment.monthKey, range.start, range.end, absenceSet);
  }

  const key = `${segment.monthKey}|${range.start.getTime()}`;
  let share = shareCache.get(key);
  if (share === undefined) {
    share = getMonthShareForRange(segment.monthKey, range.start, range.end, absenceSet);
    shareCache.set(key, share);
  }
  return segment.effectif * share;
}

// Memoisation par JEU D'ABSENCES et non par personne : deux collaborateurs sans
// conge ont, a la journee pres, le meme calendrier de disponibilite. Sur un
// annuaire reel la plupart n'ont aucune absence et retombent tous sur
// EMPTY_ABSENCE_SET, donc sur une seule entree.
function getCacheFor(cachesByAbsenceSet, absenceSet, build) {
  let value = cachesByAbsenceSet.get(absenceSet);
  if (!value) {
    value = build();
    cachesByAbsenceSet.set(absenceSet, value);
  }
  return value;
}

// La capacite n'est plus une propriete de la semaine mais du couple
// (collaborateur, semaine) : deux personnes n'ont pas les memes conges.
// availableDaysAfterLeave retire week-ends, jours feries ET conges en un seul
// passage — d'ou l'abandon de getRangeCapacityDays, aveugle aux deux derniers.
function buildWeekCapacities(weeks, absenceSet) {
  return new Map(
    weeks.map((week) => [
      week.value,
      availableDaysAfterLeave(week.range.start, week.range.end, absenceSet),
    ])
  );
}

// Bornes temporelles du mois d'un segment, mises en cache : la matrice les
// relit pour chaque segment et un document en compte plusieurs milliers.
function getSegmentMonthTimes(monthKey, cache) {
  if (cache.has(monthKey)) return cache.get(monthKey);

  const bounds = getMonthBounds(monthKey);
  const times = bounds
    ? { startTime: bounds.startAt.getTime(), endTime: bounds.endAt.getTime() }
    : null;
  cache.set(monthKey, times);
  return times;
}

function createWeekValues(weeks) {
  return Object.fromEntries(weeks.map((week) => [week.value, 0]));
}

function getEmployeeDisplayName(employee) {
  const firstName = toText(employee.firstName);
  const lastName = toText(employee.lastName);
  if (firstName || lastName) {
    return [firstName, lastName.toLocaleUpperCase("fr-FR")].filter(Boolean).join(" ");
  }

  const parts = toText(employee.name).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts.join(" ").toLocaleUpperCase("fr-FR");

  const inferredLastName = parts.pop();
  return [...parts, inferredLastName.toLocaleUpperCase("fr-FR")].join(" ");
}

function getEmployeesWithSegmentOnlyEntries(employees, segmentsByEmployee) {
  const byKey = new Map(employees.map((employee) => [employee.key, employee]));

  segmentsByEmployee.forEach((segments, key) => {
    if (!key || byKey.has(key)) return;
    const name = segments[0]?.employeeName || "";

    byKey.set(key, {
      key,
      // Sans cette cle heritee des segments, un collaborateur absent de
      // l'annuaire filtre perdrait ses conges en silence : la capacite serait
      // calculee sur la seule geometrie du calendrier.
      absenceKey: segments[0]?.absenceKey || "",
      name,
      firstName: "",
      lastName: "",
      email: "",
      service: "",
      role: "",
      external: "",
      idTrefle: "",
      fromSegmentsOnly: true,
    });
  });

  return Array.from(byKey.values()).sort((left, right) =>
    compareText(getEmployeeDisplayName(left), getEmployeeDisplayName(right))
  );
}

function groupSegmentsByEmployee(segments = []) {
  const grouped = new Map();

  segments.forEach((segment) => {
    const key = segment.employeeKey;
    if (!key) return;
    const list = grouped.get(key) || [];
    list.push(segment);
    grouped.set(key, list);
  });

  return grouped;
}

function getPreparedWeeks(weeks) {
  return weeks.map((week, index) => ({
    ...week,
    index,
    startTime: week.startTime ?? week.range.start.getTime(),
    endTime: week.endTime ?? week.range.end.getTime(),
  }));
}

function findFirstOverlappingWeekIndex(weeks, startTime) {
  let low = 0;
  let high = weeks.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (weeks[middle].endTime <= startTime) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

export function formatEmployeeDisplayName(employee) {
  return getEmployeeDisplayName(employee);
}

export function computeWeeklyUtilizationMatrix({
  employees,
  segments = [],
  segmentsByEmployee = null,
  projects,
  weeks,
  absencesByEmployee = null,
  visibleProjectNumbers = null,
  includeEmployeesWithoutProjects = false,
}) {
  const normalizedWeeks = getPreparedWeeks(weeks);
  const groupedSegments = segmentsByEmployee || groupSegmentsByEmployee(segments);
  const matrixEmployees = getEmployeesWithSegmentOnlyEntries(employees, groupedSegments);
  const monthTimesCache = new Map();
  const capacitiesByAbsenceSet = new Map();
  const sharesByAbsenceSet = new Map();

  return matrixEmployees.map((employee) => {
    const projectRowsByNumber = new Map();
    // Lignes que la vue doit conserver : celles ou le segment porte reellement
    // de la charge, et celles dont le mois touche une semaine non travaillee —
    // ces dernieres sont a 0 % mais doivent afficher « Congé ».
    const keptProjectNumbers = new Set();
    const totals = createWeekValues(normalizedWeeks);
    const employeeSegments = groupedSegments.get(employee.key) || [];
    // Sortie anticipee : sans segment ni option d'affichage, cet employe serait
    // ecarte plus bas de toute facon. On evite ainsi de derouler son calendrier
    // de disponibilite pour rien — c'est le cas de la majorite d'un annuaire.
    if (!employeeSegments.length && !includeEmployeesWithoutProjects) {
      return null;
    }
    // Une absenceKey vide signifie « inconnu de Team » : aucune absence connue,
    // ce qui n'est pas une erreur. Resolue une fois par employe, jamais par
    // projet : la capacite ne depend pas de la ligne.
    //
    // La cle vide n'est PAS une cle : on ne l'oppose jamais a l'index. Ce garde
    // explicite remplace le pari tacite que buildAbsenceIndex n'en produira
    // jamais — sinon tous les inconnus de Team heriteraient des conges d'autrui.
    const absenceSet = (employee.absenceKey
      ? absencesByEmployee?.get(employee.absenceKey)
      : null) || EMPTY_ABSENCE_SET;
    const weekCapacities = getCacheFor(capacitiesByAbsenceSet, absenceSet, () =>
      buildWeekCapacities(normalizedWeeks, absenceSet)
    );
    const shareCache = getCacheFor(sharesByAbsenceSet, absenceSet, () => new Map());
    // Capacite nulle = semaine entierement feriee ou en conge. On la marque au
    // lieu de la laisser a 0 %, qui se lirait « disponible ».
    //
    // Etat de BASE, partage par toutes les lignes du collaborateur : la
    // capacite est une propriete du couple (personne, semaine), pas de la ligne
    // projet. Une ligne qui porte de la charge sur une semaine a capacite nulle
    // s'en detache par une copie a la volee (cf. markLeaveOverload).
    const baseWeekStates = Object.fromEntries(
      normalizedWeeks.map((week) => [
        week.value,
        (weekCapacities.get(week.value) || 0) > 0 ? "" : LEAVE_STATE,
      ])
    );
    // Jours planifies sur des semaines a capacite nulle, cumules toutes lignes
    // confondues pour la ligne « Total employe ».
    const totalLeaveDays = createWeekValues(normalizedWeeks);

    // Une charge sur une semaine a capacite nulle n'a pas de pourcentage : on
    // la porte en JOURS, faute de quoi elle serait purement et simplement
    // effacee de la matrice.
    function markLeaveOverload(row, weekValue, days) {
      if (row.weekStates === baseWeekStates) row.weekStates = { ...baseWeekStates };
      row.weekStates[weekValue] = LEAVE_OVERLOADED_STATE;
      if (!row.weekLeaveDays) row.weekLeaveDays = createWeekValues(normalizedWeeks);
      row.weekLeaveDays[weekValue] += days;
      totalLeaveDays[weekValue] += days;
    }

    employeeSegments.forEach((segment) => {
      const projectNumber = segment.projectNumber || "Sans projet";
      if (visibleProjectNumbers && !visibleProjectNumbers.has(projectNumber)) return;

      const monthTimes = getSegmentMonthTimes(segment.monthKey || "", monthTimesCache);
      if (!monthTimes) return;

      let row = projectRowsByNumber.get(projectNumber);
      if (!row) {
        row = {
          type: "project",
          projectNumber,
          projectLabel: getProjectLabel(projectNumber, projects),
          employee,
          employeeLabel: getEmployeeDisplayName(employee),
          weekPercents: createWeekValues(normalizedWeeks),
          weekStates: baseWeekStates,
          weekLeaveDays: null,
        };
        projectRowsByNumber.set(projectNumber, row);
      }

      let weekIndex = findFirstOverlappingWeekIndex(normalizedWeeks, monthTimes.startTime);
      while (weekIndex < normalizedWeeks.length) {
        const week = normalizedWeeks[weekIndex];
        if (week.startTime > monthTimes.endTime) break;

        const capacity = weekCapacities.get(week.value) || 0;
        // La charge se calcule TOUJOURS, capacite nulle comprise : c'est
        // justement la que getMonthShareForRange bascule sur son repli en jours
        // ouvres, et ne pas l'appeler faisait disparaitre les jours planifies.
        const days = getSegmentDaysInRange(segment, week.range, absenceSet, shareCache);

        if (capacity > 0) {
          if (days > 0) {
            row.weekPercents[week.value] += (days / capacity) * 100;
            keptProjectNumbers.add(projectNumber);
          }
        } else {
          keptProjectNumbers.add(projectNumber);
          if (days > 0) markLeaveOverload(row, week.value, days);
        }

        weekIndex += 1;
      }
    });

    const projectRows = Array.from(projectRowsByNumber.values())
      .filter((row) => keptProjectNumbers.has(row.projectNumber))
      .sort((left, right) => compareText(left.projectLabel, right.projectLabel));

    // Aucun ecretage a 100 % : sur un mois non aligne sur les semaines ISO, une
    // semaine de bord garde une capacite minuscule et une charge de 364 % s'y
    // lisait « 100 », c'est-a-dire exactement comme un plan equilibre. Un
    // depassement doit rester un depassement, ligne projet comprise.
    projectRows.forEach((row) => {
      normalizedWeeks.forEach((week) => {
        totals[week.value] += row.weekPercents[week.value] || 0;
      });
    });

    if (!projectRows.length && !includeEmployeesWithoutProjects) {
      return null;
    }

    const visibleProjectRows = projectRows.length
      ? projectRows
      : [{
          type: "empty",
          projectNumber: "",
          projectLabel: "Aucun projet planifi\u00e9",
          employee,
          employeeLabel: getEmployeeDisplayName(employee),
          weekPercents: createWeekValues(normalizedWeeks),
          weekStates: baseWeekStates,
          weekLeaveDays: null,
        }];

    // La ligne total remonte l'alerte des que N'IMPORTE quelle ligne projet a
    // pose de la charge sur une semaine a capacite nulle.
    let totalWeekStates = baseWeekStates;
    let hasLeaveOverload = false;
    normalizedWeeks.forEach((week) => {
      if (!(totalLeaveDays[week.value] > 0)) return;
      if (totalWeekStates === baseWeekStates) totalWeekStates = { ...baseWeekStates };
      totalWeekStates[week.value] = LEAVE_OVERLOADED_STATE;
      hasLeaveOverload = true;
    });

    return {
      employee,
      employeeLabel: getEmployeeDisplayName(employee),
      projectRows: visibleProjectRows,
      totalRow: {
        type: "total",
        projectNumber: "",
        projectLabel: "Total employ\u00e9",
        employee,
        employeeLabel: getEmployeeDisplayName(employee),
        weekPercents: totals,
        weekStates: totalWeekStates,
        weekLeaveDays: hasLeaveOverload ? totalLeaveDays : null,
      },
    };
  }).filter(Boolean);
}
