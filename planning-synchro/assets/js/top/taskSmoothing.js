// Regle de lissage des taches du graphique (spec 2026-10-23, §4).
//
// L'utilisateur fixe un nombre maximum de taches par mois, en general (tous
// types) et/ou par type de document. Ce module calcule un planning LISSE dans
// lequel les taches en trop sont realisees plus tot, jamais plus tard. Il ne
// touche a aucune date du planning reel : il rend une copie de chaque tache,
// avec sa date lissee a cote de son echeance.
//
// Module PUR, sans DOM. Les taches sont les ChartTask de top/taskLoadModel.js ;
// la date du jour est passee explicitement (todayIso, AAAA-MM-JJ, horloge locale
// du navigateur) ; les reglages sont { maxTotal, maxByType, startMonth?,
// maxByMonth? } (top/smoothingSettings.js) : maximums entiers >= 1, une valeur
// absente = pas de maximum ; maxByMonth donne, pour un mois precis, un maximum
// general et/ou par type qui remplace celui de tous les mois (monthMaxima), 0
// compris (aucune tache, ou aucune de ce type, ce mois-la) ; startMonth
// (AAAA-MM) est le mois de depart (§4.8).
//
// VOCABULAIRE (§3.3) : le mois courant est celui de todayIso. Le MOIS DE DEPART
// est le premier mois ou une tache peut etre placee : startMonth s'il est fixe
// et pas apres le mois courant, sinon le mois courant (smoothingStartMonth).
// Une tache est FIGEE si elle est realisee, ou si elle est en retard (echeance
// dans un mois passe) sans mois de depart avant elle (isFrozenTask) : elle garde
// son mois et compte dans ce mois. Les autres sont MOBILES : les taches A VENIR,
// et, avec un depart passe, les taches EN RETARD d'un mois posterieur au depart
// (2026-10-28). Avec un depart passe, les mois passes du depart au mois courant
// deviennent des CIBLES (vides ou non, leurs taches figees comptent). Les taches
// a venir y sont placees d'abord, les taches en retard ensuite, dans la place
// qui reste : leur mobilite ne prive jamais les mois a venir. Les mois d'avant
// le depart ne sont ni cible ni signales.
//
// REGLES STRICTES (§4.2), verifiees par findSmoothingViolations :
//   1. jamais plus tard ;
//   2. jamais avant le mois de depart ; et, quand le depart est le mois
//      courant, jamais a une date anterieure a aujourd'hui ;
//   3. les taches figees (realisees, ou en retard sans mois de depart avant
//      elles) ne bougent pas ;
//   4. armature apres son coffrage : une armature avancee n'a jamais une date
//      lissee anterieure a celle d'un coffrage NON REALISE de son groupe
//      (groupKey ; un groupKey vide = pas de groupe, donc pas de coffrage) ;
//   5. un mois qui recoit une tache respecte, apres lissage, le maximum de SON
//      type et le maximum general (les seules series qu'elle fait monter), tels
//      qu'ils valent pour CE mois ;
//   6. deterministe.
//
// ALGORITHME, EN UN COUP D'OEIL :
//   1. Placement (passe montante, du mois de depart au dernier mois) : tant
//      qu'un mois depasse un de SES maximums, sa tache mobile la plus tot part
//      dans le mois le plus TARDIF avant lui (et pas avant le mois de depart),
//      vide ou non, ou elle tient (placeEntry). Les depassements
//      PAR TYPE passent avant le maximum general : la tache qui avance pour son
//      type soulage aussi le total (exemple E : sans cet ordre, deux armatures
//      plus tot que le coffrage avanceraient pour le total, puis le coffrage
//      pour son type, soit trois taches au lieu de deux). Une tache sans place
//      reste dans son mois (preference 2 : le depassement reste le plus tard
//      possible ; exemple B).
//      Une ARMATURE ne s'arrete dans un mois k que si ses coffrages non
//      realises y sont deja, ou plus tot ; sinon elle les ENTRAINE (§4.6) :
//      chacun part dans le mois le plus tardif <= k ou il tient (maximum
//      Coffrage et general), et porte pulledFor = N° de l'armature (exemples I
//      et « mois intermediaire »). Si l'un d'eux n'a aucune place, un mois plus
//      tot n'aiderait pas (moins de place encore) : l'armature reste, et son
//      mois est signale « coffrage-sans-place » (exemple J).
//   2. Remise en ordre (preference 4) : dans chaque file, les taches reprennent
//      les mois obtenus en 1 dans l'ordre chronologique (la i-eme tache de la
//      file prend le i-eme mois) ; aucune ne double une tache plus tot de sa
//      file (exemple H). Une SEULE file quand seul le maximum general existe,
//      une file PAR TYPE des qu'un maximum par type existe, pour tous les mois
//      ou pour un mois precis (exemple H bis).
//      Les comptes que surveillent les maximums ne changent pas. Les taches
//      d'un entrainement (coffrage entraine et armature qui l'a entraine) n'y
//      entrent pas : leur mois est lie par la regle 4.
//   3. Garde-fou : si la remise en ordre d'une file fait apparaitre des
//      violations d'une regle stricte absentes apres l'etape 1, la file reprend
//      ses mois de l'etape 1, des taches en sortent (elles gardent ces mois) et
//      le reste est remis en ordre sans elles. Chaque essai rate en retire au
//      moins une : au plus autant d'essais que de taches. Qui sort :
//        - l'essai enfreint la regle 4 : l'armature et le coffrage en cause,
//          eux seuls. Ses violations de la regle 5 peuvent n'en etre que la
//          consequence (l'armature remise en ordre laisse sa place a une autre
//          tache dans un mois deja plein) : elles ne retirent personne, et
//          tombent une fois sorties les armatures en cause ;
//        - l'essai n'enfreint que la regle 5 : l'armature liee a un coffrage
//          que l'essai a sortie d'un mois en faute. Un tel mois deborde depuis
//          l'etape 1 et n'y garde que ses propres taches : si une tache plus
//          tardive y arrive, c'est qu'une tache du mois en est partie. C'est
//          une armature retenue par son coffrage (hors LIMITE CONNUE
//          ci-dessous), qui a pu reprendre legalement le mois de celui-ci :
//          elle sort, seule. Les autres armatures liees deplacees n'y sont
//          pour rien et restent dans la file, comme la tache visee ;
//        - sinon : les taches que visent les violations. Ce cas n'arrive que
//          dans la LIMITE CONNUE ci-dessous.
//      Les taches restees dans la file gardent entre elles l'ordre
//      chronologique. Hors LIMITE CONNUE, seules les taches marquees
//      rule4Exception (armature retenue par son coffrage, coffrage entraine et
//      armature qui l'a entraine, tache sortie d'une file pour la regle 4)
//      peuvent doubler ou etre doublees : c'est l'exception de la regle 4 a la
//      preference 4. Les fuzz (tests/taskSmoothingFuzz.test.mjs) verifient
//      qu'aucune autre tache n'en double une autre de sa file.
// Puis dates lissees (§4.5) et depassements restants par mois x serie (§4.7),
// recomptes sur le resultat final. Un resultat final hors des regles strictes
// ne doit jamais arriver : il est signale par un console.warn (le fuzz,
// tests/taskSmoothingFuzz.test.mjs, verifie qu'il n'arrive pas).
//
// LIMITE ASSUMEE (preference 1 de §4.3) : laisser le moins de taches possible
// au-dessus des maximums est VISE, pas garanti. Le calcul se fait en une passe,
// sans recherche exhaustive ; rarement, il laisse un depassement qu'un
// deplacement en chaine aurait resolu (avancer une tache d'un autre type pour
// liberer de la place sous le maximum general). Ce depassement est rapporte
// dans overflows, et aucune regle stricte n'est enfreinte.
//
// LIMITE CONNUE (preference 4) : un coffrage entraine libere sa place dans le
// mois qu'il quitte. Si ce mois precede un mois deja traite, reste en
// depassement, la place va a la prochaine tache qui la demande, plus tardive,
// et non aux taches de ce mois deja traite, qui n'ont plus d'essai. La remise en ordre ne
// peut pas la leur rendre : la tache plus tardive arriverait dans leur mois,
// plein (regle 5). Le garde-fou la laisse donc a cette place (branche
// « sinon ») : elle double les taches de ce mois, sans rule4Exception. Les
// fuzz du depot ne tirent jamais ce cas ; un generateur construit pour lui le
// trouve dans moins de 1 % des cas. Rendre la place aux taches du mois en
// depassement retablirait l'ordre, mais laisserait parfois une tache de plus
// au-dessus des maximums. Choix tranche (ruling 8) : la preference 1 passe
// avant la preference 4, cette reprise n'est donc PAS appliquee.

import { TYPE_ORDER } from "./taskLabels.js";
// Ordre des taches (echeance, ID2 numerique, rowId) : le meme que celui de la
// liste du modele, pour que le lissage (preference 5) et la liste du mois
// departagent les taches de la meme facon.
import { compareChartTasks } from "./taskLoadModel.js";

// Serie generale (tous types confondus), a cote des six types.
const TOTAL = "TOTAL";
const COFFRAGE = "COFFRAGE";
const ARMATURES = "ARMATURES";

// --- dates (chaines AAAA-MM-JJ, sans Date locale : aucun fuseau horaire) -----

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})/;

function pad2(value) {
  return String(value).padStart(2, "0");
}

// "2027-04-12" -> "2027-04". Date invalide -> "".
export function monthKeyOf(iso) {
  const match = ISO_MONTH.exec(String(iso ?? ""));
  return match ? `${match[1]}-${match[2]}` : "";
}

// Decale une date de deltaMonths mois en gardant son jour, borne au dernier
// jour du mois d'arrivee : ("2027-05-31", -1) -> "2027-04-30". Date invalide -> "".
export function shiftIsoByMonths(iso, deltaMonths) {
  const match = ISO_DATE.exec(String(iso ?? ""));
  if (!match) return "";
  const index = Number(match[1]) * 12 + Number(match[2]) - 1 + deltaMonths;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(Math.min(Number(match[3]), lastDay))}`;
}

// En interne, un mois est un entier (annee * 12 + mois - 1) : comparaisons et
// parcours d'un mois a l'autre sans arithmetique de dates.
function monthIndexOf(iso) {
  const match = ISO_MONTH.exec(String(iso ?? ""));
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : Number.NaN;
}

function monthKeyOfIndex(index) {
  const year = Math.floor(index / 12);
  return `${year}-${pad2(index - year * 12 + 1)}`;
}

// --- mois de depart (§4.8) ---------------------------------------------------------

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

// Mois de depart du lissage (AAAA-MM) : settings.startMonth s'il est valide et
// avant le mois courant, sinon le mois courant (celui de todayIso). Un depart
// apres le mois courant n'a pas de sens : il vaut le mois courant.
export function smoothingStartMonth(settings, todayIso) {
  const current = monthKeyOf(todayIso);
  const start = settings?.startMonth;
  return typeof start === "string" && MONTH_KEY.test(start) && start < current ? start : current;
}

// --- maximums --------------------------------------------------------------------

// Entier >= 1 (>= 0 pour un mois precis, `allowZero`), sinon pas de maximum.
// Les reglages arrivent deja valides (smoothingSettings) ; on ne fait ici que
// s'en premunir. Un 0 de mois precis interdit le mois (a ce type, ou a tout
// type) : ses taches a venir sont en trop, aucune n'y est placee — fitsIn et
// isOver le traitent comme n'importe quel maximum.
function readLimit(value, allowZero = false) {
  return Number.isInteger(value) && value >= (allowZero ? 0 : 1) ? value : null;
}

// { maxTotal, maxByType } -> { maxTotal: entier | null, maxByType: Map type -> entier }.
function readMaxima(source, { allowZero = false } = {}) {
  const maxTotal = readLimit(source?.maxTotal, allowZero);
  const maxByType = new Map();
  Object.entries(source?.maxByType || {}).forEach(([type, value]) => {
    const limit = readLimit(value, allowZero);
    if (limit != null) maxByType.set(type, limit);
  });
  return { maxTotal, maxByType };
}

// settings -> { maxTotal, maxByType (tous les mois), byMonth : Map mois (entier)
// -> maximums d'un mois precis, typed : types ayant un maximum dans au moins un
// mois, hasTotal : un maximum general existe dans au moins un mois, active }.
function readLimits(settings) {
  const base = readMaxima(settings);
  const byMonth = new Map();
  Object.entries(settings?.maxByMonth || {}).forEach(([key, value]) => {
    if (!MONTH_KEY.test(key)) return;
    const maxima = readMaxima(value, { allowZero: true });
    if (maxima.maxTotal != null || maxima.maxByType.size > 0) byMonth.set(monthIndexOf(key), maxima);
  });
  const all = [base, ...byMonth.values()];
  const typed = new Set(all.flatMap((maxima) => [...maxima.maxByType.keys()]));
  const hasTotal = all.some((maxima) => maxima.maxTotal != null);
  return { ...base, byMonth, typed, hasTotal, active: hasTotal || typed.size > 0 };
}

// Maximum d'une serie dans un mois (entier) : celui du mois precis s'il le
// fixe, sinon celui de tous les mois, sinon null.
function limitOf(limits, month, series) {
  const own = limits.byMonth.get(month);
  if (series === TOTAL) return own?.maxTotal ?? limits.maxTotal;
  return own?.maxByType.get(series) ?? limits.maxByType.get(series) ?? null;
}

// Maximums qui valent pour un mois (AAAA-MM), en objets simples : ceux du mois
// precis, valeur par valeur, sinon ceux de tous les mois. Pour les fenetres
// (liste du mois) : le meme calcul que le lissage.
export function monthMaxima(settings, monthKey) {
  const limits = readLimits(settings);
  const month = monthIndexOf(monthKey);
  const own = limits.byMonth.get(month);
  const maxByType = {};
  new Set([...limits.maxByType.keys(), ...(own ? own.maxByType.keys() : [])]).forEach((type) => {
    maxByType[type] = limitOf(limits, month, type);
  });
  return { maxTotal: limitOf(limits, month, TOTAL), maxByType };
}

// Series surveillees, dans l'ordre des depassements rapportes : TOTAL d'abord,
// puis les types dans l'ordre du graphique (un type inconnu en dernier). Une
// serie surveillee peut n'avoir de maximum que dans certains mois.
function watchedSeries(limits) {
  const rank = (type) => {
    const index = TYPE_ORDER.indexOf(type);
    return index === -1 ? TYPE_ORDER.length : index;
  };
  const types = [...limits.typed].sort(
    (a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)
  );
  return limits.hasTotal ? [TOTAL, ...types] : types;
}

// --- comptes mois x serie -------------------------------------------------------

// Compteur mois -> serie -> nombre de taches ; une tache compte dans TOTAL et
// dans son type.
function createCounter() {
  const byMonth = new Map();
  return {
    get(month, series) {
      return byMonth.get(month)?.get(series) || 0;
    },
    add(month, type, delta) {
      let slot = byMonth.get(month);
      if (!slot) {
        slot = new Map();
        byMonth.set(month, slot);
      }
      slot.set(TOTAL, (slot.get(TOTAL) || 0) + delta);
      slot.set(type, (slot.get(type) || 0) + delta);
    },
    months() {
      return [...byMonth.keys()].sort((a, b) => a - b);
    },
  };
}

function isOver(counter, limits, month, series) {
  const max = limitOf(limits, month, series);
  return max != null && counter.get(month, series) > max;
}

// Une tache de ce type tient-elle dans ce mois ? (regle 5 : son type et le
// total, les seules series qu'elle fait monter, avec les maximums du mois.)
function fitsIn(counter, limits, month, type) {
  const typeMax = limitOf(limits, month, type);
  if (typeMax != null && counter.get(month, type) >= typeMax) return false;
  const totalMax = limitOf(limits, month, TOTAL);
  return totalMax == null || counter.get(month, TOTAL) < totalMax;
}

// --- taches figees (regle 3) -------------------------------------------------------

// Une tache est FIGEE si elle est realisee, ou si elle est en retard (echeance
// dans un mois passe) SANS mois de depart avant elle. Avec un depart passe, une
// tache en retard d'un mois posterieur au depart est MOBILE : elle peut etre
// avancee dans les mois du depart a son mois, comme une tache a venir
// (2026-10-28, demande de l'utilisateur : « j'ai selectionne octobre 2024, il y
// a beaucoup de marge mais il s'en sert pas »). Avec le depart par defaut (le
// mois courant), aucune tache en retard n'a de mois avant elle : toutes restent
// figees, comme avant.
function isFrozenTask(task, dueMonth, currentMonth, startMonth) {
  return Boolean(task?.realized) || (dueMonth < currentMonth && dueMonth <= startMonth);
}

// --- armature / coffrage (regle 4, §4.6) -------------------------------------------

// Coffrages qui contraignent les armatures : non realises (un coffrage realise
// est deja diffuse) et d'un groupe non vide (groupKey vide = pas de groupe).
// groupKey -> positions de ces coffrages dans la liste.
function indexCoffrages(tasks) {
  const byGroup = new Map();
  tasks.forEach((task, index) => {
    if (task?.type !== COFFRAGE || task.realized || !task.groupKey) return;
    if (!byGroup.has(task.groupKey)) byGroup.set(task.groupKey, []);
    byGroup.get(task.groupKey).push(index);
  });
  return byGroup;
}

// Positions des coffrages qui contraignent cette tache : ceux de son groupe
// pour une armature, aucun pour un autre type ou une armature sans groupe.
function coffragesOf(coffrageIndex, task) {
  if (task?.type !== ARMATURES || !task.groupKey) return [];
  return coffrageIndex.get(task.groupKey) || [];
}

// --- resultat ----------------------------------------------------------------------

// Entrees de travail (une par tache, dans l'ordre d'entree) -> SmoothedTask[].
// Date lissee (§4.5) : une tache non avancee garde son echeance ; avancee de n
// mois, elle garde son jour (borne a la fin du mois). Quand le depart est le
// mois courant, une tache qui y arrive a une date deja passee prend aujourd'hui ;
// avec un depart passe, les dates passees sont permises et le jour est garde.
// Les coffrages d'abord : une armature avancee dans le meme mois qu'un coffrage
// de son groupe prend au plus tot la date lissee de ce coffrage (elle reste dans
// son mois, donc avant son echeance). Un coffrage entraine n'a ainsi jamais une
// date posterieure a celle de son armature.
function buildSmoothedTasks(entries, coffrageIndex, todayIso, currentMonth, startMonth) {
  const dates = entries.map((entry) => {
    if (!(entry.dueMonth - entry.month > 0)) return entry.task.dueIso;
    const shifted = shiftIsoByMonths(entry.task.dueIso, entry.month - entry.dueMonth);
    const startsToday = startMonth === currentMonth && entry.month === currentMonth;
    return startsToday && shifted < todayIso ? todayIso : shifted;
  });
  entries.forEach((entry, i) => {
    if (!(entry.dueMonth - entry.month > 0)) return;
    coffragesOf(coffrageIndex, entry.task).forEach((j) => {
      if (entries[j].month === entry.month && dates[j] > dates[i]) dates[i] = dates[j];
    });
  });
  return entries.map((entry, i) => {
    const monthsAdvanced = entry.dueMonth - entry.month;
    return {
      ...entry.task,
      smoothedIso: dates[i],
      monthsAdvanced,
      moved: monthsAdvanced > 0,
      frozen: entry.frozen,
      pulledFor: entry.pulledFor,
      rule4Exception: entry.rule4Exception,
    };
  });
}

// tasks (ChartTask[]) + maximums + date du jour -> SmoothingResult :
//   { active, tasks: SmoothedTask[] (meme ordre que l'entree), movedCount,
//     overflows: [{ month: "AAAA-MM", series: "TOTAL" | type, count, max,
//                   reason }] tries par mois puis par serie }
//   SmoothedTask = ChartTask & { smoothedIso, monthsAdvanced, moved, frozen,
//                                pulledFor, rule4Exception }
//   pulledFor : pour un coffrage entraine par une armature (§4.6), le N° (id2)
//   de cette armature ; null sinon.
//   rule4Exception : vrai pour une tache que la regle 4 soustrait a la
//   preference 4 (§4.3) : armature retenue par son coffrage, coffrage entraine
//   et armature qui l'a entraine, armature ou coffrage retire de la remise en
//   ordre parce qu'elle y passerait avant son coffrage. Seules ces taches
//   peuvent doubler une tache plus tot de leur file, ou etre doublees par une
//   plus tardive (verifie par tests/taskSmoothingFuzz.test.mjs) ; faux sinon.
// Sans aucun maximum : active = false et chaque tache garde son echeance.
export function smoothTasks(tasks, settings, todayIso) {
  const list = Array.isArray(tasks) ? tasks : [];
  const limits = readLimits(settings);
  const currentMonth = monthIndexOf(todayIso);
  const startMonth = monthIndexOf(smoothingStartMonth(settings, todayIso));
  const coffrageIndex = indexCoffrages(list);

  const entries = list.map((task) => {
    const dueMonth = monthIndexOf(task.dueIso);
    return {
      task,
      dueMonth,
      month: dueMonth,
      frozen: isFrozenTask(task, dueMonth, currentMonth, startMonth),
      pulledFor: null,
      rule4Exception: false,
    };
  });
  const smoothedNow = () => buildSmoothedTasks(entries, coffrageIndex, todayIso, currentMonth, startMonth);

  if (!limits.active) {
    return {
      active: false,
      tasks: smoothedNow(),
      movedCount: 0,
      overflows: [],
    };
  }

  const counter = createCounter();
  entries.forEach((entry) => counter.add(entry.month, entry.task.type, 1));
  const mobiles = entries
    .filter((entry) => !entry.frozen)
    .sort((a, b) => compareChartTasks(a.task, b.task));

  // Etape 1 — placement. Les taches ne partent que vers des mois deja traites
  // (avant le leur), et un coffrage entraine va au plus au mois de son
  // armature : rien n'est jamais pousse vers un mois plus tardif. Quand un mois
  // est traite, il ne contient donc que ses propres taches, moins les coffrages
  // deja entraines plus tot.

  // Taches d'un entrainement (coffrages entraines et armatures qui les ont
  // entraines), tenues hors de la remise en ordre ; armatures restees faute de
  // place pour leur coffrage (raison « coffrage-sans-place » de leur mois) ;
  // taches que le garde-fou retire d'une file pour la regle 4. Les trois font
  // l'exception de la regle 4 a la preference 4 (rule4Exception).
  const pullInvolved = new Set();
  const blockedByCoffrage = new Set();
  const removedForRule4 = new Set();

  const moveEntry = (entry, month) => {
    counter.add(entry.month, entry.task.type, -1);
    counter.add(month, entry.task.type, 1);
    entry.month = month;
  };

  // Mois le plus tardif de [mois de depart, upTo] ou une tache de ce type
  // tient, ou null.
  const latestFit = (type, upTo) => {
    for (let month = upTo; month >= startMonth; month -= 1) {
      if (fitsIn(counter, limits, month, type)) return month;
    }
    return null;
  };

  // Avance si possible une tache du mois fromMonth vers le mois le plus tardif
  // de [mois de depart, fromMonth - 1] ou elle tient. Pour une armature, ce mois
  // k doit aussi recevoir, ou deja suivre, ses coffrages non realises : ceux
  // qui sont plus tard que k sont entraines, chacun dans le mois le plus
  // tardif <= k ou il tient (l'armature est posee d'abord : elle compte dans le
  // total de k). Le plus tardif des coffrages se place le premier : ils gardent
  // leur ordre chronologique, quel que soit l'ordre d'entree. Si l'un d'eux n'a
  // aucune place, tout est defait et la recherche s'arrete : un mois plus tot
  // n'offrirait au coffrage qu'une partie des memes mois.
  const placeEntry = (entry, fromMonth) => {
    const coffrages = coffragesOf(coffrageIndex, entry.task)
      .map((j) => entries[j])
      .sort((a, b) => compareChartTasks(b.task, a.task));
    for (let k = fromMonth - 1; k >= startMonth; k -= 1) {
      if (!fitsIn(counter, limits, k, entry.task.type)) continue;
      const behind = coffrages.filter((coffrage) => coffrage.month > k);
      // Filet de securite : un coffrage FIGE non realise (en retard, sans mois
      // de depart avant lui) ne bouge pas, et l'armature ne pourrait passer
      // avant lui, ni en k ni plus tot ; elle resterait, retenue par lui. Depuis
      // que les coffrages en retard d'un mois posterieur au depart sont mobiles
      // (2026-10-28), un tel coffrage est au plus au mois de depart, donc jamais
      // apres k : le cas ne se presente plus.
      if (behind.some((coffrage) => coffrage.frozen)) {
        blockedByCoffrage.add(entry);
        return;
      }
      const undo = [[entry, entry.month]];
      moveEntry(entry, k);
      const allPlaced = behind.every((coffrage) => {
        const target = latestFit(coffrage.task.type, k);
        if (target == null) return false;
        undo.push([coffrage, coffrage.month]);
        moveEntry(coffrage, target);
        return true;
      });
      if (!allPlaced) {
        undo.reverse().forEach(([moved, month]) => moveEntry(moved, month));
        blockedByCoffrage.add(entry);
        return;
      }
      if (behind.length > 0) {
        pullInvolved.add(entry);
        behind.forEach((coffrage) => {
          coffrage.pulledFor = String(entry.task.id2 ?? "");
          pullInvolved.add(coffrage);
        });
      }
      return;
    }
  };

  // Prochaine tache a essayer dans ce mois : la plus tot de celles dont le type
  // deborde, a defaut la plus tot de toutes si le total deborde. Un coffrage
  // deja entraine hors du mois n'en fait plus partie.
  const pickCandidate = (monthTasks, tried, month) => {
    const pending = monthTasks.filter((entry) => !tried.has(entry) && entry.month === month);
    const byType = pending.find((entry) => isOver(counter, limits, month, entry.task.type));
    if (byType) return byType;
    return isOver(counter, limits, month, TOTAL) ? pending[0] || null : null;
  };

  // Passe montante sur un groupe de taches candidates : chaque mois source, du
  // plus tot au plus tardif, avance ses taches en trop.
  const placeCandidates = (candidates) => {
    const sourceMonths = [...new Set(candidates.map((entry) => entry.dueMonth))].sort((a, b) => a - b);
    sourceMonths.forEach((month) => {
      const monthTasks = candidates.filter((entry) => entry.dueMonth === month);
      const tried = new Set();
      // Chaque tour essaie une tache encore jamais essayee : au plus
      // monthTasks.length tours. Le plafond n'est qu'un filet de securite.
      let rounds = 0;
      let candidate = pickCandidate(monthTasks, tried, month);
      while (candidate) {
        if (rounds >= monthTasks.length) {
          console.warn(`[lissage] placement interrompu en ${monthKeyOfIndex(month)} : plafond de tours atteint.`);
          break;
        }
        rounds += 1;
        tried.add(candidate);
        placeEntry(candidate, month);
        candidate = pickCandidate(monthTasks, tried, month);
      }
    });
  };

  // Les taches A VENIR d'abord, puis les taches EN RETARD rendues mobiles par un
  // depart passe, dans la place qui reste. Placees ensemble, les taches en
  // retard (plus tot dans le calendrier, donc traitees les premieres) prenaient
  // les mois libres et en privaient les mois a venir : sur l'export ERA (maximum
  // 4 partout, depart juin 2025), 26 taches en trop a venir au lieu de 3. En
  // second, elles ne prennent qu'une place que personne d'autre ne demande : le
  // resultat des mois a venir ne se degrade jamais.
  placeCandidates(mobiles.filter((entry) => entry.dueMonth >= currentMonth));
  placeCandidates(mobiles.filter((entry) => entry.dueMonth < currentMonth));

  // Etapes 2 et 3 — remise en ordre de chaque file, avec garde-fou. La
  // reference est l'ensemble des violations du placement (vide, sauf defaut).
  // Un essai remet en ordre les taches de la file encore candidates sur leurs
  // mois de l'etape 1 ; s'il fait apparaitre une violation nouvelle, la file
  // reprend ses mois de l'etape 1, des taches en sortent (choix ci-dessous) et
  // on recommence. Chaque essai rate retire au moins une tache : l'essai
  // fullQueue.length + 1 n'arrive jamais (filet de securite).
  const violationsNow = () => collectViolations(list, settings, todayIso, { tasks: smoothedNow() });
  let reference = new Set(violationsNow().map((violation) => violation.key));
  const queues = new Map();
  // Une file par classe de priorite (a venir / en retard), comme au placement :
  // une tache en retard restee dans un mois plein, melee aux taches a venir,
  // ferait echouer chaque essai de remise en ordre (une tache a venir y
  // arriverait, regle 5), et les taches a venir perdraient leur ordre.
  mobiles
    .filter((entry) => !pullInvolved.has(entry))
    .forEach((entry) => {
      const series = limits.typed.size > 0 ? entry.task.type : TOTAL;
      const key = `${entry.dueMonth < currentMonth ? "retard" : "a-venir"}|${series}`;
      if (!queues.has(key)) queues.set(key, []);
      queues.get(key).push(entry);
    });
  queues.forEach((fullQueue) => {
    const placed = new Map(fullQueue.map((entry) => [entry, entry.month]));
    const restorePlaced = () => fullQueue.forEach((entry) => {
      entry.month = placed.get(entry);
    });
    let queue = fullQueue;
    for (let attempt = 0; ; attempt += 1) {
      if (attempt > fullQueue.length) {
        console.warn("[lissage] remise en ordre interrompue : plafond d'essais atteint.");
        restorePlaced();
        return;
      }
      const ordered = queue.map((entry) => placed.get(entry)).sort((a, b) => a - b);
      if (queue.every((entry, i) => ordered[i] === placed.get(entry))) return;
      queue.forEach((entry, i) => {
        entry.month = ordered[i];
      });
      const now = violationsNow();
      const fresh = now.filter((violation) => !reference.has(violation.key));
      if (fresh.length === 0) {
        reference = new Set(now.map((violation) => violation.key));
        return;
      }
      // Mois ou tombent les violations nouvelles (mois de l'essai de la tache
      // visee), et armature liee a un coffrage (regle 4) que l'essai a sortie
      // d'un de ces mois : a relever avant de rendre a la file ses mois de
      // l'etape 1.
      const faultMonths = new Set(fresh.map((violation) => entries[violation.culprits[0]]?.month));
      const freer = queue.find(
        (entry) =>
          faultMonths.has(placed.get(entry)) &&
          entry.month !== placed.get(entry) &&
          coffragesOf(coffrageIndex, entry.task).length > 0
      );
      restorePlaced();
      // Qui sort de la file :
      //   - l'essai enfreint la regle 4 : l'armature et le coffrage en cause,
      //     eux seuls. Ses violations de la regle 5 peuvent n'en etre que la
      //     consequence (l'armature remise en ordre laisse sa place a une autre
      //     tache dans un mois deja plein) : elles ne retirent personne, et
      //     tombent d'elles-memes une fois les armatures en cause sorties ;
      //   - l'essai n'enfreint que la regle 5 : l'armature liee qui a quitte le
      //     mois en faute (elle a pu reprendre legalement le mois de son
      //     coffrage, et laisser sa place, dans un mois plein, a une tache plus
      //     tardive). Une autre armature liee deplacee n'y est pour rien : elle
      //     reste dans la file, comme la tache que vise la violation ;
      //   - sinon : les taches que visent les violations. N'arrive que si une
      //     place liberee par un coffrage entraine a ete prise par une tache
      //     plus tardive (LIMITE CONNUE de l'en-tete) : celle-ci la garde.
      const rule4 = fresh.filter((violation) => violation.rule === 4);
      const onlyRule5 = fresh.every((violation) => violation.rule === 5);
      let culprits;
      if (rule4.length > 0) {
        culprits = new Set(rule4.flatMap((violation) => violation.culprits.map((i) => entries[i])));
        queue.forEach((entry) => {
          if (culprits.has(entry)) removedForRule4.add(entry);
        });
      } else if (onlyRule5 && freer) {
        culprits = new Set([freer]);
      } else {
        culprits = new Set(fresh.flatMap((violation) => violation.culprits.map((i) => entries[i])));
      }
      const rest = queue.filter((entry) => !culprits.has(entry));
      // Aucune tache de la file n'est visee (ne doit pas arriver) : la file
      // garde ses mois de l'etape 1.
      if (rest.length === queue.length) return;
      queue = rest;
    }
  });

  [...blockedByCoffrage, ...pullInvolved, ...removedForRule4].forEach((entry) => {
    entry.rule4Exception = true;
  });
  const smoothed = smoothedNow();

  // Depassements restants (§4.7), mois de depart et suivants, comptes sur les
  // dates lissees finales, chacun avec le maximum de SON mois. Raison, dans cet
  // ordre : les taches figees depassent deja seules (« taches-realisees », ou
  // « taches-passees » dans un mois passe, ou elles sont realisees ou en
  // retard) ; mois courant quand le lissage part de lui (rien ne peut aller
  // plus tot) ; une armature retenue par son coffrage est dans ce mois (series
  // Armature et Total) ; sinon plus de place avant. Un mois passe ne recoit que
  // des taches qui y tiennent : il ne deborde que par ses taches figees.
  const finalCounter = createCounter();
  smoothed.forEach((task) => finalCounter.add(monthIndexOf(task.smoothedIso), task.type, 1));
  const blockedMonths = new Set([...blockedByCoffrage].map((entry) => entry.month));
  const frozenCounter = createCounter();
  entries
    .filter((entry) => entry.frozen)
    .forEach((entry) => frozenCounter.add(entry.month, entry.task.type, 1));
  const series = watchedSeries(limits);
  const overflows = [];
  finalCounter
    .months()
    .filter((month) => month >= startMonth)
    .forEach((month) => {
      series.forEach((name) => {
        const max = limitOf(limits, month, name);
        const count = finalCounter.get(month, name);
        if (max == null || count <= max) return;
        let reason = "plus-de-place";
        if (frozenCounter.get(month, name) > max) reason = month < currentMonth ? "taches-passees" : "taches-realisees";
        else if (month === currentMonth && startMonth === currentMonth) reason = "mois-en-cours";
        else if (blockedMonths.has(month) && (name === ARMATURES || name === TOTAL)) {
          reason = "coffrage-sans-place";
        }
        overflows.push({ month: monthKeyOfIndex(month), series: name, count, max, reason });
      });
    });

  const result = {
    active: true,
    tasks: smoothed,
    movedCount: smoothed.filter((task) => task.moved).length,
    overflows,
  };
  const remaining = findSmoothingViolations(list, settings, todayIso, result);
  if (remaining.length > 0) {
    console.warn("[lissage] résultat hors des règles strictes (§4.2) :", remaining);
  }
  return result;
}

// Verifie les regles strictes de §4.2 sur un resultat (celui de smoothTasks ou
// un resultat a controler) : liste de messages, vide si tout tient.
//   - regle 1 : smoothedIso <= dueIso ;
//   - regle 2 : une tache dont la date change n'arrive pas avant le mois de
//     depart, ni, quand le depart est le mois courant, avant aujourd'hui ;
//   - regle 3 : une tache figee (isFrozenTask : realisee, ou en retard sans
//     mois de depart avant elle) garde son echeance ;
//   - regle 4 : une armature dont la date change n'est pas avant un coffrage
//     non realise de son groupe (groupKey non vide) : date lissee du coffrage
//     <= date lissee de l'armature ;
//   - regle 5 : dans le mois d'arrivee d'une tache avancee, le compte de son
//     type et le total respectent les maximums de ce mois.
export function findSmoothingViolations(tasks, settings, todayIso, result) {
  return collectViolations(tasks, settings, todayIso, result).map((violation) => violation.message);
}

// Meme controle, en violations structurees pour le garde-fou de smoothTasks :
//   { rule, key, culprits, message }
//   - rule : numero de la regle (0 : resultat mal forme) ;
//   - key : identifie la violation independamment des dates (regle, position
//     de la tache, et coffrage ou serie en cause), pour la comparer d'un essai
//     a l'autre ;
//   - culprits : positions (dans la liste) des taches qu'elle vise : la tache
//     elle-meme, plus son coffrage pour la regle 4 (l'armature est passee trop
//     tot, ou le coffrage trop tard).
function collectViolations(tasks, settings, todayIso, result) {
  const list = Array.isArray(tasks) ? tasks : [];
  const smoothed = Array.isArray(result?.tasks) ? result.tasks : [];
  if (smoothed.length !== list.length) {
    return [
      {
        rule: 0,
        key: "longueur",
        culprits: [],
        message: `Le lissage rend ${smoothed.length} tâches pour ${list.length} en entrée.`,
      },
    ];
  }
  const limits = readLimits(settings);
  const currentMonth = monthIndexOf(todayIso);
  const startKey = smoothingStartMonth(settings, todayIso);
  const startMonth = monthIndexOf(startKey);
  const coffrageIndex = indexCoffrages(list);
  const counter = createCounter();
  smoothed.forEach((task) => counter.add(monthIndexOf(task.smoothedIso), task.type, 1));

  const violations = [];
  list.forEach((task, i) => {
    const out = smoothed[i];
    const label = `N° ${task.id2} (ligne ${task.rowId})`;
    const report = (rule, detail, text, culprits = [i]) => {
      violations.push({
        rule,
        key: `${rule}|${i}|${detail}`,
        culprits,
        message: `${label} : ${text} (règle ${rule}).`,
      });
    };
    if (out?.rowId !== task.rowId) {
      violations.push({
        rule: 0,
        key: `0|${i}|`,
        culprits: [i],
        message: `${label} : absente du résultat à sa place (ligne ${out?.rowId} trouvée).`,
      });
      return;
    }
    const smoothedIso = out.smoothedIso;
    if (!(smoothedIso <= task.dueIso)) {
      report(1, "", `date lissée ${smoothedIso} après l'échéance ${task.dueIso}`);
    }
    if (smoothedIso === task.dueIso) return;

    const dueMonth = monthIndexOf(task.dueIso);
    const month = monthIndexOf(smoothedIso);
    if (startMonth === currentMonth) {
      if (!(month >= currentMonth) || !(smoothedIso >= todayIso)) {
        report(2, "", `placée le ${smoothedIso}, avant aujourd'hui (${todayIso})`);
      }
    } else if (!(month >= startMonth)) {
      report(2, "", `placée le ${smoothedIso}, avant le début du lissage (${startKey})`);
    }
    if (isFrozenTask(task, dueMonth, currentMonth, startMonth)) {
      report(3, "", `tâche figée déplacée au ${smoothedIso}`);
    }
    coffragesOf(coffrageIndex, task).forEach((j) => {
      const coffrageIso = smoothed[j]?.smoothedIso;
      if (!(coffrageIso <= smoothedIso)) {
        report(
          4,
          j,
          `armature avancée au ${smoothedIso}, avant son coffrage N° ${list[j].id2} (${coffrageIso})`,
          [i, j]
        );
      }
    });
    if (month < dueMonth) {
      const typeMax = limitOf(limits, month, task.type);
      const typeCount = counter.get(month, task.type);
      if (typeMax != null && typeCount > typeMax) {
        report(5, task.type, `avancée en ${monthKeyOf(smoothedIso)}, ${task.type} ${typeCount} / ${typeMax}`);
      }
      const totalMax = limitOf(limits, month, TOTAL);
      const total = counter.get(month, TOTAL);
      if (totalMax != null && total > totalMax) {
        report(5, TOTAL, `avancée en ${monthKeyOf(smoothedIso)}, total ${total} / ${totalMax}`);
      }
    }
  });
  return violations;
}
