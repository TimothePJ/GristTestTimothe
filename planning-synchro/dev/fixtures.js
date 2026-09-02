// Dev-only fixtures for dev/harness.html (mock Grist). Not shipped to production.
// TimeSegment (previsionnel) and Planning_Projet dates deliberately OVERLAP in 2027 so the
// shared frise shows both panes populated within the TimeSegment-derived bounds — mirroring
// how a real project's resource plan and task deadlines occupy the same period.

import { toGristMonthValue, getMonthBusinessDays } from "../assets/js/utils/monthSegments.js";

// Un segment = un mois : genere une ligne TimeSegment par mois entre startMonthKey
// et endMonthKey (inclus), au lieu d'une seule ligne Start_At/End_At couvrant toute
// la plage comme avant la bascule. Mois en epoch secondes (comme un vrai Grist
// Date) ; Allocation_Days dénormalisé (jamais relu par le code JS, seulement écrit
// pour la lisibilité de la grille Grist — cf. services/gristService.js).
function monthlyTimeSegmentRows({ idStart, numeroProjet, name, startMonthKey, endMonthKey, effectif, label = "" }) {
  const [startYear, startMonth] = startMonthKey.split("-").map(Number);
  const [endYear, endMonth] = endMonthKey.split("-").map(Number);
  const rows = [];
  let year = startYear;
  let month = startMonth;
  let id = idStart;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    rows.push({
      id: id++,
      NumeroProjet: numeroProjet,
      Name: name,
      Mois: toGristMonthValue(monthKey),
      Allocation_Days: getMonthBusinessDays(monthKey),
      Effectif: effectif,
      Label: label,
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return rows;
}

// Project 3 has MORE than 16 tasks (deliberately) to exercise the top pane's
// 16-row visible ceiling + internal vertical scroll (sticky frise). A long task
// name is included to exercise single-line truncation (ellipsis + title tooltip).
const MANY_TASK_NUMBER = "999999";
const MANY_TASK_ROWS = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  const limite = new Date(Date.UTC(2027, 1, 3 + i * 3)); // 03/02/2027 + 3 days each
  const coffrage = new Date(limite.getTime() + 10 * 24 * 3600 * 1000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    id: 1000 + n,
    NomProjet: "TEST SCROLL 20 TACHES",
    Taches:
      n === 1
        ? "TACHE 01 AVEC UN NOM VOLONTAIREMENT TRES TRES LONG POUR TESTER LA TRONCATURE ELLIPSIS ET LE TOOLTIP"
        : `TACHE ${String(n).padStart(2, "0")}`,
    Type_doc: "COFFRAGE",
    Ligne_planning: String(n),
    Zone: "Z01",
    Date_limite: iso(limite),
    Diff_coffrage: iso(coffrage),
  };
});

// Project 4: the SAME task name ("FONDATIONS - COF", "PH RDC - COF") repeated
// across two zones with empty Ligne_planning — exactly the real-data shape that
// used to wrongly merge into single rows. Each record has a distinct ID2, so the
// per-record grouping must keep them as separate rows (see top/phases.js).
const HOMONYM_NUMBER = "444444";
const HOMONYM_ROWS = [
  // Past-dated + realisé -> phase-past band (state rendering, exactly like Planning Projet).
  { id: 4000, NomProjet: "TEST ZONES HOMONYMES", ID2: "3000", Groupe: "1", Zone: "Zone 1 / BAT BC", Taches: "SEMELLES (réalisé)", Type_doc: "COFFRAGE", Date_limite: "2026-02-01", Diff_coffrage: "2026-03-01", Indice: "B", Realise: "100" },
  { id: 4001, NomProjet: "TEST ZONES HOMONYMES", ID2: "3001", Groupe: "1", Zone: "Zone 1 / BAT BC", Taches: "FONDATIONS - COF", Type_doc: "COFFRAGE", Date_limite: "2027-02-01", Diff_coffrage: "2027-02-15", Indice: "A", Realise: "100" },
  // Retard -> red inline style on the band.
  { id: 4002, NomProjet: "TEST ZONES HOMONYMES", ID2: "3031", Groupe: "4", Zone: "Zone 1 / BAT BC", Taches: "PH RDC - COF", Type_doc: "COFFRAGE", Date_limite: "2027-03-01", Diff_coffrage: "2027-03-15", Indice: "0", Realise: "50", Retards: "30" },
  { id: 4003, NomProjet: "TEST ZONES HOMONYMES", ID2: "3002", Groupe: "1", Zone: "Zone 2 / BAT B", Taches: "FONDATIONS - COF", Type_doc: "ARMATURES", Diff_coffrage: "2027-02-10", Diff_armature: "2027-02-24", Demarrages_travaux: "2027-03-15" },
  { id: 4004, NomProjet: "TEST ZONES HOMONYMES", ID2: "3032", Groupe: "4", Zone: "Zone 2 / BAT B", Taches: "PH RDC - COF", Type_doc: "COFFRAGE", Date_limite: "2027-03-10", Diff_coffrage: "2027-03-24", Demarrages_travaux: "2027-03-28" },
  // Phase FAR outside the TimeSegment window (ends 2027-04): the frise must widen
  // to cover it (union bounds) so this row is visible/scrollable.
  { id: 4005, NomProjet: "TEST ZONES HOMONYMES", ID2: "3080", Groupe: "9", Zone: "Zone 2 / BAT B", Taches: "PH R+5 - COF (2028)", Type_doc: "COFFRAGE", Date_limite: "2028-06-01", Diff_coffrage: "2028-06-15" },
];

export const FIXTURE_TABLES = {
  Projets2: [
    { id: 1, Nom_de_projet: "ERA QUAI D'ORSAY", Numero_de_projet: "252035", Avancement: '[{"typeDocument":"COFFRAGE","indice":"B"},{"typeDocument":"ARMATURES","indice":"0"}]' },
    { id: 2, Nom_de_projet: "HOTEL DIEU", Numero_de_projet: "12345" }, // no TimeSegment -> empty-state demo
    { id: 3, Nom_de_projet: "TEST SCROLL 20 TACHES", Numero_de_projet: MANY_TASK_NUMBER }, // >16 tasks -> scroll demo
    { id: 4, Nom_de_projet: "TEST ZONES HOMONYMES", Numero_de_projet: HOMONYM_NUMBER }, // homonym tasks across zones
    { id: 5, Nom_de_projet: "TEST BORD GAUCHE", Numero_de_projet: "555555" }, // reception band months before the only phase -> must NOT show at far-left
    { id: 6, Nom_de_projet: "TEST FUSION", Numero_de_projet: "666666" }, // 2 close same-type segments -> aggregate must keep them on ONE line
    { id: 7, Nom_de_projet: "TEST MAXZOOM", Numero_de_projet: "777777" }, // bounds span > max window -> at max zoom an early phase is off-screen (placement/phantom test)
    { id: 8, Nom_de_projet: "TEST EN COURS", Numero_de_projet: "888888" }, // a phase spanning today -> past/current split must stay on ONE line
  ],
  Planning_Projet: [
    // Mixed date formats (FR + ISO) on purpose to exercise the robust parser.
    { id: 1, NomProjet: "ERA QUAI D'ORSAY", Taches: "FONDATIONS", Type_doc: "COFFRAGE", Ligne_planning: "1", Zone: "Z01", Date_limite: "02/02/2027", Diff_coffrage: "2027-03-16", Diff_armature: "2027-04-01", Demarrages_travaux: "2027-05-01" },
    { id: 2, NomProjet: "ERA QUAI D'ORSAY", Taches: "LONGRINES", Type_doc: "ARMATURES", Ligne_planning: "2", Zone: "Z01", Date_limite: "2027-02-10", Diff_coffrage: "2027-03-20", Diff_armature: "2027-04-05" },
    { id: 3, NomProjet: "ERA QUAI D'ORSAY", Taches: "PH 1er SOUS-SOL - VOILES", Type_doc: "COFFRAGE", Ligne_planning: "3", Zone: "Z01", Date_limite: "20/02/2027", Diff_coffrage: "2027-04-10", Diff_armature: "2027-04-25", Demarrages_travaux: "2027-05-10" },
    { id: 4, NomProjet: "ERA QUAI D'ORSAY", Taches: "RSO", Type_doc: "NDC", Ligne_planning: "4", Zone: "Z01", Date_limite: "2027-03-01", Diff_coffrage: "2027-03-25" },
    { id: 5, NomProjet: "ERA QUAI D'ORSAY", Taches: "", Type_doc: "", Zone: "Z02" }, // zone-only header -> excluded
    ...MANY_TASK_ROWS,
    ...HOMONYM_ROWS,
    // TEST BORD GAUCHE: a single phase in June 2027 with a blocking reference
    // whose 14-week lead puts the "Données d'entrées" band ~2027-02-23, MONTHS
    // before the phase. The frise bounds must NOT extend to the band (phases
    // only), so it never appears as a stray segment at the far-left edge.
    { id: 5001, NomProjet: "TEST BORD GAUCHE", ID2: "5001", Zone: "Z1", Taches: "DALLE - COF", Type_doc: "COFFRAGE", Date_limite: "2027-06-01", Diff_coffrage: "2027-06-20" },
    // TEST FUSION: two COFFRAGE tasks in nearby (disjoint) periods. In aggregate
    // mode they must render on ONE line for the Coffrage type — zoomed out, their
    // "Coffrage" labels collide, which used to push one onto a 2nd lane (stacking).
    { id: 6001, NomProjet: "TEST FUSION", ID2: "6001", Zone: "Z1", Taches: "MUR A - COF", Type_doc: "COFFRAGE", Date_limite: "2027-02-01", Diff_coffrage: "2027-02-10" },
    { id: 6002, NomProjet: "TEST FUSION", ID2: "6002", Zone: "Z1", Taches: "MUR B - COF", Type_doc: "COFFRAGE", Date_limite: "2027-02-11", Diff_coffrage: "2027-02-20" },
    // TEST MAXZOOM: bounds span ~600 days (TimeSegment below), so the widest
    // window (426 days) does NOT cover everything. An early phase (Jan 2027) then
    // sits entirely off-screen-left of the max-zoom window (which ends ~2028-08).
    { id: 7001, NomProjet: "TEST MAXZOOM", ID2: "7001", Zone: "Z1", Taches: "DEBUT - COF", Type_doc: "COFFRAGE", Date_limite: "2027-01-15", Diff_coffrage: "2027-01-25" },
    { id: 7002, NomProjet: "TEST MAXZOOM", ID2: "7002", Zone: "Z1", Taches: "FIN - COF", Type_doc: "COFFRAGE", Date_limite: "2028-07-01", Diff_coffrage: "2028-07-20" },
    // TEST EN COURS: a COFFRAGE phase straddling "today" (2026) — the vendored
    // builder splits it into a past + a current item; both must render on ONE
    // line (colour changing at the red today line), not stacked on two.
    { id: 8001, NomProjet: "TEST EN COURS", ID2: "8001", Zone: "Z1", Taches: "DALLE EN COURS - COF", Type_doc: "COFFRAGE", Date_limite: "2026-06-01", Diff_coffrage: "2026-08-15" },
    // A TINY past portion (starts a few days before today) — its darker "past"
    // half must be the SAME height as the current half, not appear shorter.
    { id: 8002, NomProjet: "TEST EN COURS", ID2: "8002", Zone: "Z1", Taches: "MUR PETIT PASSE - COF", Type_doc: "COFFRAGE", Date_limite: "2026-07-02", Diff_coffrage: "2026-11-01" },
  ],
  // Un segment = un mois (bascule TimeSegment) : chaque bloc ci-dessous est une
  // ligne Mois par mois, generee par monthlyTimeSegmentRows() sur EXACTEMENT la
  // meme plage [debut, fin] que l'ancienne ligne Start_At/End_At qu'elle
  // remplace (donc les memes bornes de frise, les memes scenarios de zoom/
  // homonymes/etc. documentes plus haut restent couverts). Derniere ligne du
  // tableau EXCEPTEE : voir le commentaire "TEST LEGACY MOIS" en bas.
  TimeSegment: [
    ...monthlyTimeSegmentRows({ idStart: 101, numeroProjet: "252035", name: "Fouzia Raggui", startMonthKey: "2027-02", endMonthKey: "2027-02", effectif: 1 }),
    ...monthlyTimeSegmentRows({ idStart: 201, numeroProjet: "252035", name: "Guillaume Sadot", startMonthKey: "2027-03", endMonthKey: "2027-05", effectif: 1 }),
    // TEST BARRE MULTI-PROJETS : Guillaume Sadot est engage le MEME mois
    // (mars 2027) sur un SECOND projet. Sans cette ligne, aucune personne des
    // fixtures n apparaissait sous deux NumeroProjet, et la barre de charge
    // « tous projets et tous services » n etait pas observable dans le harnais
    // sans injection au runtime. Mars 2027 = 22 jours ouvres : en editant son
    // segment de 1 j sur 252035, la barre affiche 15 j / 22 j (partielle) ;
    // saisir 8 j la fait basculer sur « charge complete », 10 j sur surcharge.
    ...monthlyTimeSegmentRows({ idStart: 1301, numeroProjet: MANY_TASK_NUMBER, name: "Guillaume Sadot", startMonthKey: "2027-03", endMonthKey: "2027-03", effectif: 14 }),
    ...monthlyTimeSegmentRows({ idStart: 301, numeroProjet: "252035", name: "BA INGENERIE", startMonthKey: "2027-02", endMonthKey: "2027-04", effectif: 2 }),
    ...monthlyTimeSegmentRows({ idStart: 401, numeroProjet: "252035", name: "Laurent Orven", startMonthKey: "2027-04", endMonthKey: "2027-05", effectif: 1 }),
    // Project 3 (many tasks): mois generes sur toute la plage d'origine si bien
    // que la frise couvre toujours les dates de phase generees (MANY_TASK_ROWS).
    ...monthlyTimeSegmentRows({ idStart: 501, numeroProjet: MANY_TASK_NUMBER, name: "Equipe Etudes", startMonthKey: "2026-01", endMonthKey: "2027-12", effectif: 3 }),
    ...monthlyTimeSegmentRows({ idStart: 601, numeroProjet: MANY_TASK_NUMBER, name: "BE Externe", startMonthKey: "2027-02", endMonthKey: "2027-06", effectif: 2 }),
    // Project 4 (homonym zones): idem depuis debut 2026 pour couvrir la tache
    // passee (realisee).
    ...monthlyTimeSegmentRows({ idStart: 701, numeroProjet: HOMONYM_NUMBER, name: "Equipe Zones", startMonthKey: "2026-01", endMonthKey: "2027-04", effectif: 2 }),
    ...monthlyTimeSegmentRows({ idStart: 801, numeroProjet: "555555", name: "Equipe BG", startMonthKey: "2027-06", endMonthKey: "2027-06", effectif: 1 }),
    // Spans all of 2027 so the frise can zoom out to a year (labels then collide).
    ...monthlyTimeSegmentRows({ idStart: 901, numeroProjet: "666666", name: "Equipe Fusion", startMonthKey: "2027-01", endMonthKey: "2027-12", effectif: 1 }),
    // ~600-day span so the frise bounds exceed the 426-day max window.
    ...monthlyTimeSegmentRows({ idStart: 1001, numeroProjet: "777777", name: "Equipe MZ", startMonthKey: "2027-01", endMonthKey: "2028-08", effectif: 1 }),
    // TEST EN COURS: spans mid-2026 so today (2026) is inside the window.
    ...monthlyTimeSegmentRows({ idStart: 1101, numeroProjet: "888888", name: "Equipe EC", startMonthKey: "2026-06", endMonthKey: "2026-09", effectif: 1 }),
    // TEST LEGACY MOIS : ligne volontairement laissee au format pre-migration
    // (Start_At SEUL, pas de colonne Mois) pour que le harnais exerce le repli
    // legacy de resolveSegmentMonthKey (Mois absent -> Start_At). Date ISO
    // (non ambigue) : monthSegments.js ne sait pas lire un datetime FR
    // "JJ/MM/AAAA" comme le reste de ce fichier (voir task-5-report.md). Mois
    // (fevrier 2027) volontairement DEJA couvert par Fouzia/BA INGENERIE
    // ci-dessus : le repli reste exerce sans elargir les bornes de la demo par
    // defaut (252035 est le 1er projet du selecteur).
    { id: 1201, NumeroProjet: "252035", Name: "Nadia Ferrand", Start_At: "2027-02-17", Effectif: "2", Label: "" },
  ],
  ProjectTeam: [
    { id: 1, NumeroProjet: "252035", Name: "Fouzia Raggui", Role: "Projeteur", Daily_Rate: 0 },
    { id: 2, NumeroProjet: "252035", Name: "Guillaume Sadot", Role: "Ingenieur", Daily_Rate: 0 },
    { id: 3, NumeroProjet: "252035", Name: "BA INGENERIE", Role: "Sous-traitant", Daily_Rate: 0 },
    { id: 4, NumeroProjet: "252035", Name: "Laurent Orven", Role: "Ingenieur", Daily_Rate: 0 },
    { id: 8, NumeroProjet: "252035", Name: "Membre Sans Segment", Role: "Ingenieur", Daily_Rate: 0 }, // no TimeSegment -> must still appear
    { id: 9, NumeroProjet: "252035", Name: "Nadia Ferrand", Role: "Projeteur", Daily_Rate: 0 }, // TEST LEGACY MOIS (Start_At seul, cf. TimeSegment)
    { id: 5, NumeroProjet: MANY_TASK_NUMBER, Name: "Equipe Etudes", Role: "Projeteur", Daily_Rate: 0 },
    { id: 6, NumeroProjet: MANY_TASK_NUMBER, Name: "BE Externe", Role: "Sous-traitant", Daily_Rate: 0 },
    { id: 21, NumeroProjet: MANY_TASK_NUMBER, Name: "Guillaume Sadot", Role: "Ingenieur", Daily_Rate: 0 }, // TEST BARRE MULTI-PROJETS (cf. TimeSegment)
    { id: 7, NumeroProjet: HOMONYM_NUMBER, Name: "Equipe Zones", Role: "Projeteur", Daily_Rate: 0 },
    { id: 20, NumeroProjet: "555555", Name: "Equipe BG", Role: "Projeteur", Daily_Rate: 0 },
    { id: 30, NumeroProjet: "666666", Name: "Equipe Fusion", Role: "Projeteur", Daily_Rate: 0 },
    { id: 40, NumeroProjet: "777777", Name: "Equipe MZ", Role: "Projeteur", Daily_Rate: 0 },
    { id: 50, NumeroProjet: "888888", Name: "Equipe EC", Role: "Projeteur", Daily_Rate: 0 },
  ],
  // "Données d'entrées" (reception) references, linked to planning rows by
  // NomProjet + NumeroDocument(=ID2) + Type_document + NomDocument(=Taches) + Zone.
  // Two blocking refs on row 4001 (FONDATIONS - COF, Zone 1): one received, one
  // not -> "mixed" band. One blocking ref on row 4004 -> "missing" band.
  References2: [
    { id: 1, NomProjet: "TEST ZONES HOMONYMES", NumeroDocument: "3001", Type_document: "COFFRAGE", NomDocument: "FONDATIONS - COF", Zone: "Zone 1 / BAT BC", Bloquant: true, DureeLimite: "2", Recu: "", Emetteur: "BET", Reference: "PLA-330-A" },
    { id: 2, NomProjet: "TEST ZONES HOMONYMES", NumeroDocument: "3001", Type_document: "COFFRAGE", NomDocument: "FONDATIONS - COF", Zone: "Zone 1 / BAT BC", Bloquant: true, DureeLimite: "3", Recu: "15/01/2027", Emetteur: "Archi", Reference: "PLA-330-B" },
    { id: 3, NomProjet: "TEST ZONES HOMONYMES", NumeroDocument: "3032", Type_document: "COFFRAGE", NomDocument: "PH RDC - COF", Zone: "Zone 2 / BAT B", Bloquant: true, DureeLimite: "2", Recu: "", Emetteur: "BET", Reference: "PLA-331-A" },
    // TEST BORD GAUCHE: 14-week lead -> band ~2027-02-23, months before the phase (2027-06-01).
    { id: 4, NomProjet: "TEST BORD GAUCHE", NumeroDocument: "5001", Type_document: "COFFRAGE", NomDocument: "DALLE - COF", Zone: "Z1", Bloquant: true, DureeLimite: "14", Recu: "", Emetteur: "BET", Reference: "PLA-500-A" },
  ],
};
