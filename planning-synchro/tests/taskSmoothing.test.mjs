// Tests de la regle de lissage (top/taskSmoothing.js).
//
// Chaque exemple de la spec (§4.4, A a J) est rejoue avec ses donnees : on
// compare les mois lisses (monthKeyOf(smoothedIso)) par rowId. Les scenarios
// sont declares une fois (SCENARIOS) et le dernier bloc les repasse tous a
// findSmoothingViolations : les regles strictes de §4.2 doivent tenir partout.
// Dans A a H, aucune armature n'a de coffrage a entrainer (groupKey vide ou
// groupes sans armature) ; la dependance armature / coffrage (§4.6) a ses
// propres scenarios (I, J et suivants). Le fuzz est dans
// taskSmoothingFuzz.test.mjs.
//
// Mois courant : janvier 2027, sauf mention.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  smoothTasks,
  findSmoothingViolations,
  monthKeyOf,
  monthMaxima,
  shiftIsoByMonths,
  smoothingStartMonth,
} from "../assets/js/top/taskSmoothing.js";

function t(id, type, dueIso, extra = {}) {
  return {
    rowId: id,
    id2: String(id),
    name: "T" + id,
    zone: "",
    groupe: "",
    groupKey: "",
    type,
    dueIso,
    realized: false,
    ...extra,
  };
}

const JANUARY = "2027-01-10";

// --- scenarios (une fonction par cas : des taches neuves a chaque appel) ------

const SCENARIOS = {
  // A. Exemple de l'utilisateur : mars 2, avril 8, maximum 4.
  A: () => ({
    today: JANUARY,
    settings: { maxTotal: 4, maxByType: {} },
    tasks: [
      t(1, "COFFRAGE", "2027-03-05"), // M1
      t(2, "NDC", "2027-03-20"), // M2
      t(11, "COFFRAGE", "2027-04-02"), // A1
      t(12, "ARMATURES", "2027-04-05"),
      t(13, "NDC", "2027-04-08"),
      t(14, "COUPES", "2027-04-11"),
      t(15, "DEMOLITION", "2027-04-14"),
      t(16, "AUTRES", "2027-04-17"),
      t(17, "ARMATURES", "2027-04-20"),
      t(18, "COFFRAGE", "2027-04-24"), // A8
    ],
  }),

  // B. Octobre 4, novembre 4, decembre 8, maximum 4 : aucune place avant.
  B: () => ({
    today: "2026-10-05",
    settings: { maxTotal: 4, maxByType: {} },
    tasks: [
      t(1, "NDC", "2026-10-06"),
      t(2, "NDC", "2026-10-12"),
      t(3, "NDC", "2026-10-19"),
      t(4, "NDC", "2026-10-26"),
      t(5, "NDC", "2026-11-02"),
      t(6, "NDC", "2026-11-09"),
      t(7, "NDC", "2026-11-16"),
      t(8, "NDC", "2026-11-23"),
      t(9, "COFFRAGE", "2026-12-01"),
      t(10, "NDC", "2026-12-04"),
      t(11, "COFFRAGE", "2026-12-07"),
      t(12, "NDC", "2026-12-10"),
      t(13, "COFFRAGE", "2026-12-14"),
      t(14, "NDC", "2026-12-17"),
      t(15, "COFFRAGE", "2026-12-21"),
      t(16, "NDC", "2026-12-28"),
    ],
  }),

  // C. Octobre 2, novembre 6, decembre 6, maximum 4.
  C: () => ({
    today: "2026-10-05",
    settings: { maxTotal: 4, maxByType: {} },
    tasks: [
      t(1, "NDC", "2026-10-08"),
      t(2, "NDC", "2026-10-20"),
      t(11, "NDC", "2026-11-03"), // N1
      t(12, "NDC", "2026-11-06"),
      t(13, "NDC", "2026-11-10"),
      t(14, "NDC", "2026-11-14"),
      t(15, "NDC", "2026-11-18"),
      t(16, "NDC", "2026-11-25"), // N6
      t(21, "NDC", "2026-12-02"), // D1
      t(22, "NDC", "2026-12-06"),
      t(23, "NDC", "2026-12-10"),
      t(24, "NDC", "2026-12-14"),
      t(25, "NDC", "2026-12-18"),
      t(26, "NDC", "2026-12-22"), // D6
    ],
  }),

  // D. Maximum Armature 2 seulement : 4 armatures (sans groupe) et 3 coffrages
  //    de groupes sans armature, tous en avril.
  D: () => ({
    today: JANUARY,
    settings: { maxTotal: null, maxByType: { ARMATURES: 2 } },
    tasks: [
      t(1, "COFFRAGE", "2027-04-01", { groupKey: "z||1" }),
      t(2, "ARMATURES", "2027-04-05"),
      t(3, "COFFRAGE", "2027-04-09", { groupKey: "z||2" }),
      t(4, "ARMATURES", "2027-04-12"),
      t(5, "COFFRAGE", "2027-04-18", { groupKey: "z||3" }),
      t(6, "ARMATURES", "2027-04-20"),
      t(7, "ARMATURES", "2027-04-26"),
    ],
  }),

  // E. Maximum general 4 et maximum Coffrage 2 : avril 3 coffrages + 3
  //    armatures (sans groupe). Les deux armatures les plus tot passent AVANT le
  //    premier coffrage : le depassement du type doit quand meme etre traite en
  //    premier, sinon trois taches avanceraient au lieu de deux.
  E: () => ({
    today: JANUARY,
    settings: { maxTotal: 4, maxByType: { COFFRAGE: 2 } },
    tasks: [
      t(1, "ARMATURES", "2027-04-01"),
      t(2, "ARMATURES", "2027-04-03"),
      t(3, "COFFRAGE", "2027-04-06"),
      t(4, "COFFRAGE", "2027-04-12"),
      t(5, "COFFRAGE", "2027-04-18"),
      t(6, "ARMATURES", "2027-04-24"),
    ],
  }),

  // E, autre ordre : le coffrage le plus tot est aussi la tache la plus tot.
  E2: () => ({
    today: JANUARY,
    settings: { maxTotal: 4, maxByType: { COFFRAGE: 2 } },
    tasks: [
      t(1, "COFFRAGE", "2027-04-01"),
      t(2, "ARMATURES", "2027-04-03"),
      t(3, "COFFRAGE", "2027-04-06"),
      t(4, "ARMATURES", "2027-04-12"),
      t(5, "COFFRAGE", "2027-04-18"),
      t(6, "ARMATURES", "2027-04-24"),
    ],
  }),

  // F. Maximum 4 ; avril : 3 realisees + 3 non realisees.
  F: () => ({
    today: JANUARY,
    settings: { maxTotal: 4, maxByType: {} },
    tasks: [
      t(1, "NDC", "2027-04-01", { realized: true }),
      t(2, "NDC", "2027-04-05"),
      t(3, "NDC", "2027-04-08", { realized: true }),
      t(4, "ARMATURES", "2027-04-12"),
      t(5, "COFFRAGE", "2027-04-20", { realized: true }),
      t(6, "COUPES", "2027-04-25"),
    ],
  }),

  // G. Mois courant avril, maximum 4, avril 6 (dont une echeance deja passee).
  G: () => ({
    today: "2027-04-03",
    settings: { maxTotal: 4, maxByType: {} },
    tasks: [
      t(1, "NDC", "2027-04-01"),
      t(2, "NDC", "2027-04-05"),
      t(3, "NDC", "2027-04-10"),
      t(4, "NDC", "2027-04-15"),
      t(5, "NDC", "2027-04-20"),
      t(6, "NDC", "2027-04-25"),
    ],
  }),

  // H. Maximum general 2 seul (file unique) : fevrier F1, mars M1 M2, avril A1 A2 A3.
  H: () => ({
    today: JANUARY,
    settings: { maxTotal: 2 },
    tasks: hTasks(),
  }),

  // H bis. Memes taches, maximum general 2 et maximum Armature 5 (file par type).
  Hbis: () => ({
    today: JANUARY,
    settings: { maxTotal: 2, maxByType: { ARMATURES: 5 } },
    tasks: hTasks(),
  }),

  // Echeance au 31 avancee vers un mois de 30 jours.
  day31: () => ({
    today: "2027-01-05",
    settings: { maxTotal: 1 },
    tasks: [t(1, "NDC", "2027-05-31"), t(2, "NDC", "2027-06-10"), t(3, "NDC", "2027-06-20")],
  }),

  // Avancee dans le mois courant a une date deja passee.
  today: () => ({
    today: "2027-03-20",
    settings: { maxTotal: 1 },
    tasks: [t(1, "NDC", "2027-04-05"), t(2, "NDC", "2027-04-25")],
  }),

  // Trois taches d'un mois passe (decembre 2026), maximum 1.
  pastMonth: () => ({
    today: JANUARY,
    settings: { maxTotal: 1 },
    tasks: [t(1, "NDC", "2026-12-03"), t(2, "NDC", "2026-12-10"), t(3, "COFFRAGE", "2026-12-17")],
  }),

  // Un mois passe VIDE (novembre 2026) n'est jamais une cible : janvier est
  // plein, la seconde tache de fevrier reste.
  pastMonthNeverTarget: () => ({
    today: JANUARY,
    settings: { maxTotal: 1 },
    tasks: [t(1, "NDC", "2027-01-20"), t(2, "NDC", "2027-02-05"), t(3, "NDC", "2027-02-15")],
  }),

  // Maximum 2 ; mai : 3 taches realisees.
  realizedOnly: () => ({
    today: JANUARY,
    settings: { maxTotal: 2, maxByType: {} },
    tasks: [
      t(1, "NDC", "2027-05-04", { realized: true }),
      t(2, "NDC", "2027-05-12", { realized: true }),
      t(3, "NDC", "2027-05-20", { realized: true }),
    ],
  }),

  // Plusieurs depassements, sur deux mois et trois series (cles de maxByType
  // volontairement hors de l'ordre TYPE_ORDER).
  manyOverflows: () => ({
    today: "2027-04-02",
    settings: { maxTotal: 2, maxByType: { NDC: 1, COFFRAGE: 1 } },
    tasks: [
      t(1, "COFFRAGE", "2027-04-05"),
      t(2, "COFFRAGE", "2027-04-10"),
      t(3, "NDC", "2027-04-15"),
      t(4, "NDC", "2027-04-20"),
      t(5, "NDC", "2027-05-05"),
      t(6, "NDC", "2027-05-10"),
      t(7, "NDC", "2027-05-15"),
    ],
  }),

  // Regle 5 : le mois en cours deborde sur les armatures, il peut quand meme
  // recevoir un NDC (seules les series de la tache comptent).
  otherSeriesOver: () => ({
    today: "2027-04-02",
    settings: { maxTotal: null, maxByType: { ARMATURES: 2, NDC: 1 } },
    tasks: [
      t(1, "ARMATURES", "2027-04-05"),
      t(2, "ARMATURES", "2027-04-10"),
      t(3, "ARMATURES", "2027-04-15"),
      t(4, "NDC", "2027-05-05"),
      t(5, "NDC", "2027-05-20"),
    ],
  }),

  // Aucun maximum : lissage inactif.
  inactive: () => ({
    today: JANUARY,
    settings: { maxTotal: null, maxByType: {} },
    tasks: SCENARIOS.A().tasks,
  }),

  // --- armature / coffrage (§4.6) ---

  // I. Maximum Armature 2 : avril, coffrage C (02/04) et A1 … A4 de son groupe.
  I: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 2 } },
    tasks: [
      t(1, "COFFRAGE", "2027-04-02", { groupKey: "a||1" }), // C
      t(2, "ARMATURES", "2027-04-10", { groupKey: "a||1" }), // A1
      t(3, "ARMATURES", "2027-04-15", { groupKey: "a||1" }), // A2
      t(4, "ARMATURES", "2027-04-20", { groupKey: "a||1" }), // A3
      t(5, "ARMATURES", "2027-04-25", { groupKey: "a||1" }), // A4
    ],
  }),

  // J. Mois courant mars, maximum Armature 2 et Coffrage 1 : mars K (autre
  //    groupe) ; avril C et A1 … A4. C ne tient pas en mars : rien ne bouge.
  J: () => ({
    today: "2027-03-05",
    settings: { maxByType: { ARMATURES: 2, COFFRAGE: 1 } },
    tasks: [
      t(1, "COFFRAGE", "2027-03-20", { groupKey: "b||1" }), // K
      t(2, "COFFRAGE", "2027-04-02", { groupKey: "a||1" }), // C
      t(3, "ARMATURES", "2027-04-10", { groupKey: "a||1" }), // A1
      t(4, "ARMATURES", "2027-04-15", { groupKey: "a||1" }),
      t(5, "ARMATURES", "2027-04-20", { groupKey: "a||1" }),
      t(6, "ARMATURES", "2027-04-25", { groupKey: "a||1" }), // A4
    ],
  }),

  // Coffrage dans un mois intermediaire : maximum Armature 1 ; mars B (autre
  // groupe) et C ; avril A1, A2 du groupe de C. A1 doit aller en fevrier (mars
  // est plein) : elle entraine C de mars en fevrier.
  intermediate: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 1 } },
    tasks: [
      t(1, "ARMATURES", "2027-03-15", { groupKey: "b||1" }), // B
      t(2, "COFFRAGE", "2027-03-10", { groupKey: "a||1" }), // C
      t(3, "ARMATURES", "2027-04-05", { groupKey: "a||1" }), // A1
      t(4, "ARMATURES", "2027-04-20", { groupKey: "a||1" }), // A2
    ],
  }),

  // Coffrage realise : il ne contraint plus ses armatures.
  realizedCoffrage: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 2 } },
    tasks: [
      t(1, "COFFRAGE", "2027-04-02", { groupKey: "a||1", realized: true }), // C
      t(2, "ARMATURES", "2027-04-10", { groupKey: "a||1" }), // A1
      t(3, "ARMATURES", "2027-04-15", { groupKey: "a||1" }),
      t(4, "ARMATURES", "2027-04-20", { groupKey: "a||1" }),
    ],
  }),

  // Deux coffrages dans le groupe : la regle vaut pour chacun (§4.6).
  twoCoffrages: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 1 } },
    tasks: [
      t(1, "COFFRAGE", "2027-04-01", { groupKey: "a||1" }), // C1
      t(2, "COFFRAGE", "2027-04-03", { groupKey: "a||1" }), // C2
      t(3, "ARMATURES", "2027-04-10", { groupKey: "a||1" }), // A1
      t(4, "ARMATURES", "2027-04-20", { groupKey: "a||1" }), // A2
    ],
  }),

  // Deux coffrages entraines dans des mois differents : maximum Armature 1 et
  // Coffrage 1 ; mars B (autre groupe) et C1 ; avril C2, A1, A2. A1 doit aller
  // en fevrier : C2 y va aussi, et C1 (plus tot) en janvier, pas l'inverse.
  twoCoffragesOrdered: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 1, COFFRAGE: 1 } },
    tasks: [
      t(1, "ARMATURES", "2027-03-25", { groupKey: "b||1" }), // B
      t(2, "COFFRAGE", "2027-03-05", { groupKey: "a||1" }), // C1
      t(3, "COFFRAGE", "2027-04-03", { groupKey: "a||1" }), // C2
      t(4, "ARMATURES", "2027-04-10", { groupKey: "a||1" }), // A1
      t(5, "ARMATURES", "2027-04-20", { groupKey: "a||1" }), // A2
    ],
  }),

  // groupKey vide = pas de groupe (Ruling 5) : l'armature avance seule, le
  // coffrage sans groupe du meme mois ne la contraint pas.
  emptyGroupKey: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 1 } },
    tasks: [
      t(1, "COFFRAGE", "2027-04-02"),
      t(2, "ARMATURES", "2027-04-05"),
      t(3, "ARMATURES", "2027-04-10"),
    ],
  }),

  // Coffrage d'un mois PLUS TARDIF que l'armature (donnees ou le coffrage est
  // diffuse apres son armature) : avancer l'armature l'oblige a l'entrainer.
  coffrageLater: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 1 } },
    tasks: [
      t(1, "ARMATURES", "2027-04-05", { groupKey: "a||1" }), // A0
      t(2, "ARMATURES", "2027-04-20", { groupKey: "a||1" }), // A1
      t(3, "COFFRAGE", "2027-05-10", { groupKey: "a||1" }), // C
    ],
  }),

  // « Coffrage sans place » sur la serie Total : mois courant mars, maximum
  // general 3 et Coffrage 1 ; mars K ; avril C et A1 … A3 (4 / 3).
  blockedTotal: () => ({
    today: "2027-03-05",
    settings: { maxTotal: 3, maxByType: { COFFRAGE: 1 } },
    tasks: [
      t(1, "COFFRAGE", "2027-03-20", { groupKey: "b||1" }), // K
      t(2, "COFFRAGE", "2027-04-02", { groupKey: "a||1" }), // C
      t(3, "ARMATURES", "2027-04-10", { groupKey: "a||1" }),
      t(4, "ARMATURES", "2027-04-15", { groupKey: "a||1" }),
      t(5, "ARMATURES", "2027-04-20", { groupKey: "a||1" }),
    ],
  }),

  // Exception de la regle 4 a la preference 4 : maximum Armature 1 et Coffrage
  // 1, janvier a mars pleins de coffrages. A1 (05/04) ne peut pas avancer (son
  // coffrage C n'a aucune place) ; B (10/04, sans groupe) passe en mars et
  // double A1, faute de quoi A1 passerait avant son coffrage.
  blockedDoubled: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 1, COFFRAGE: 1 } },
    tasks: [
      t(1, "COFFRAGE", "2027-01-20", { groupKey: "y||1" }),
      t(2, "COFFRAGE", "2027-02-10", { groupKey: "x||1" }),
      t(3, "COFFRAGE", "2027-03-05", { groupKey: "z||1" }),
      t(4, "COFFRAGE", "2027-04-02", { groupKey: "a||1" }), // C
      t(5, "ARMATURES", "2027-04-05", { groupKey: "a||1" }), // A1
      t(6, "ARMATURES", "2027-04-10"), // B
    ],
  }),

  // Le garde-fou ne retire de la remise en ordre que les taches en faute :
  // maximum Armature 1 et Coffrage 1, janvier a mai pleins de coffrages K1 …
  // K5 ; armatures sans groupe X1, X2 (mars), Y1, Y2 (avril) ; en juin, C et A1
  // (groupe a||1, A1 retenue : C n'a aucune place) et B (sans groupe). Seule
  // A1 doit sortir de la file : X1, X2, Y1, Y2 restent dans l'ordre.
  unrelatedKeepOrder: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 1, COFFRAGE: 1 } },
    tasks: [
      ...unrelatedBase(),
      t(20, "COFFRAGE", "2027-06-02", { groupKey: "a||1" }), // C
      t(21, "ARMATURES", "2027-06-05", { groupKey: "a||1" }), // A1
      t(22, "ARMATURES", "2027-06-10"), // B
    ],
  }),

  // Regle 4 avant regle 5 dans le garde-fou : maximum Armature 1 et Coffrage
  // 1, janvier a avril pleins de coffrages ; en mai C, A1, A2 (groupe a||1,
  // A1 et A2 retenues : C n'a aucune place) ; armatures sans groupe X (juin),
  // Y et Y' (juillet). Remettre A1 en ordre fait aussi deborder mai pour X
  // (regle 5) : seule A1 doit sortir de la file, puis A2 ; X et Y gardent
  // leur ordre.
  collateralRule5: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 1, COFFRAGE: 1 } },
    tasks: [
      t(11, "COFFRAGE", "2027-01-20", { groupKey: "k||1" }),
      t(12, "COFFRAGE", "2027-02-20", { groupKey: "k||2" }),
      t(13, "COFFRAGE", "2027-03-20", { groupKey: "k||3" }),
      t(14, "COFFRAGE", "2027-04-20", { groupKey: "k||4" }),
      t(1, "ARMATURES", "2027-06-10"), // X
      t(2, "ARMATURES", "2027-07-05"), // Y
      t(3, "ARMATURES", "2027-07-20"), // Y'
      t(20, "COFFRAGE", "2027-05-02", { groupKey: "a||1" }), // C
      t(21, "ARMATURES", "2027-05-05", { groupKey: "a||1" }), // A1
      t(22, "ARMATURES", "2027-05-25", { groupKey: "a||1" }), // A2
    ],
  }),

  // Regle 5 seule, nee d'une armature liee qui reprend LEGALEMENT le mois de
  // son coffrage : maximum Armature 1 et Coffrage 1, janvier a avril pleins de
  // coffrages ; P (mai, sans groupe) ; C (mai) et A1, A2 (juin, groupe a||1,
  // retenues) ; Z et Z' (juillet, sans groupe). Remettre la file en ordre
  // porte A1 en mai (permis : C y est) et Z en juin, plein : c'est A1, puis
  // A2, qui doivent sortir de la file, pas Z ; P passe avant Z.
  linkedMovedFirst: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 1, COFFRAGE: 1 } },
    tasks: [
      t(11, "COFFRAGE", "2027-01-20", { groupKey: "k||1" }),
      t(12, "COFFRAGE", "2027-02-20", { groupKey: "k||2" }),
      t(13, "COFFRAGE", "2027-03-20", { groupKey: "k||3" }),
      t(14, "COFFRAGE", "2027-04-20", { groupKey: "k||4" }),
      t(1, "ARMATURES", "2027-05-18"), // P
      t(20, "COFFRAGE", "2027-05-20", { groupKey: "a||1" }), // C
      t(21, "ARMATURES", "2027-06-01", { groupKey: "a||1" }), // A1
      t(22, "ARMATURES", "2027-06-10", { groupKey: "a||1" }), // A2
      t(2, "ARMATURES", "2027-07-09"), // Z
      t(3, "ARMATURES", "2027-07-24"), // Z'
    ],
  }),

  // Surretrait : le cas precedent, plus L1 (10/03, groupe b||1, son coffrage
  // Cb est en janvier) et U1, U2 (05/04 et 25/04, sans groupe). Remettre la
  // file en ordre porte L1 en janvier (permis : Cb y est), A1 en mai (permis :
  // C y est) et Z en juin, plein (regle 5 seule). Ce n'est pas L1 qui a libere
  // juin, mais A1 : c'est A1, puis A2, qui doivent sortir de la file. L1 reste
  // dans la file, en janvier, et n'est doublee ni par U1 ni par U2.
  surretrait: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 1, COFFRAGE: 1 } },
    tasks: [
      t(11, "COFFRAGE", "2027-01-20", { groupKey: "b||1" }), // Cb
      t(12, "COFFRAGE", "2027-02-20", { groupKey: "k||2" }),
      t(13, "COFFRAGE", "2027-03-20", { groupKey: "k||3" }),
      t(14, "COFFRAGE", "2027-04-20", { groupKey: "k||4" }),
      t(5, "ARMATURES", "2027-03-10", { groupKey: "b||1" }), // L1
      t(6, "ARMATURES", "2027-04-05"), // U1
      t(7, "ARMATURES", "2027-04-25"), // U2
      t(1, "ARMATURES", "2027-05-18"), // P
      t(20, "COFFRAGE", "2027-05-20", { groupKey: "a||1" }), // C
      t(21, "ARMATURES", "2027-06-01", { groupKey: "a||1" }), // A1
      t(22, "ARMATURES", "2027-06-10", { groupKey: "a||1" }), // A2
      t(2, "ARMATURES", "2027-07-09"), // Z
      t(3, "ARMATURES", "2027-07-24"), // Z'
    ],
  }),

  // Armature retiree de la remise en ordre pour la regle 4, sans etre ni
  // retenue ni d'un entrainement : maximum Armature 1 ; M1 (mars) ; A (avril,
  // groupe a||1, son coffrage C est en avril) ; Y1, Y2 (mai, sans groupe). Y1
  // passe en fevrier (avril et mars sont pleins). Remise en ordre : M1 en
  // fevrier, A en mars, avant C (regle 4) : A sort de la file et garde avril ;
  // Y1 passe en mars et la double.
  rule4Removed: () => ({
    today: JANUARY,
    settings: { maxByType: { ARMATURES: 1 } },
    tasks: [
      t(1, "ARMATURES", "2027-03-10"), // M1
      t(2, "COFFRAGE", "2027-04-02", { groupKey: "a||1" }), // C
      t(3, "ARMATURES", "2027-04-10", { groupKey: "a||1" }), // A
      t(4, "ARMATURES", "2027-05-05"), // Y1
      t(5, "ARMATURES", "2027-05-20"), // Y2
    ],
  }),

  // --- mois de depart (startMonth) ---

  // Mois en cours : mars 2027 ; depart en janvier. Mars a 5 taches pour un
  // maximum de 2 : les trois plus tot partent dans fevrier et janvier, vides et
  // passes.
  startPast: () => ({
    today: "2027-03-15",
    settings: { maxTotal: 2, maxByType: {}, startMonth: "2027-01" },
    tasks: [
      t(1, "NDC", "2027-03-05"),
      t(2, "NDC", "2027-03-10"),
      t(3, "NDC", "2027-03-20"),
      t(4, "NDC", "2027-03-25"),
      t(5, "NDC", "2027-03-28"),
      t(6, "NDC", "2027-04-10"),
    ],
  }),

  // Maximum 1, depart en janvier : janvier et fevrier recoivent une tache
  // chacun, puis plus de place ; decembre (avant le depart) n'est ni cible ni
  // signale, ses taches restent figees.
  startPastLimit: () => ({
    today: "2027-03-15",
    settings: { maxTotal: 1, maxByType: {}, startMonth: "2027-01" },
    tasks: [
      t(1, "NDC", "2027-03-05"),
      t(2, "NDC", "2027-03-10"),
      t(3, "NDC", "2027-03-20"),
      t(4, "NDC", "2027-03-25"),
      t(9, "NDC", "2026-12-10"),
      t(10, "NDC", "2026-12-20"),
    ],
  }),

  // Tache en retard (fevrier, non realisee), depart en janvier : mobile, mais
  // les taches a venir passent d'abord. La tache de mars en trop prend janvier,
  // la seule place libre ; la tache en retard n'en trouve plus et reste.
  lateTasks: () => ({
    today: "2027-03-15",
    settings: { maxTotal: 1, maxByType: {}, startMonth: "2027-01" },
    tasks: [
      t(1, "NDC", "2027-02-10"), // en retard
      t(2, "NDC", "2027-03-05"),
      t(3, "NDC", "2027-03-10"),
      t(4, "NDC", "2027-03-20"),
    ],
  }),

  // Mois passe deja plein de taches en retard, et c'est le mois de depart :
  // aucun mois avant elles, elles restent. Raison « taches-passees ».
  lateMonthOver: () => ({
    today: "2027-03-15",
    settings: { maxTotal: 1, maxByType: {}, startMonth: "2027-01" },
    tasks: [t(1, "NDC", "2027-01-10"), t(2, "NDC", "2027-01-20")],
  }),

  // Coffrage C en retard (fevrier), depart en janvier : mobile. Son armature
  // A1, en trop en mars, ne tient qu'en janvier (fevrier est plein
  // d'armatures) : elle y passe et y entraine C.
  lateCoffrage: () => ({
    today: "2027-03-15",
    settings: { maxByType: { ARMATURES: 1 }, startMonth: "2027-01" },
    tasks: [
      t(1, "COFFRAGE", "2027-02-10", { groupKey: "a||1" }), // C
      t(2, "ARMATURES", "2027-02-20", { realized: true }), // fevrier plein
      t(3, "ARMATURES", "2027-03-05", { groupKey: "a||1" }), // A1
      t(4, "ARMATURES", "2027-03-10", { groupKey: "a||1" }), // A2
    ],
  }),

  // Le bug du 2026-10-28 en miniature : depart passe tres tot, des mois libres,
  // et des taches en retard en trop dans un mois passe. Elles descendent dans
  // les mois libres, a partir du plus tardif.
  lateUseMargin: () => ({
    today: "2027-03-15",
    settings: { maxTotal: 1, maxByType: {}, startMonth: "2026-06" },
    tasks: [
      t(1, "NDC", "2027-02-05"), // en retard
      t(2, "NDC", "2027-02-12"), // en retard
      t(3, "NDC", "2027-02-20"), // en retard
      t(4, "NDC", "2027-02-25", { realized: true }),
    ],
  }),

  // Les taches a venir passent avant les taches en retard : janvier, seule
  // place libre, va a la tache de mars ; fevrier reste en depassement.
  latePriority: () => ({
    today: "2027-03-15",
    settings: { maxTotal: 1, maxByType: {}, startMonth: "2027-01" },
    tasks: [
      t(1, "NDC", "2027-02-10"), // en retard
      t(2, "NDC", "2027-02-20"), // en retard
      t(3, "NDC", "2027-03-05"),
      t(4, "NDC", "2027-03-10"),
    ],
  }),

  // Un depart apres le mois en cours n'a pas de sens : le mois en cours vaut.
  startAfterToday: () => ({
    today: JANUARY,
    settings: { maxTotal: 1, maxByType: {}, startMonth: "2027-03" },
    tasks: [t(1, "NDC", "2027-02-10"), t(2, "NDC", "2027-02-20")],
  }),

  // Depart avant le mois en cours : une tache avancee dans le mois en cours
  // garde son jour, meme deja passe (pas de report a aujourd'hui).
  startPastDay: () => ({
    today: "2027-03-20",
    settings: { maxTotal: 1, maxByType: {}, startMonth: "2027-02" },
    tasks: [t(2, "NDC", "2027-04-10"), t(3, "NDC", "2027-04-15")],
  }),

  // Depart passe : une armature avancee dans un mois passe y entraine son
  // coffrage (maximum Armature 1 ; C en mars, A1 et A2 en mars).
  startPastPull: () => ({
    today: "2027-03-15",
    settings: { maxByType: { ARMATURES: 1 }, startMonth: "2027-01" },
    tasks: [
      t(1, "COFFRAGE", "2027-03-02", { groupKey: "a||1" }), // C
      t(2, "ARMATURES", "2027-03-10", { groupKey: "a||1" }), // A1
      t(3, "ARMATURES", "2027-03-20", { groupKey: "a||1" }), // A2
    ],
  }),

  // --- maximums d'un mois precis (maxByMonth) ---

  // Maximum par type dans un seul mois : les files restent par type. Mars : 2
  // taches dont 1 NDC au plus ; le NDC du 05/03 part en fevrier, la coupe du
  // 01/03, plus tot, reste en mars (une file unique la ferait passer devant).
  monthQueueByType: () => ({
    today: JANUARY,
    settings: { maxByType: {}, maxByMonth: { "2027-03": { maxTotal: 2, maxByType: { NDC: 1 } } } },
    tasks: [t(1, "COUPES", "2027-03-01"), t(2, "NDC", "2027-03-05"), t(3, "NDC", "2027-03-10")],
  }),

  // Avril limite a 2 (4 pour les autres mois) : deux taches partent en mars.
  monthLower: () => ({
    today: JANUARY,
    settings: { maxTotal: 4, maxByType: {}, maxByMonth: { "2027-04": { maxTotal: 2, maxByType: {} } } },
    tasks: [
      t(1, "NDC", "2027-04-05"),
      t(2, "COUPES", "2027-04-10"),
      t(3, "NDC", "2027-04-15"),
      t(4, "AUTRES", "2027-04-20"),
      t(5, "NDC", "2027-05-10"),
    ],
  }),

  // Avril monte a 4 (2 pour les autres mois) : avril garde ses 4 taches, mars
  // en avance une.
  monthHigher: () => ({
    today: JANUARY,
    settings: { maxTotal: 2, maxByType: {}, maxByMonth: { "2027-04": { maxTotal: 4, maxByType: {} } } },
    tasks: [
      t(1, "NDC", "2027-04-05"),
      t(2, "NDC", "2027-04-10"),
      t(3, "NDC", "2027-04-15"),
      t(4, "NDC", "2027-04-20"),
      t(5, "NDC", "2027-03-10"),
      t(6, "NDC", "2027-03-20"),
      t(7, "NDC", "2027-03-25"),
    ],
  }),

  // Aucun maximum pour tous les mois, seulement 1 armature en avril.
  monthTypeOnly: () => ({
    today: JANUARY,
    settings: { maxByType: {}, maxByMonth: { "2027-04": { maxTotal: null, maxByType: { ARMATURES: 1 } } } },
    tasks: [
      t(1, "ARMATURES", "2027-04-05"),
      t(2, "ARMATURES", "2027-04-10"),
      t(3, "ARMATURES", "2027-04-20"),
      t(4, "COFFRAGE", "2027-04-12"),
    ],
  }),

  // Depassements rapportes avec le maximum DU MOIS : janvier 3 / 2, fevrier
  // 2 / 1 ; NDC limite en janvier seulement.
  monthOverflowMax: () => ({
    today: JANUARY,
    settings: {
      maxTotal: 1,
      maxByType: {},
      maxByMonth: { "2027-01": { maxTotal: 2, maxByType: { NDC: 1 } } },
    },
    tasks: [
      t(1, "NDC", "2027-01-12"),
      t(2, "NDC", "2027-01-15"),
      t(3, "COUPES", "2027-01-20"),
      t(4, "NDC", "2027-02-10"),
      t(5, "NDC", "2027-02-15"),
    ],
  }),

  // --- 0 pour un mois precis : aucune tache ce mois-la ---

  // Avril a 0 (4 pour les autres mois) : ses trois taches partent en mars, qui
  // en a deja une et en tient quatre.
  monthZero: () => ({
    today: JANUARY,
    settings: { maxTotal: 4, maxByType: {}, maxByMonth: { "2027-04": { maxTotal: 0, maxByType: {} } } },
    tasks: [
      t(1, "NDC", "2027-04-05"),
      t(2, "COUPES", "2027-04-10"),
      t(3, "NDC", "2027-04-15"),
      t(4, "NDC", "2027-03-10"),
    ],
  }),

  // Mars a 0, maximum 1 ailleurs : la tache en trop d'avril saute mars, vide
  // mais interdit, et arrive en fevrier.
  monthZeroSkipped: () => ({
    today: JANUARY,
    settings: { maxTotal: 1, maxByType: {}, maxByMonth: { "2027-03": { maxTotal: 0, maxByType: {} } } },
    tasks: [t(1, "NDC", "2027-04-05"), t(2, "NDC", "2027-04-20")],
  }),

  // Avril a 0 armature seulement : les armatures partent, le coffrage reste.
  monthZeroType: () => ({
    today: JANUARY,
    settings: { maxByType: {}, maxByMonth: { "2027-04": { maxTotal: null, maxByType: { ARMATURES: 0 } } } },
    tasks: [t(1, "ARMATURES", "2027-04-05"), t(2, "ARMATURES", "2027-04-20"), t(3, "COFFRAGE", "2027-04-12")],
  }),

  // Mars a 0 avec une tache realisee : elle reste (figee) et le mois est signale
  // en depassement ; la tache a venir part en fevrier.
  monthZeroFrozen: () => ({
    today: JANUARY,
    settings: { maxByType: {}, maxByMonth: { "2027-03": { maxTotal: 0, maxByType: {} } } },
    tasks: [t(1, "NDC", "2027-03-05", { realized: true }), t(2, "NDC", "2027-03-15")],
  }),

  // Le mois courant a 0, lissage parti du mois courant : rien ne peut partir
  // avant lui, la tache reste et le mois est signale.
  monthZeroCurrent: () => ({
    today: JANUARY,
    settings: { maxByType: {}, maxByMonth: { "2027-01": { maxTotal: 0, maxByType: {} } } },
    tasks: [t(1, "NDC", "2027-01-20")],
  }),
};

function unrelatedBase() {
  return [
    t(1, "ARMATURES", "2027-03-05"), // X1
    t(2, "ARMATURES", "2027-03-20"), // X2
    t(3, "ARMATURES", "2027-04-05"), // Y1
    t(4, "ARMATURES", "2027-04-20"), // Y2
    t(11, "COFFRAGE", "2027-01-20", { groupKey: "k||1" }),
    t(12, "COFFRAGE", "2027-02-20", { groupKey: "k||2" }),
    t(13, "COFFRAGE", "2027-03-25", { groupKey: "k||3" }),
    t(14, "COFFRAGE", "2027-04-25", { groupKey: "k||4" }),
    t(15, "COFFRAGE", "2027-05-25", { groupKey: "k||5" }),
  ];
}

function hTasks() {
  return [
    t(1, "COUPES", "2027-02-10"), // F1
    t(2, "NDC", "2027-03-05"), // M1
    t(3, "NDC", "2027-03-20"), // M2
    t(4, "ARMATURES", "2027-04-05"), // A1
    t(5, "ARMATURES", "2027-04-15"), // A2
    t(6, "ARMATURES", "2027-04-25"), // A3
  ];
}

function run(name) {
  const { tasks, settings, today } = SCENARIOS[name]();
  return smoothTasks(tasks, settings, today);
}

// { "AAAA-MM": [rowId...] } d'apres les dates lissees (rowId croissants).
function monthsOf(result) {
  const byMonth = {};
  result.tasks.forEach((task) => {
    const key = monthKeyOf(task.smoothedIso);
    (byMonth[key] ||= []).push(task.rowId);
  });
  Object.values(byMonth).forEach((ids) => ids.sort((a, b) => a - b));
  return byMonth;
}

function byRow(result) {
  return new Map(result.tasks.map((task) => [task.rowId, task]));
}

function assertUnchanged(result) {
  result.tasks.forEach((task) => {
    assert.equal(task.smoothedIso, task.dueIso, `ligne ${task.rowId}`);
    assert.equal(task.moved, false);
    assert.equal(task.monthsAdvanced, 0);
  });
  assert.equal(result.movedCount, 0);
}

// --- dates ---------------------------------------------------------------------

test("monthKeyOf : AAAA-MM-JJ → AAAA-MM", () => {
  assert.equal(monthKeyOf("2027-04-12"), "2027-04");
  assert.equal(monthKeyOf("2026-12-31"), "2026-12");
});

test("shiftIsoByMonths : jour conservé, borné au dernier jour du mois", () => {
  assert.equal(shiftIsoByMonths("2027-04-12", -1), "2027-03-12");
  assert.equal(shiftIsoByMonths("2027-05-31", -1), "2027-04-30");
  assert.equal(shiftIsoByMonths("2027-03-31", -1), "2027-02-28");
  assert.equal(shiftIsoByMonths("2028-03-31", -1), "2028-02-29");
  assert.equal(shiftIsoByMonths("2027-01-15", -1), "2026-12-15");
  assert.equal(shiftIsoByMonths("2027-02-10", -13), "2026-01-10");
  assert.equal(shiftIsoByMonths("2027-01-31", 1), "2027-02-28");
  assert.equal(shiftIsoByMonths("2027-06-20", 0), "2027-06-20");
});

// --- exemples de la spec (§4.4) ----------------------------------------------

test("exemple A (utilisateur) : février M1 M2, mars A1…A4, avril A5…A8", () => {
  const result = run("A");

  assert.equal(result.active, true);
  assert.deepEqual(monthsOf(result), {
    "2027-02": [1, 2],
    "2027-03": [11, 12, 13, 14],
    "2027-04": [15, 16, 17, 18],
  });
  assert.equal(result.movedCount, 6);
  assert.deepEqual(result.overflows, []);

  const rows = byRow(result);
  assert.equal(rows.get(1).smoothedIso, "2027-02-05");
  assert.equal(rows.get(1).monthsAdvanced, 1);
  assert.equal(rows.get(1).moved, true);
  assert.equal(rows.get(11).smoothedIso, "2027-03-02");
  assert.equal(rows.get(15).moved, false);
  assert.equal(rows.get(15).smoothedIso, "2027-04-14");
  result.tasks.forEach((task) => {
    assert.equal(task.pulledFor, null);
    assert.equal(task.frozen, false);
  });
});

test("sortie dans l'ordre de l'entrée, quel que soit cet ordre", () => {
  const { tasks, settings, today } = SCENARIOS.A();
  const reversed = tasks.slice().reverse();
  const result = smoothTasks(reversed, settings, today);

  assert.deepEqual(
    result.tasks.map((task) => task.rowId),
    reversed.map((task) => task.rowId)
  );
  assert.deepEqual(monthsOf(result), monthsOf(run("A")));
  // Les champs de la tache d'entree sont conserves.
  assert.equal(result.tasks[0].name, "T18");
  assert.equal(result.tasks[0].dueIso, "2027-04-24");
});

test("exemple B : pas de place, rien ne bouge", () => {
  const result = run("B");

  assertUnchanged(result);
  assert.deepEqual(result.overflows, [
    { month: "2026-12", series: "TOTAL", count: 8, max: 4, reason: "plus-de-place" },
  ]);
});

test("exemple C : la place va au premier mois débordant", () => {
  const result = run("C");

  assert.deepEqual(monthsOf(result), {
    "2026-10": [1, 2, 11, 12],
    "2026-11": [13, 14, 15, 16],
    "2026-12": [21, 22, 23, 24, 25, 26],
  });
  assert.equal(result.movedCount, 2);
  assert.deepEqual(result.overflows, [
    { month: "2026-12", series: "TOTAL", count: 6, max: 4, reason: "plus-de-place" },
  ]);
});

test("exemple D : maximum par type, les coffrages ne bougent pas", () => {
  const result = run("D");

  assert.deepEqual(monthsOf(result), {
    "2027-03": [2, 4],
    "2027-04": [1, 3, 5, 6, 7],
  });
  assert.equal(result.movedCount, 2);
  assert.deepEqual(result.overflows, []);
  assert.equal(byRow(result).get(2).smoothedIso, "2027-03-05");
});

test("exemple E : maximum général et par type, le type d'abord", () => {
  const result = run("E");

  // Le coffrage le plus tot (3) avance pour le maximum Coffrage, puis la tache
  // la plus tot restante (1) pour le maximum general.
  assert.deepEqual(monthsOf(result), {
    "2027-03": [1, 3],
    "2027-04": [2, 4, 5, 6],
  });
  assert.equal(result.movedCount, 2);
  assert.deepEqual(result.overflows, []);

  const april = result.tasks.filter((task) => monthKeyOf(task.smoothedIso) === "2027-04");
  assert.equal(april.length, 4);
  assert.ok(april.filter((task) => task.type === "COFFRAGE").length <= 2);
});

test("exemple E, autre ordre : même bilan (avril 4 dont 2 coffrages, mars 2)", () => {
  const result = run("E2");

  assert.deepEqual(monthsOf(result), {
    "2027-03": [1, 2],
    "2027-04": [3, 4, 5, 6],
  });
  assert.equal(result.movedCount, 2);
});

test("exemple F : réalisées immobiles mais comptées", () => {
  const result = run("F");

  assert.deepEqual(monthsOf(result), {
    "2027-03": [2, 4],
    "2027-04": [1, 3, 5, 6],
  });
  const rows = byRow(result);
  [1, 3, 5].forEach((id) => {
    assert.equal(rows.get(id).frozen, true);
    assert.equal(rows.get(id).smoothedIso, rows.get(id).dueIso);
    assert.equal(rows.get(id).moved, false);
  });
  [2, 4, 6].forEach((id) => assert.equal(rows.get(id).frozen, false));
  assert.equal(result.movedCount, 2);
});

test("exemple G : mois en cours, rien ne peut avancer", () => {
  const result = run("G");

  assertUnchanged(result);
  // Echeance deja passee mais dans le mois courant : mobile, et non avancee
  // donc sa date d'origine est gardee.
  assert.equal(byRow(result).get(1).frozen, false);
  assert.equal(byRow(result).get(1).smoothedIso, "2027-04-01");
  assert.deepEqual(result.overflows, [
    { month: "2027-04", series: "TOTAL", count: 6, max: 4, reason: "mois-en-cours" },
  ]);
});

test("exemple H : ordre conservé, file unique sous maximum général", () => {
  const result = run("H");

  assert.deepEqual(monthsOf(result), {
    "2027-02": [1, 2],
    "2027-03": [3, 4],
    "2027-04": [5, 6],
  });
  assert.equal(result.movedCount, 2);
});

test("exemple H bis : file par type quand un maximum par type existe", () => {
  const result = run("Hbis");

  assert.deepEqual(monthsOf(result), {
    "2027-02": [1, 4],
    "2027-03": [2, 3],
    "2027-04": [5, 6],
  });
  assert.equal(byRow(result).get(4).smoothedIso, "2027-02-05");
  assert.equal(byRow(result).get(4).monthsAdvanced, 2);
  assert.equal(result.movedCount, 1);
});

// --- armature / coffrage (§4.6) ------------------------------------------------

// pulledFor de chaque tache, par rowId (null pour une tache non entrainee).
function pulledForOf(result) {
  return Object.fromEntries(result.tasks.map((task) => [task.rowId, task.pulledFor]));
}

test("exemple I : coffrage entraîné", () => {
  const result = run("I");

  assert.deepEqual(monthsOf(result), {
    "2027-03": [1, 2, 3],
    "2027-04": [4, 5],
  });
  const rows = byRow(result);
  assert.equal(rows.get(1).smoothedIso, "2027-03-02");
  assert.equal(rows.get(2).smoothedIso, "2027-03-10");
  assert.equal(rows.get(3).smoothedIso, "2027-03-15");
  assert.equal(rows.get(1).moved, true);
  // C est marque « avance pour liberer l'armature N° A1 » ; personne d'autre.
  assert.deepEqual(pulledForOf(result), { 1: "2", 2: null, 3: null, 4: null, 5: null });
  assert.equal(result.movedCount, 3);
  assert.deepEqual(result.overflows, []);
});

test("exemple J : coffrage sans place", () => {
  const result = run("J");

  assertUnchanged(result);
  result.tasks.forEach((task) => assert.equal(task.pulledFor, null));
  assert.deepEqual(result.overflows, [
    { month: "2027-04", series: "ARMATURES", count: 4, max: 2, reason: "coffrage-sans-place" },
  ]);
});

test("coffrage dans un mois intermédiaire", () => {
  const result = run("intermediate");

  assert.deepEqual(monthsOf(result), {
    "2027-02": [2, 3],
    "2027-03": [1],
    "2027-04": [4],
  });
  const rows = byRow(result);
  assert.equal(rows.get(2).smoothedIso, "2027-02-10");
  // A1 (05/04 -> 05/02) est relevee a la date lissee de son coffrage.
  assert.equal(rows.get(3).smoothedIso, "2027-02-10");
  assert.equal(rows.get(3).monthsAdvanced, 2);
  assert.equal(rows.get(1).smoothedIso, "2027-03-15");
  assert.equal(rows.get(1).moved, false);
  assert.equal(rows.get(4).smoothedIso, "2027-04-20");
  assert.deepEqual(pulledForOf(result), { 1: null, 2: "3", 3: null, 4: null });
  assert.equal(result.movedCount, 2);
});

test("coffrage réalisé : ne contraint plus", () => {
  const result = run("realizedCoffrage");

  assert.deepEqual(monthsOf(result), {
    "2027-03": [2],
    "2027-04": [1, 3, 4],
  });
  const rows = byRow(result);
  assert.equal(rows.get(1).smoothedIso, "2027-04-02");
  assert.equal(rows.get(1).frozen, true);
  assert.equal(rows.get(2).smoothedIso, "2027-03-10");
  result.tasks.forEach((task) => assert.equal(task.pulledFor, null));
  assert.equal(result.movedCount, 1);
});

test("deux coffrages dans le groupe : tous deux entraînés", () => {
  const result = run("twoCoffrages");

  assert.deepEqual(monthsOf(result), {
    "2027-03": [1, 2, 3],
    "2027-04": [4],
  });
  const rows = byRow(result);
  assert.equal(rows.get(1).smoothedIso, "2027-03-01");
  assert.equal(rows.get(2).smoothedIso, "2027-03-03");
  assert.equal(rows.get(3).smoothedIso, "2027-03-10");
  assert.deepEqual(pulledForOf(result), { 1: "3", 2: "3", 3: null, 4: null });
  assert.equal(result.movedCount, 3);
});

test("deux coffrages entraînés : ordre chronologique, quel que soit l'ordre d'entrée", () => {
  const { tasks, settings, today } = SCENARIOS.twoCoffragesOrdered();
  [tasks, tasks.slice().reverse()].forEach((input) => {
    const result = smoothTasks(input, settings, today);

    assert.deepEqual(monthsOf(result), {
      "2027-01": [2],
      "2027-02": [3, 4],
      "2027-03": [1],
      "2027-04": [5],
    });
    const rows = byRow(result);
    // C1 : 05/03 -> 05/01, deja passe : aujourd'hui. C2 : 03/04 -> 03/02.
    assert.equal(rows.get(2).smoothedIso, "2027-01-10");
    assert.equal(rows.get(3).smoothedIso, "2027-02-03");
    assert.equal(rows.get(4).smoothedIso, "2027-02-10");
    assert.equal(pulledForOf(result)[2], "4");
    assert.equal(pulledForOf(result)[3], "4");
    assert.equal(result.movedCount, 3);
    assert.deepEqual(result.overflows, []);
  });
});

test("groupKey vide : l'armature n'a pas de coffrage", () => {
  const result = run("emptyGroupKey");

  assert.deepEqual(monthsOf(result), {
    "2027-03": [2],
    "2027-04": [1, 3],
  });
  assert.equal(byRow(result).get(2).smoothedIso, "2027-03-05");
  result.tasks.forEach((task) => assert.equal(task.pulledFor, null));
});

test("coffrage d'un mois plus tardif que l'armature : entraîné aussi", () => {
  const result = run("coffrageLater");

  assert.deepEqual(monthsOf(result), {
    "2027-03": [1, 3],
    "2027-04": [2],
  });
  const rows = byRow(result);
  // C : 10/05 -> 10/03 ; A0 : 05/04 -> 05/03, relevee au 10/03.
  assert.equal(rows.get(3).smoothedIso, "2027-03-10");
  assert.equal(rows.get(3).monthsAdvanced, 2);
  assert.equal(rows.get(1).smoothedIso, "2027-03-10");
  assert.deepEqual(pulledForOf(result), { 1: null, 2: null, 3: "1" });
  assert.equal(result.movedCount, 2);
});

test("coffrage sans place : la raison vaut aussi pour la série Total", () => {
  const result = run("blockedTotal");

  assertUnchanged(result);
  assert.deepEqual(result.overflows, [
    { month: "2027-04", series: "TOTAL", count: 4, max: 3, reason: "coffrage-sans-place" },
  ]);
});

test("armature retenue par son coffrage : une armature plus tardive la double", () => {
  const result = run("blockedDoubled");

  assert.deepEqual(monthsOf(result), {
    "2027-01": [1],
    "2027-02": [2],
    "2027-03": [3, 6],
    "2027-04": [4, 5],
  });
  assert.equal(byRow(result).get(6).smoothedIso, "2027-03-10");
  assert.equal(byRow(result).get(5).moved, false);
  assert.equal(result.movedCount, 1);
  assert.deepEqual(result.overflows, []);
});

test("garde-fou : seule l'armature en faute sort de la remise en ordre", () => {
  const result = run("unrelatedKeepOrder");

  assert.deepEqual(monthsOf(result), {
    "2027-01": [1, 11],
    "2027-02": [2, 12],
    "2027-03": [3, 13],
    "2027-04": [4, 14],
    "2027-05": [15, 22],
    "2027-06": [20, 21],
  });
  const rows = byRow(result);
  // X1, X2, Y1, Y2 dans l'ordre chronologique, comme sans le groupe de juin.
  const alone = byRow(smoothTasks(unrelatedBase(), { maxByType: { ARMATURES: 1, COFFRAGE: 1 } }, JANUARY));
  [
    [1, "2027-01-10"],
    [2, "2027-02-20"],
    [3, "2027-03-05"],
    [4, "2027-04-20"],
  ].forEach(([id, iso]) => {
    assert.equal(rows.get(id).smoothedIso, iso, `ligne ${id}`);
    assert.equal(alone.get(id).smoothedIso, iso, `ligne ${id}, sans le groupe de juin`);
  });
  // A1 retenue par son coffrage ; B passe en mai et la double.
  assert.equal(rows.get(21).moved, false);
  assert.equal(rows.get(22).smoothedIso, "2027-05-10");
  assert.equal(result.movedCount, 4);
  assert.deepEqual(result.overflows, []);
});

test("garde-fou : la règle 4 d'abord, une règle 5 collatérale ne retire personne", () => {
  const result = run("collateralRule5");

  assert.deepEqual(monthsOf(result), {
    "2027-01": [11],
    "2027-02": [12],
    "2027-03": [13],
    "2027-04": [1, 14],
    "2027-05": [20, 21, 22],
    "2027-06": [2],
    "2027-07": [3],
  });
  const rows = byRow(result);
  // X (10/06) avant Y (05/07) : X en avril, Y en juin (mai est plein des
  // armatures retenues).
  assert.equal(rows.get(1).smoothedIso, "2027-04-10");
  assert.equal(rows.get(2).smoothedIso, "2027-06-05");
  assert.equal(rows.get(3).smoothedIso, "2027-07-20");
  assert.equal(rows.get(21).moved, false);
  assert.equal(rows.get(22).moved, false);
  assert.equal(result.movedCount, 2);
  assert.deepEqual(result.overflows, [
    { month: "2027-05", series: "ARMATURES", count: 2, max: 1, reason: "coffrage-sans-place" },
  ]);
});

test("garde-fou : règle 5 seule, l'armature liée déplacée sort avant la tâche sans lien", () => {
  const result = run("linkedMovedFirst");

  assert.deepEqual(monthsOf(result), {
    "2027-01": [11],
    "2027-02": [12],
    "2027-03": [13],
    "2027-04": [1, 14],
    "2027-05": [2, 20],
    "2027-06": [21, 22],
    "2027-07": [3],
  });
  const rows = byRow(result);
  // P (18/05) avant Z (09/07) : P en avril, Z en mai.
  assert.equal(rows.get(1).smoothedIso, "2027-04-18");
  assert.equal(rows.get(2).smoothedIso, "2027-05-09");
  assert.equal(rows.get(3).smoothedIso, "2027-07-24");
  assert.equal(rows.get(21).moved, false);
  assert.equal(rows.get(22).moved, false);
  assert.equal(result.movedCount, 2);
  assert.deepEqual(result.overflows, [
    { month: "2027-06", series: "ARMATURES", count: 2, max: 1, reason: "coffrage-sans-place" },
  ]);
});

test("garde-fou (surretrait) : règle 5 seule, sort l'armature liée qui a libéré le mois en faute", () => {
  const result = run("surretrait");

  assert.deepEqual(monthsOf(result), {
    "2027-01": [5, 11],
    "2027-02": [6, 12],
    "2027-03": [7, 13],
    "2027-04": [1, 14],
    "2027-05": [2, 20],
    "2027-06": [21, 22],
    "2027-07": [3],
  });
  const rows = byRow(result);
  // L1 (10/03) avant U1 (05/04) et U2 (25/04) : L1 en janvier, a la date de
  // son coffrage Cb ; U1 en fevrier, U2 en mars.
  assert.equal(rows.get(5).smoothedIso, "2027-01-20");
  assert.equal(rows.get(6).smoothedIso, "2027-02-05");
  assert.equal(rows.get(7).smoothedIso, "2027-03-25");
  // P, Z, Z' comme sans L1, U1 et U2.
  assert.equal(rows.get(1).smoothedIso, "2027-04-18");
  assert.equal(rows.get(2).smoothedIso, "2027-05-09");
  assert.equal(rows.get(3).smoothedIso, "2027-07-24");
  assert.equal(rows.get(21).moved, false);
  assert.equal(rows.get(22).moved, false);
  assert.equal(result.movedCount, 5);
  assert.deepEqual(result.overflows, [
    { month: "2027-06", series: "ARMATURES", count: 2, max: 1, reason: "coffrage-sans-place" },
  ]);
});

test("rule4Exception : retenues, entraînement, retirées pour la règle 4 ; rien d'autre", () => {
  const flagged = (name) => {
    const result = run(name);
    result.tasks.forEach((task) => assert.equal(typeof task.rule4Exception, "boolean", `${name}, ligne ${task.rowId}`));
    return result.tasks.filter((task) => task.rule4Exception).map((task) => task.rowId).sort((a, b) => a - b);
  };
  // Sans dependance armature / coffrage, ou sans maximum : personne.
  assert.deepEqual(flagged("A"), []);
  assert.deepEqual(flagged("H"), []);
  assert.deepEqual(flagged("inactive"), []);
  // Entrainement : le coffrage C et l'armature A1 qui l'entraine ; A2 rejoint
  // C en mars sans rien entrainer.
  assert.deepEqual(flagged("I"), [1, 2]);
  // Armatures retenues par leur coffrage.
  assert.deepEqual(flagged("J"), [3, 4, 5, 6]);
  assert.deepEqual(flagged("blockedDoubled"), [5]);
  assert.deepEqual(flagged("collateralRule5"), [21, 22]);
  // L1 (ligne 5) a bouge pendant un essai rate, mais rien ne la retient : elle
  // reste dans l'ordre chronologique.
  assert.deepEqual(flagged("surretrait"), [21, 22]);
  // Retiree pour la regle 4 (ni retenue ni entrainement).
  assert.deepEqual(flagged("rule4Removed"), [3]);
});

test("règle 4, armature retirée de la remise en ordre : une armature plus tardive la double", () => {
  const result = run("rule4Removed");

  assert.deepEqual(monthsOf(result), {
    "2027-02": [1],
    "2027-03": [4],
    "2027-04": [2, 3],
    "2027-05": [5],
  });
  assert.equal(byRow(result).get(4).smoothedIso, "2027-03-05");
  assert.equal(byRow(result).get(3).moved, false);
  assert.equal(result.movedCount, 2);
  assert.deepEqual(result.overflows, []);
});

// --- dates lissees (§4.5) ------------------------------------------------------

test("jour 31 vers un mois de 30 jours", () => {
  const rows = byRow(run("day31"));

  assert.equal(rows.get(1).smoothedIso, "2027-04-30");
  assert.equal(rows.get(2).smoothedIso, "2027-05-10");
  assert.equal(rows.get(3).smoothedIso, "2027-06-20");
});

test("avancée dans le mois courant à une date passée → aujourd'hui", () => {
  const rows = byRow(run("today"));

  assert.equal(rows.get(1).smoothedIso, "2027-03-20");
  assert.equal(rows.get(1).monthsAdvanced, 1);
  assert.equal(rows.get(1).moved, true);
  assert.equal(rows.get(2).smoothedIso, "2027-04-25");
  assert.equal(rows.get(2).moved, false);
});

// --- figees, mois passes, raisons ---------------------------------------------

test("mois passé jamais touché ni signalé", () => {
  const result = run("pastMonth");

  assertUnchanged(result);
  result.tasks.forEach((task) => assert.equal(task.frozen, true));
  assert.deepEqual(result.overflows, []);
});

test("mois passé vide jamais utilisé comme cible", () => {
  const result = run("pastMonthNeverTarget");

  assertUnchanged(result);
  assert.deepEqual(result.overflows, [
    { month: "2027-02", series: "TOTAL", count: 2, max: 1, reason: "plus-de-place" },
  ]);
});

test("raison « taches-realisees »", () => {
  const result = run("realizedOnly");

  assertUnchanged(result);
  assert.deepEqual(result.overflows, [
    { month: "2027-05", series: "TOTAL", count: 3, max: 2, reason: "taches-realisees" },
  ]);
});

test("dépassements triés par mois puis par série (TOTAL, puis TYPE_ORDER)", () => {
  const result = run("manyOverflows");

  assertUnchanged(result);
  assert.deepEqual(result.overflows, [
    { month: "2027-04", series: "TOTAL", count: 4, max: 2, reason: "mois-en-cours" },
    { month: "2027-04", series: "COFFRAGE", count: 2, max: 1, reason: "mois-en-cours" },
    { month: "2027-04", series: "NDC", count: 2, max: 1, reason: "mois-en-cours" },
    { month: "2027-05", series: "TOTAL", count: 3, max: 2, reason: "plus-de-place" },
    { month: "2027-05", series: "NDC", count: 3, max: 1, reason: "plus-de-place" },
  ]);
});

test("règle 5 : un mois en dépassement sur une autre série reçoit la tâche", () => {
  const result = run("otherSeriesOver");

  assert.deepEqual(monthsOf(result), {
    "2027-04": [1, 2, 3, 4],
    "2027-05": [5],
  });
  // Le NDC du 05/05 arrive en avril au 05/04 (apres aujourd'hui, 02/04).
  assert.equal(byRow(result).get(4).smoothedIso, "2027-04-05");
  assert.deepEqual(result.overflows, [
    { month: "2027-04", series: "ARMATURES", count: 3, max: 2, reason: "mois-en-cours" },
  ]);
});

// --- inactif, determinisme -------------------------------------------------------

test("sans maximum : inactif", () => {
  const result = run("inactive");

  assert.equal(result.active, false);
  assertUnchanged(result);
  assert.deepEqual(result.overflows, []);
  result.tasks.forEach((task) => assert.equal(task.pulledFor, null));
});

test("déterministe : deux appels, même résultat", () => {
  assert.deepEqual(run("A"), run("A"));
  assert.deepEqual(run("I"), run("I"));
});

// --- findSmoothingViolations ----------------------------------------------------

test("findSmoothingViolations : aucune violation sur tous les scénarios", (ctx) => {
  // smoothTasks avertit (console.warn) si son resultat enfreint une regle
  // stricte : cela ne doit jamais arriver.
  const warn = ctx.mock.method(console, "warn", () => {});
  Object.keys(SCENARIOS).forEach((name) => {
    const { tasks, settings, today } = SCENARIOS[name]();
    const result = smoothTasks(tasks, settings, today);
    assert.deepEqual(findSmoothingViolations(tasks, settings, today, result), [], name);
  });
  assert.equal(warn.mock.callCount(), 0);
});

// Resultat d'un scenario dont une tache recoit une autre date lissee.
function tampered(name, rowId, smoothedIso) {
  const { tasks, settings, today } = SCENARIOS[name]();
  const result = smoothTasks(tasks, settings, today);
  const forged = {
    ...result,
    tasks: result.tasks.map((task) => (task.rowId === rowId ? { ...task, smoothedIso } : task)),
  };
  return findSmoothingViolations(tasks, settings, today, forged);
}

// Les messages signalent tous la regle attendue, et l'un d'eux la tache
// trafiquee (« N° <id2> (ligne <rowId>) »), avec le detail attendu.
function assertRule(messages, rule, rowId, detail) {
  assert.ok(messages.length > 0, "aucune violation signalée");
  messages.forEach((message) => assert.ok(message.endsWith(`(règle ${rule}).`), message));
  const own = messages.filter((message) => message.startsWith(`N° ${rowId} (ligne ${rowId}) :`));
  assert.ok(own.length > 0, `rien sur la ligne ${rowId} : ${messages.join(" | ")}`);
  if (detail) assert.ok(own.some((message) => message.includes(detail)), own.join(" | "));
}

test("findSmoothingViolations : date lissée postérieure à l'échéance", () => {
  // A5 (echeance 14/04) reportee au 01/05.
  assertRule(tampered("A", 15, "2027-05-01"), 1, 15, "après l'échéance 2027-04-14");
});

test("findSmoothingViolations : tâche figée déplacée", () => {
  // Tache realisee du 01/04 avancee en mars.
  assertRule(tampered("F", 1, "2027-03-01"), 3, 1, "tâche figée déplacée");
});

test("findSmoothingViolations : avancée avant aujourd'hui ou dans un mois passé", () => {
  // Dans le mois courant, mais avant le 20/03.
  assertRule(tampered("today", 1, "2027-03-10"), 2, 1, "avant aujourd'hui (2027-03-20)");
  // Dans un mois passe.
  assertRule(tampered("pastMonthNeverTarget", 3, "2026-11-15"), 2, 3, "placée le 2026-11-15");
});

test("findSmoothingViolations : mois d'arrivée au-dessus du maximum général", () => {
  // A5 avancee en mars : mars passerait a 5 taches pour un maximum de 4.
  assertRule(tampered("A", 15, "2027-03-14"), 5, 15, "total 5 / 4");
});

test("findSmoothingViolations : mois d'arrivée au-dessus du maximum du type", () => {
  // D : l'armature 6 avancee au 20/03 ; mars passerait a 3 armatures pour 2.
  assertRule(tampered("D", 6, "2027-03-20"), 5, 6, "ARMATURES 3 / 2");
});

test("findSmoothingViolations : armature avancée avant son coffrage", () => {
  // I : A1 avancee au 01/03, avant son coffrage C (02/03).
  assertRule(tampered("I", 2, "2027-03-01"), 4, 2, "coffrage N° 1 (2027-03-02)");
  // Mois intermediaire : C laisse a son echeance (10/03) alors que A1 est en
  // fevrier.
  assertRule(tampered("intermediate", 2, "2027-03-10"), 4, 3, "coffrage N° 2 (2027-03-10)");
});

test("findSmoothingViolations : un coffrage réalisé ne contraint pas", () => {
  // A1 avancee au 01/03 alors que son coffrage realise reste au 02/04 : permis.
  assert.deepEqual(tampered("realizedCoffrage", 2, "2027-03-01"), []);
});

// --- mois de depart (startMonth) ----------------------------------------------

test("smoothingStartMonth : mois de départ fixé, sinon le mois en cours ; jamais après lui", () => {
  assert.equal(smoothingStartMonth({ startMonth: "2026-06" }, "2026-10-26"), "2026-06");
  assert.equal(smoothingStartMonth({}, "2026-10-26"), "2026-10");
  assert.equal(smoothingStartMonth(null, "2026-10-26"), "2026-10");
  assert.equal(smoothingStartMonth({ startMonth: "2027-01" }, "2026-10-26"), "2026-10");
  assert.equal(smoothingStartMonth({ startMonth: "juin" }, "2026-10-26"), "2026-10");
});

test("départ passé : les tâches en trop vont dans des mois passés, même vides", () => {
  const result = run("startPast");

  assert.deepEqual(monthsOf(result), {
    "2027-01": [1],
    "2027-02": [2, 3],
    "2027-03": [4, 5],
    "2027-04": [6],
  });
  const rows = byRow(result);
  assert.equal(rows.get(1).smoothedIso, "2027-01-05");
  assert.equal(rows.get(2).smoothedIso, "2027-02-10");
  assert.equal(rows.get(3).smoothedIso, "2027-02-20");
  assert.equal(result.movedCount, 3);
  assert.deepEqual(result.overflows, []);
});

test("départ passé : jamais avant le mois de départ ; les mois d'avant restent figés et non signalés", () => {
  const result = run("startPastLimit");

  assert.deepEqual(monthsOf(result), {
    "2026-12": [9, 10],
    "2027-01": [1],
    "2027-02": [2],
    "2027-03": [3, 4],
  });
  const rows = byRow(result);
  assert.equal(rows.get(9).frozen, true);
  assert.equal(rows.get(10).frozen, true);
  assert.equal(rows.get(3).frozen, false);
  assert.deepEqual(result.overflows, [
    { month: "2027-03", series: "TOTAL", count: 2, max: 1, reason: "plus-de-place" },
  ]);
});

test("départ passé : la tâche à venir passe d'abord ; la tâche en retard, mobile, n'a plus de place et reste", () => {
  const result = run("lateTasks");

  assert.deepEqual(monthsOf(result), { "2027-01": [2], "2027-02": [1], "2027-03": [3, 4] });
  const rows = byRow(result);
  assert.equal(rows.get(1).frozen, false);
  assert.equal(rows.get(1).moved, false);
  assert.equal(rows.get(2).smoothedIso, "2027-01-05");
  assert.deepEqual(result.overflows, [
    { month: "2027-03", series: "TOTAL", count: 2, max: 1, reason: "plus-de-place" },
  ]);
});

test("départ passé : un mois passé plein de tâches en retard a la raison « taches-passees »", () => {
  const result = run("lateMonthOver");

  assertUnchanged(result);
  assert.deepEqual(result.overflows, [
    { month: "2027-01", series: "TOTAL", count: 2, max: 1, reason: "taches-passees" },
  ]);
});

test("départ passé : un coffrage en retard est entraîné par son armature", () => {
  const result = run("lateCoffrage");

  assert.deepEqual(monthsOf(result), { "2027-01": [1, 3], "2027-02": [2], "2027-03": [4] });
  const rows = byRow(result);
  assert.equal(rows.get(1).frozen, false);
  assert.equal(rows.get(1).pulledFor, "3");
  assert.ok(rows.get(1).smoothedIso <= rows.get(3).smoothedIso, "le coffrage reste avant son armature");
  assert.deepEqual(result.overflows, []);
});

test("départ passé : les tâches en retard en trop descendent dans les mois libres (bug du 28/10/2026)", () => {
  const result = run("lateUseMargin");

  // Fevrier garde la tache realisee ; les trois en retard partent en janvier,
  // decembre et novembre, du plus tardif au plus tot, dans l'ordre chronologique.
  assert.deepEqual(monthsOf(result), {
    "2026-11": [1],
    "2026-12": [2],
    "2027-01": [3],
    "2027-02": [4],
  });
  assert.equal(byRow(result).get(1).smoothedIso, "2026-11-05");
  assert.equal(byRow(result).get(4).frozen, true);
  assert.deepEqual(result.overflows, []);
});

test("départ passé : les tâches à venir passent avant les tâches en retard", () => {
  const result = run("latePriority");

  assert.deepEqual(monthsOf(result), { "2027-01": [3], "2027-02": [1, 2], "2027-03": [4] });
  assert.deepEqual(result.overflows, [
    { month: "2027-02", series: "TOTAL", count: 2, max: 1, reason: "plus-de-place" },
  ]);
});

test("mois de départ par défaut (mois en cours) : les tâches en retard restent figées, comme avant", () => {
  const { tasks, today } = SCENARIOS.lateUseMargin();
  const result = smoothTasks(tasks, { maxTotal: 1, maxByType: {} }, today);

  assertUnchanged(result);
  assert.ok(result.tasks.every((task) => task.frozen), "toutes figées : aucun mois avant le mois en cours");
});

test("départ après le mois en cours : le mois en cours vaut", () => {
  const result = run("startAfterToday");

  assert.deepEqual(monthsOf(result), { "2027-01": [1], "2027-02": [2] });
  assert.equal(byRow(result).get(1).smoothedIso, "2027-01-10");
});

test("départ passé : avancée dans le mois en cours, le jour est gardé même s'il est passé", () => {
  const result = run("startPastDay");

  assert.deepEqual(monthsOf(result), { "2027-03": [2], "2027-04": [3] });
  assert.equal(byRow(result).get(2).smoothedIso, "2027-03-10");
});

// --- maximums d'un mois precis (maxByMonth) -------------------------------------

test("monthMaxima : le mois précis remplace, valeur par valeur, celui de tous les mois", () => {
  const settings = {
    maxTotal: 4,
    maxByType: { COFFRAGE: 4, ARMATURES: 4 },
    maxByMonth: { "2027-03": { maxTotal: 6, maxByType: { ARMATURES: 6, NDC: 1 } } },
  };
  assert.deepEqual(monthMaxima(settings, "2027-03"), {
    maxTotal: 6,
    maxByType: { COFFRAGE: 4, ARMATURES: 6, NDC: 1 },
  });
  assert.deepEqual(monthMaxima(settings, "2027-04"), {
    maxTotal: 4,
    maxByType: { COFFRAGE: 4, ARMATURES: 4 },
  });
  assert.deepEqual(
    monthMaxima({ maxTotal: 4, maxByType: {}, maxByMonth: { "2027-03": { maxTotal: null, maxByType: { NDC: 2 } } } }, "2027-03"),
    { maxTotal: 4, maxByType: { NDC: 2 } }
  );
  assert.deepEqual(monthMaxima(null, "2027-03"), { maxTotal: null, maxByType: {} });
});

test("mois plus bas que les autres : les tâches en trop en partent", () => {
  const result = run("monthLower");

  assert.deepEqual(monthsOf(result), { "2027-03": [1, 2], "2027-04": [3, 4], "2027-05": [5] });
  assert.deepEqual(result.overflows, []);
});

test("mois plus haut que les autres : il garde ses tâches", () => {
  const result = run("monthHigher");

  assert.deepEqual(monthsOf(result), {
    "2027-02": [5],
    "2027-03": [6, 7],
    "2027-04": [1, 2, 3, 4],
  });
  assert.deepEqual(result.overflows, []);
});

test("maximum d'un seul mois, sans maximum général : le lissage est actif", () => {
  const result = run("monthTypeOnly");

  assert.equal(result.active, true);
  assert.deepEqual(monthsOf(result), { "2027-03": [1, 2], "2027-04": [3, 4] });
  assert.equal(byRow(result).get(1).smoothedIso, "2027-03-05");
});

test("dépassements rapportés avec le maximum du mois", () => {
  const result = run("monthOverflowMax");

  assertUnchanged(result);
  assert.deepEqual(result.overflows, [
    { month: "2027-01", series: "TOTAL", count: 3, max: 2, reason: "mois-en-cours" },
    { month: "2027-01", series: "NDC", count: 2, max: 1, reason: "mois-en-cours" },
    { month: "2027-02", series: "TOTAL", count: 2, max: 1, reason: "plus-de-place" },
  ]);
});

test("findSmoothingViolations : avancée avant le mois de départ", () => {
  assertRule(tampered("startPast", 1, "2026-12-05"), 2, 1, "avant le début du lissage (2027-01)");
});

test("findSmoothingViolations : mois d'arrivée au-dessus de son maximum propre", () => {
  // Mai avancee en avril : avril passerait a 3 taches pour son maximum de 2.
  assertRule(tampered("monthLower", 5, "2027-04-10"), 5, 5, "total 3 / 2");
});

test("départ passé : une armature avancée dans un mois passé y entraîne son coffrage", () => {
  const result = run("startPastPull");

  assert.deepEqual(monthsOf(result), { "2027-02": [1, 2], "2027-03": [3] });
  assert.equal(byRow(result).get(1).pulledFor, "2");
  assert.deepEqual(result.overflows, []);
});

test("maximum par type d'un seul mois : une file par type", () => {
  const result = run("monthQueueByType");

  assert.deepEqual(monthsOf(result), { "2027-02": [2], "2027-03": [1, 3] });
  assert.deepEqual(result.overflows, []);
});

// --- 0 pour un mois precis : aucune tache ce mois-la -----------------------------

test("mois à 0 : ses tâches à venir partent toutes dans les mois d'avant", () => {
  const result = run("monthZero");

  assert.deepEqual(monthsOf(result), { "2027-03": [1, 2, 3, 4] });
  assert.equal(byRow(result).get(1).smoothedIso, "2027-03-05");
  assert.deepEqual(result.overflows, []);
});

test("mois à 0 : aucune tâche n'y arrive, même vide", () => {
  const result = run("monthZeroSkipped");

  assert.deepEqual(monthsOf(result), { "2027-02": [1], "2027-04": [2] });
  assert.deepEqual(result.overflows, []);
});

test("mois à 0 pour un type : seules les tâches de ce type partent", () => {
  const result = run("monthZeroType");

  assert.deepEqual(monthsOf(result), { "2027-03": [1, 2], "2027-04": [3] });
  assert.deepEqual(result.overflows, []);
});

test("mois à 0 avec une tâche réalisée : elle reste, le mois est signalé", () => {
  const result = run("monthZeroFrozen");

  assert.deepEqual(monthsOf(result), { "2027-02": [2], "2027-03": [1] });
  assert.deepEqual(result.overflows, [
    { month: "2027-03", series: "TOTAL", count: 1, max: 0, reason: "taches-realisees" },
  ]);
});

test("mois courant à 0, lissage parti du mois courant : la tâche reste, le mois est signalé", () => {
  const result = run("monthZeroCurrent");

  assert.deepEqual(monthsOf(result), { "2027-01": [1] });
  assert.deepEqual(result.overflows, [
    { month: "2027-01", series: "TOTAL", count: 1, max: 0, reason: "mois-en-cours" },
  ]);
});

test("monthMaxima : un 0 de mois précis vaut 0, pas « pas de maximum »", () => {
  const settings = {
    maxTotal: 4,
    maxByType: { ARMATURES: 2 },
    maxByMonth: { "2027-03": { maxTotal: 0, maxByType: { ARMATURES: 0 } } },
  };
  assert.deepEqual(monthMaxima(settings, "2027-03"), { maxTotal: 0, maxByType: { ARMATURES: 0 } });
  assert.deepEqual(monthMaxima(settings, "2027-04"), { maxTotal: 4, maxByType: { ARMATURES: 2 } });
});

test("0 pour tous les mois : ignoré (aucun lissage), comme avant", () => {
  const result = smoothTasks([t(1, "NDC", "2027-04-05")], { maxTotal: 0, maxByType: { NDC: 0 } }, JANUARY);

  assert.equal(result.active, false);
  assertUnchanged(result);
});
