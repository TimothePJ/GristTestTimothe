// Garde-fou sur les fixtures du harnais de dev.
//
// La barre de charge de la fenetre de segment compte la charge d'une personne
// « tous projets et tous services confondus ». Ce comportement n'est observable
// dans dev/harness.html QUE si les fixtures contiennent une personne engagee sur
// deux projets differents le MEME mois. Ce n'etait pas le cas : un controle
// navigateur a du injecter la donnee au runtime pour exercer le cas.
//
// Ces tests echouent si quelqu'un retire cette personne des fixtures, ce qui
// rendrait le cas silencieusement inobservable a la main.

import { test } from "node:test";
import assert from "node:assert/strict";

import { FIXTURE_TABLES } from "../dev/fixtures.js";
import { computeMonthLoad } from "../assets/js/utils/monthLoad.js";
import { resolveSegmentMonthKey } from "../assets/js/utils/monthSegments.js";

const COLUMNS = {
  mois: "Mois",
  startDate: "Start_At",
  name: "Name",
  effectif: "Effectif",
};

function segmentsByPersonAndMonth() {
  const index = new Map();
  for (const row of FIXTURE_TABLES.TimeSegment) {
    const monthKey = resolveSegmentMonthKey(row, COLUMNS);
    if (!monthKey) continue;
    const key = `${row.Name}${monthKey}`;
    const projects = index.get(key) || new Set();
    projects.add(String(row.NumeroProjet));
    index.set(key, projects);
  }
  return index;
}

test("les fixtures contiennent une personne engagee sur deux projets le meme mois", () => {
  const shared = [...segmentsByPersonAndMonth()].filter(([, projects]) => projects.size > 1);

  assert.ok(
    shared.length > 0,
    "aucune personne des fixtures n'est engagee sur deux projets le meme mois : " +
      "la barre « tous projets » redevient inobservable dans dev/harness.html"
  );
});

test("la barre compte bien les jours poses sur l'AUTRE projet", () => {
  // Cas de reference documente dans dev/fixtures.js : Guillaume Sadot porte
  // 1 j sur 252035 et 14 j sur 999999, en mars 2027 (22 jours ouvres).
  const rows = FIXTURE_TABLES.TimeSegment;
  const own = rows.find(
    (row) =>
      row.Name === "Guillaume Sadot" &&
      String(row.NumeroProjet) === "252035" &&
      resolveSegmentMonthKey(row, COLUMNS) === "2027-03"
  );
  assert.ok(own, "segment de reference introuvable dans les fixtures");

  const load = computeMonthLoad({
    monthKey: "2027-03",
    personName: "Guillaume Sadot",
    allSegmentRows: rows,
    columns: COLUMNS,
    absenceSet: null,
    excludeSegmentId: own.id,
    draftEffectif: 1,
  });

  // 14 j viennent d'un projet que la vue courante n'affiche pas : sans le
  // comptage inter-projets, otherDays vaudrait 0 et le total 1 j.
  assert.equal(load.otherDays, 14);
  assert.equal(load.totalDays, 15);
  assert.equal(load.availableDays, 22);
  assert.equal(load.state, "partial");
  assert.equal(load.remainingDays, 7);
});

test("le cas de reference bascule bien sur les deux autres etats", () => {
  const rows = FIXTURE_TABLES.TimeSegment;
  const own = rows.find(
    (row) =>
      row.Name === "Guillaume Sadot" &&
      String(row.NumeroProjet) === "252035" &&
      resolveSegmentMonthKey(row, COLUMNS) === "2027-03"
  );

  const at = (draftEffectif) =>
    computeMonthLoad({
      monthKey: "2027-03",
      personName: "Guillaume Sadot",
      allSegmentRows: rows,
      columns: COLUMNS,
      absenceSet: null,
      excludeSegmentId: own.id,
      draftEffectif,
    });

  const balanced = at(8);
  assert.equal(balanced.state, "balanced");
  assert.equal(balanced.totalDays, 22);

  const overload = at(10);
  assert.equal(overload.state, "overload");
  assert.equal(overload.overloadDays, 2);
});
