// Fuzz de la regle de lissage (top/taskSmoothing.js) : des milliers de cas
// tires au hasard, a graine fixe (mulberry32), verifient les regles strictes de
// §4.2 (findSmoothingViolations vide), le determinisme (deux appels, meme
// resultat) et le compte des taches avancees. En cas d'echec, le message donne
// la graine : SEEDS = [graine] rejoue le cas.
//
// Par cas : aujourd'hui entre le 01/01/2027 et le 28/04/2027 ; 0 a 30 taches
// entre janvier et aout 2027, de types tires dans TYPE_ORDER ; 0 a 4 groupes
// « g||n » formes d'un coffrage puis d'armatures d'echeance >= la sienne ;
// 20 % de taches realisees ; maximum general et maximum de chaque type : aucun
// (60 %) ou 1 a 4 ; dates manuelles (spec 2026-11-09, §4) sur 15 % des taches
// non realisees, de janvier a aout 2027.
//
// Verifications ajoutees au brief : aucun console.warn (smoothTasks avertit si
// son resultat enfreint une regle stricte) ; le resultat, ligne par ligne, ne
// depend pas de l'ordre d'entree ; les depassements rapportes sont exactement
// ceux du resultat recompte ; un coffrage marque pulledFor est avance (ou
// borne a la date d'une armature fixee, followsManual), et l'armature qu'il
// nomme est avancee ou fixee, du meme groupe. Un second fuzz
// (« etendu ») tire aussi des groupes a deux coffrages et des armatures
// d'echeance anterieure a leur coffrage.
//
// Plans fixes (dates manuelles) : chacun est a sa date manuelle et marque
// manual ; manualCount et delayedCount sont justes ; aucun coffrage mobile
// n'est apres une armature fixee de son groupe ; forced implique
// followsManual, qui ne vise qu'un coffrage d'un groupe a armature fixee. Un
// plan fixe n'est pas mobile : il sort de l'oracle de la preference 4, et ne
// doit jamais etre marque rule4Exception.
//
// Preference 4 (§4.3) : dans une meme file, deux taches mobiles ne se doublent
// jamais, sauf si l'une d'elles est soustraite a l'ordre par la regle 4 dans
// le cas tire (rule4Exception : armature retenue par son coffrage, tache d'un
// entrainement, tache retiree de la remise en ordre pour la regle 4). Une
// armature liee a un coffrage que rien ne retient y reste soumise. Le champ ne
// doit viser que des taches mobiles liees par les donnees (armature et
// coffrage d'un meme groupe). Verifie par les trois fuzz ; le troisieme
// (« cible ») tire la forme qui mettait le garde-fou en defaut : mois pleins
// de coffrages, groupes dont les armatures sont retenues, armatures sans
// groupe, armatures liees a un coffrage plus tot.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  smoothTasks,
  findSmoothingViolations,
  monthKeyOf,
} from "../assets/js/top/taskSmoothing.js";
import { TYPE_ORDER } from "../assets/js/top/taskLabels.js";
import { compareChartTasks } from "../assets/js/top/taskLoadModel.js";

const SEEDS = Array.from({ length: 2000 }, (_, i) => i + 1);
const TARGETED_SEEDS = Array.from({ length: 10000 }, (_, i) => i + 1);

// Generateur pseudo-aleatoire a graine (mulberry32) : nombres dans [0, 1).
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Jours depuis le 01/01/1970 (UTC) <-> AAAA-MM-JJ.
const DAY_MS = 86400000;
const dayOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const isoOf = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

const FIRST_DAY = dayOf("2027-01-01");
const LAST_DAY = dayOf("2027-08-31");

function makeCase(seed, { extended = false, monthly = false, zero = false } = {}) {
  const rand = mulberry32(seed);
  const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
  const dayBetween = (from, to) => int(from, to);
  const limit = () => (rand() < 0.6 ? null : int(1, 4));

  const today = isoOf(dayBetween(FIRST_DAY, dayOf("2027-04-28")));
  const size = int(0, 30);
  const tasks = [];
  const push = (type, day, groupKey) => {
    const rowId = tasks.length + 1;
    tasks.push({
      rowId,
      id2: String(rowId),
      name: "T" + rowId,
      zone: "",
      groupe: "",
      groupKey,
      type,
      dueIso: isoOf(day),
      realized: rand() < 0.2,
    });
  };

  const groupCount = int(0, 4);
  for (let g = 1; g <= groupCount && tasks.length < size; g += 1) {
    const groupKey = `g||${g}`;
    const coffrageDay = dayBetween(FIRST_DAY, LAST_DAY);
    push("COFFRAGE", coffrageDay, groupKey);
    if (extended && rand() < 0.3 && tasks.length < size) {
      push("COFFRAGE", dayBetween(FIRST_DAY, LAST_DAY), groupKey);
    }
    const armatures = int(1, 4);
    for (let a = 0; a < armatures && tasks.length < size; a += 1) {
      const from = extended && rand() < 0.3 ? FIRST_DAY : coffrageDay;
      push("ARMATURES", dayBetween(from, LAST_DAY), groupKey);
    }
  }
  while (tasks.length < size) {
    push(TYPE_ORDER[int(0, TYPE_ORDER.length - 1)], dayBetween(FIRST_DAY, LAST_DAY), "");
  }
  // Ordre d'entree quelconque : la sortie doit le suivre.
  for (let i = tasks.length - 1; i > 0; i -= 1) {
    const j = int(0, i);
    [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
  }

  const maxByType = {};
  TYPE_ORDER.forEach((type) => {
    maxByType[type] = limit();
  });
  const settings = { maxTotal: limit(), maxByType };
  if (monthly) addMonthlySettings(settings, today, int, rand, zero);
  // Dates manuelles (spec 2026-11-09, §4) : 15 % des taches non realisees, une
  // date de janvier a aout 2027 (parfois avant aujourd'hui ou avant le mois de
  // depart, parfois apres l'echeance). Tirees en dernier : les taches et les
  // maximums de chaque graine restent ceux d'avant.
  const manualDates = {};
  tasks.forEach((task) => {
    if (!task.realized && rand() < 0.15) manualDates[String(task.rowId)] = isoOf(dayBetween(FIRST_DAY, LAST_DAY));
  });
  settings.manualDates = manualDates;
  return { today, tasks, settings };
}

// Fuzz « mois » : mois de depart (absent 30 %, sinon de novembre 2026 au mois
// apres aujourd'hui, donc parfois passe, parfois le mois courant ou plus tard)
// et 0 a 3 mois precis de janvier a aout 2027, chacun avec un maximum general
// (une fois sur deux) et 0 a 2 maximums par type, de 1 a 5 — de 0 a 5 avec
// `zero` (un 0 interdit le mois, ou le type ce mois-la).
const MONTH_KEYS = ["2026-11", "2026-12", ...Array.from({ length: 8 }, (_, i) => `2027-0${i + 1}`)];

function addMonthlySettings(settings, today, int, rand, zero = false) {
  const low = zero ? 0 : 1;
  if (rand() >= 0.3) {
    const last = MONTH_KEYS.indexOf(monthKeyOf(today)) + 1;
    settings.startMonth = MONTH_KEYS[int(0, last)];
  }
  const maxByMonth = {};
  const count = int(0, 3);
  for (let k = 0; k < count; k += 1) {
    const month = MONTH_KEYS[int(2, MONTH_KEYS.length - 1)];
    const entry = { maxTotal: rand() < 0.5 ? null : int(low, 5), maxByType: {} };
    const types = int(0, 2);
    for (let n = 0; n < types; n += 1) entry.maxByType[TYPE_ORDER[int(0, TYPE_ORDER.length - 1)]] = int(low, 5);
    maxByMonth[month] = entry;
  }
  settings.maxByMonth = maxByMonth;
}

// Cas « cible » : aujourd'hui en janvier ou fevrier 2027 ; 0 a 8 coffrages de
// remplissage (groupes « k||n » sans armature, qui occupent des mois) ; 1 a 4
// groupes « a||n » d'un ou deux coffrages et de 1 a 3 armatures, le plus
// souvent dans le mois qui suit leur coffrage ; 1 a 7 armatures sans groupe ;
// 0 a 4 taches d'autres types ; 10 % de coffrages realises. Maximum Armature
// et Coffrage bas (1 ou 2), maximum general parfois.
function makeTargetedCase(seed) {
  const rand = mulberry32(seed);
  const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
  const last = dayOf("2027-09-30");
  const today = isoOf(int(FIRST_DAY, dayOf("2027-02-28")));
  const tasks = [];
  const push = (type, day, groupKey, realized = false) => {
    const rowId = tasks.length + 1;
    tasks.push({
      rowId,
      id2: String(rowId),
      name: "T" + rowId,
      zone: "",
      groupe: "",
      groupKey,
      type,
      dueIso: isoOf(day),
      realized,
    });
  };

  const fillers = int(0, 8);
  for (let k = 0; k < fillers; k += 1) push("COFFRAGE", int(FIRST_DAY, last - 60), `k||${k}`, rand() < 0.1);
  const groups = int(1, 4);
  for (let g = 0; g < groups; g += 1) {
    const groupKey = `a||${g}`;
    const coffrageDay = int(FIRST_DAY, last - 30);
    const coffrages = rand() < 0.3 ? 2 : 1;
    for (let c = 0; c < coffrages; c += 1) push("COFFRAGE", coffrageDay + int(0, 20) * c, groupKey, rand() < 0.1);
    const armatures = int(1, 3);
    for (let a = 0; a < armatures; a += 1) {
      push("ARMATURES", rand() < 0.8 ? coffrageDay + int(0, 30) : int(FIRST_DAY, last), groupKey);
    }
  }
  const loose = int(1, 7);
  for (let k = 0; k < loose; k += 1) push("ARMATURES", int(FIRST_DAY, last), "");
  const others = int(0, 4);
  for (let k = 0; k < others; k += 1) push(["NDC", "COUPES", "AUTRES"][int(0, 2)], int(FIRST_DAY, last), "");
  for (let i = tasks.length - 1; i > 0; i -= 1) {
    const j = int(0, i);
    [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
  }

  const settings = {
    maxTotal: rand() < 0.6 ? null : int(2, 5),
    maxByType: {
      ARMATURES: rand() < 0.15 ? null : int(1, 2),
      COFFRAGE: rand() < 0.3 ? null : int(1, 2),
    },
  };
  return { today, tasks, settings };
}

// Mois de depart attendu (AAAA-MM) : startMonth s'il est avant le mois
// courant, sinon le mois courant.
function startKeyOf(settings, today) {
  const current = monthKeyOf(today);
  return settings.startMonth && settings.startMonth < current ? settings.startMonth : current;
}

// Maximum d'une serie pour un mois : celui du mois precis, sinon celui de tous
// les mois.
function maxOf(settings, month, series) {
  const own = settings.maxByMonth?.[month];
  if (series === "TOTAL") return own?.maxTotal ?? settings.maxTotal ?? null;
  return own?.maxByType?.[series] ?? settings.maxByType?.[series] ?? null;
}

// Depassements attendus d'apres le resultat : mois de depart et suivants,
// series ayant un maximum dans ce mois, compte > maximum (sans la raison).
function recountOverflows(result, settings, today) {
  const counts = new Map();
  const bump = (month, series) => {
    const key = `${month} ${series}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  result.tasks.forEach((task) => {
    bump(monthKeyOf(task.smoothedIso), "TOTAL");
    bump(monthKeyOf(task.smoothedIso), task.type);
  });
  const expected = [];
  counts.forEach((count, key) => {
    const [month, series] = key.split(" ");
    const max = maxOf(settings, month, series);
    if (max != null && month >= startKeyOf(settings, today) && count > max) {
      expected.push(`${month} ${series} ${count}/${max}`);
    }
  });
  return expected.sort();
}

const monthOf = (iso) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
// Date manuelle d'un plan FIXE (non realise, rowId present dans
// settings.manualDates ; les dates tirees sont toujours valides), sinon null.
const fixedIsoOf = (task, settings) =>
  task.realized || task.rowId == null ? null : settings.manualDates?.[String(task.rowId)] ?? null;
// Mobile : non realisee, non fixee, et a venir (mois courant ou plus tard) ou
// en retard d'un mois posterieur au mois de depart (depart passe : elle peut
// etre avancee jusqu'a lui). Une tache en retard sans mois de depart avant elle
// reste a sa place ; un plan fixe ne bouge pas de sa date manuelle.
const isMobile = (task, today, settings) => {
  if (task.realized || fixedIsoOf(task, settings)) return false;
  const due = monthOf(task.dueIso);
  return due >= monthOf(today) || due > monthOf(`${startKeyOf(settings, today)}-01`);
};

// Liee a la regle 4 par les donnees : armature dont le groupe (groupKey non
// vide) a un coffrage non realise, ou coffrage non realise dont le groupe a
// une armature.
function isLinked(tasks, task) {
  if (!task.groupKey) return false;
  const sameGroup = (other) => other.groupKey === task.groupKey;
  if (task.type === "ARMATURES") {
    return tasks.some((other) => other.type === "COFFRAGE" && !other.realized && sameGroup(other));
  }
  if (task.type === "COFFRAGE") {
    return !task.realized && tasks.some((other) => other.type === "ARMATURES" && sameGroup(other));
  }
  return false;
}

// Preference 4 : couples (« a>b ») de taches mobiles de la meme file, dont la
// plus tot (a) finit dans un mois plus tardif que b, et dont aucune n'est
// soustraite a la preference 4 par la regle 4 DANS CE CAS (rule4Exception du
// resultat : armature retenue par son coffrage, tache d'un entrainement,
// tache retiree de la remise en ordre pour la regle 4). Une armature liee a un
// coffrage que rien ne retient reste soumise a l'ordre. Files : une par type
// des qu'un maximum par type existe (tous les mois ou un mois precis), une
// seule sinon.
function unjustifiedInversions(tasks, settings, today, result) {
  const typed = (maxByType) => Object.values(maxByType || {}).some((max) => max != null);
  const byType =
    typed(settings.maxByType) || Object.values(settings.maxByMonth || {}).some((own) => typed(own.maxByType));
  const ordered = tasks
    .map((task, i) => ({ task, out: result.tasks[i] }))
    .filter(({ task, out }) => isMobile(task, today, settings) && !out.rule4Exception);
  const inversions = [];
  // Priorite aux taches a venir : une tache EN RETARD (rendue mobile par un
  // depart passe) ne prend que la place qu'aucune tache a venir ne demande. Elle
  // peut donc rester dans son mois quand une tache a venir, plus tardive, a pris
  // avant elle la derniere place libre ; les echanger ferait arriver la tache a
  // venir dans un mois plein (regle 5). Seul ce cas est dispense.
  const late = (task) => monthOf(task.dueIso) < monthOf(today);
  ordered.forEach((a) => {
    ordered.forEach((b) => {
      if (byType && a.task.type !== b.task.type) return;
      if (late(a.task) && !late(b.task)) return;
      if (compareChartTasks(a.task, b.task) < 0 && monthOf(a.out.smoothedIso) > monthOf(b.out.smoothedIso)) {
        inversions.push(`${a.task.rowId}>${b.task.rowId}`);
      }
    });
  });
  return inversions;
}

// Lignes marquees rule4Exception sans pouvoir l'etre : une tache figee, un plan
// fixe (il n'est pas mobile, et l'armature fixee n'entre pas dans
// l'entrainement de ses coffrages), ou une tache sans lien avec la regle 4
// (l'oracle ci-dessus ne doit dispenser personne d'autre).
function unfoundedExceptions(tasks, today, settings, result) {
  return tasks
    .filter((task, i) => result.tasks[i].rule4Exception && !(isMobile(task, today, settings) && isLinked(tasks, task)))
    .map((task) => task.rowId);
}

function checkCase(seed, options) {
  const { today, tasks, settings } = makeCase(seed, options);
  const where = `graine ${seed}${options?.extended ? " (étendu)" : ""}${options?.monthly ? " (mois)" : ""}${options?.zero ? " (0)" : ""}`;
  const result = smoothTasks(tasks, settings, today);

  assert.deepEqual(findSmoothingViolations(tasks, settings, today, result), [], where);
  assert.deepEqual(smoothTasks(tasks, settings, today), result, `${where} : non déterministe`);
  assert.deepEqual(
    result.tasks.map((task) => task.rowId),
    tasks.map((task) => task.rowId),
    `${where} : ordre de sortie`
  );
  const byRowId = (r) => ({ ...r, tasks: r.tasks.slice().sort((a, b) => a.rowId - b.rowId) });
  assert.deepEqual(
    byRowId(smoothTasks(tasks.slice().reverse(), settings, today)),
    byRowId(result),
    `${where} : dépend de l'ordre d'entrée`
  );
  // Tache avancee : mois lisse avant celui de l'echeance, hors plan fixe (un
  // plan fixe n'est jamais « avance », et un coffrage borne a la date de son
  // armature fixee, dans son propre mois, non plus).
  assert.equal(
    result.movedCount,
    result.tasks.filter((task) => !fixedIsoOf(task, settings) && monthOf(task.smoothedIso) < monthOf(task.dueIso)).length,
    `${where} : movedCount`
  );
  assert.deepEqual(
    result.overflows.map((o) => `${o.month} ${o.series} ${o.count}/${o.max}`).sort(),
    recountOverflows(result, settings, today),
    `${where} : dépassements`
  );
  assert.deepEqual(unjustifiedInversions(tasks, settings, today, result), [], `${where} : préférence 4`);
  assert.deepEqual(unfoundedExceptions(tasks, today, settings, result), [], `${where} : rule4Exception`);

  // Plans fixes : chacun a sa date manuelle, marque manual ; comptes.
  const fixed = result.tasks.filter((task) => fixedIsoOf(task, settings));
  result.tasks.forEach((task) => {
    const fixedIso = fixedIsoOf(task, settings);
    assert.equal(task.manual, Boolean(fixedIso), `${where} : manual de la ligne ${task.rowId}`);
    if (fixedIso) assert.equal(task.smoothedIso, fixedIso, `${where} : plan fixé ${task.rowId} hors de sa date`);
    if (task.forced) assert.ok(task.followsManual, `${where} : forced sans followsManual (ligne ${task.rowId})`);
    if (task.followsManual) {
      assert.ok(
        task.type === "COFFRAGE" &&
          Boolean(task.groupKey) &&
          result.tasks.some((other) => other.type === "ARMATURES" && other.manual && other.groupKey === task.groupKey),
        `${where} : followsManual sur la ligne ${task.rowId}`
      );
    }
  });
  assert.equal(result.manualCount, fixed.length, `${where} : manualCount`);
  assert.equal(
    result.delayedCount,
    fixed.filter((task) => task.smoothedIso > task.dueIso).length,
    `${where} : delayedCount`
  );
  // Aucun coffrage mobile n'est apres une armature fixee de son groupe.
  fixed
    .filter((armature) => armature.type === "ARMATURES" && armature.groupKey)
    .forEach((armature) => {
      tasks.forEach((coffrage, i) => {
        if (coffrage.type !== "COFFRAGE" || coffrage.groupKey !== armature.groupKey) return;
        if (!isMobile(coffrage, today, settings)) return;
        assert.ok(
          result.tasks[i].smoothedIso <= armature.smoothedIso,
          `${where} : coffrage ${coffrage.rowId} après son armature fixée ${armature.rowId}`
        );
      });
    });

  const byId2 = new Map(result.tasks.map((task) => [task.id2, task]));
  result.tasks.forEach((task) => {
    if (task.pulledFor == null) return;
    const armature = byId2.get(task.pulledFor);
    assert.ok(
      task.type === "COFFRAGE" && (task.moved || task.followsManual),
      `${where} : pulledFor sur la ligne ${task.rowId}`
    );
    assert.ok(
      armature?.type === "ARMATURES" && (armature.moved || armature.manual) && armature.groupKey === task.groupKey,
      `${where} : armature ${task.pulledFor} de la ligne ${task.rowId}`
    );
    if (armature.manual) {
      assert.ok(
        task.smoothedIso <= armature.smoothedIso,
        `${where} : coffrage ${task.rowId} après son armature fixée ${task.pulledFor}`
      );
    }
  });
}

test("fuzz : règles strictes, déterminisme, movedCount (graines 1 à 2000)", (ctx) => {
  const warn = ctx.mock.method(console, "warn", () => {});
  SEEDS.forEach((seed) => checkCase(seed));
  assert.equal(warn.mock.callCount(), 0, "console.warn appelé");
});

test("fuzz étendu : deux coffrages par groupe, armatures avant leur coffrage", (ctx) => {
  const warn = ctx.mock.method(console, "warn", () => {});
  SEEDS.forEach((seed) => checkCase(seed, { extended: true }));
  assert.equal(warn.mock.callCount(), 0, "console.warn appelé");
});

test("fuzz ciblé : armatures retenues, aucune tâche doublée hors exception de la règle 4 (graines 1 à 10000)", (ctx) => {
  const warn = ctx.mock.method(console, "warn", () => {});
  TARGETED_SEEDS.forEach((seed) => {
    const { today, tasks, settings } = makeTargetedCase(seed);
    const where = `graine ${seed} (ciblé)`;
    const result = smoothTasks(tasks, settings, today);
    assert.deepEqual(findSmoothingViolations(tasks, settings, today, result), [], where);
    assert.deepEqual(unjustifiedInversions(tasks, settings, today, result), [], `${where} : préférence 4`);
    assert.deepEqual(unfoundedExceptions(tasks, today, settings, result), [], `${where} : rule4Exception`);
  });
  assert.equal(warn.mock.callCount(), 0, "console.warn appelé");
});

test("fuzz mois : mois de départ et maximums d'un mois précis (graines 1 à 2000, simple et étendu)", (ctx) => {
  const warn = ctx.mock.method(console, "warn", () => {});
  SEEDS.forEach((seed) => {
    checkCase(seed, { monthly: true });
    checkCase(seed, { monthly: true, extended: true });
  });
  assert.equal(warn.mock.callCount(), 0, "console.warn appelé");
});

test("fuzz mois à 0 : un mois précis peut interdire toute tâche, ou un type (graines 1 à 2000, simple et étendu)", (ctx) => {
  const warn = ctx.mock.method(console, "warn", () => {});
  SEEDS.forEach((seed) => {
    checkCase(seed, { monthly: true, zero: true });
    checkCase(seed, { monthly: true, zero: true, extended: true });
  });
  assert.equal(warn.mock.callCount(), 0, "console.warn appelé");
});
