import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkersFromSegments, groupWorkersByRole } from "../assets/js/bottom/chargeBoard.js";
import { APP_CONFIG } from "../assets/js/config.js";

const COLS = APP_CONFIG.grist.columns;

const columns = {
  timeSegment: {
    id: "id",
    name: "Name",
    mois: "Mois",
    startDate: "Start_At",
    endDate: "End_At",
    allocationDays: "Allocation_Days",
    effectif: "Effectif",
    label: "Label",
  },
  projectTeam: { id: "id", name: "Name", role: "Role" },
};

// Mois explicites (non ambigus) : monthSegments.js ne sait PAS lire un
// datetime FR "JJ/MM/AAAA" (seul son repli legacy accepte l'ISO / MM-AAAA /
// epoch), donc ce test passe desormais par Mois plutot que par Start_At.
test("two TimeSegment rows for the same Name collapse into one worker with 2 parsed segments", () => {
  const timeSegmentRows = [
    {
      id: 1,
      Name: "Fouzia Raggui",
      Mois: "2026-04-01",
      Effectif: "1",
      Label: "",
    },
    {
      id: 2,
      Name: "Fouzia Raggui",
      Mois: "2026-06-01",
      Effectif: "1",
      Label: "",
    },
  ];

  const workers = buildWorkersFromSegments(timeSegmentRows, [], columns);

  assert.equal(workers.length, 1);
  assert.equal(workers[0].name, "Fouzia Raggui");
  assert.equal(workers[0].segments.length, 2);
  assert.ok(workers[0].segments[0].startAt instanceof Date);
  assert.ok(workers[0].segments[0].endAt instanceof Date);
  assert.equal(workers[0].segments[0].monthKey, "2026-04");
  assert.equal(workers[0].segments[1].monthKey, "2026-06");
});

test("buildWorkersFromSegments lit Mois et derive les bornes du mois", () => {
  const workers = buildWorkersFromSegments(
    [{ id: 1, NumeroProjet: "25-0142", Name: "Marie DUPONT", Mois: "2026-09-01", Effectif: 8 }],
    [{ NumeroProjet: "25-0142", Name: "Marie DUPONT", Role: "Projeteur" }],
    { timeSegment: COLS.timeSegment, projectTeam: COLS.projectTeam }
  );
  const [segment] = workers[0].segments;
  assert.equal(segment.monthKey, "2026-09");
  assert.equal(segment.startAt.getDate(), 1);
  assert.equal(segment.endAt.getDate(), 30);
  assert.equal(segment.effectif, 8);
});

test("buildWorkersFromSegments retombe sur Start_At pour les lignes legacy", () => {
  const workers = buildWorkersFromSegments(
    [{ id: 2, NumeroProjet: "25-0142", Name: "Marie DUPONT", Start_At: "2026-09-17", Effectif: 3 }],
    [], { timeSegment: COLS.timeSegment, projectTeam: COLS.projectTeam }
  );
  assert.equal(workers[0].segments[0].monthKey, "2026-09");
});

test("role is attached from ProjectTeam by matching name", () => {
  const timeSegmentRows = [
    {
      id: 1,
      Name: "Guillaume Sadot",
      // ISO (non ambigu) : cf. commentaire l. 22-24 — "01/06/2026" a l'americaine
      // (repli generique de getMonthKeyFromRawMonth) donnerait janvier, pas juin.
      Start_At: "2026-06-01",
      End_At: "2026-06-30",
      Allocation_Days: "20",
      Effectif: "1",
      Label: "",
    },
  ];
  const projectTeamRows = [{ id: 2, Name: "Guillaume Sadot", Role: "Ingenieur" }];

  const workers = buildWorkersFromSegments(timeSegmentRows, projectTeamRows, columns);

  assert.equal(workers.length, 1);
  assert.equal(workers[0].role, "Ingenieur");

  // No ProjectTeam match => role falls back to "" (unknown), not a guessed label.
  const withoutTeam = buildWorkersFromSegments(timeSegmentRows, [], columns);
  assert.equal(withoutTeam[0].role, "");
});

test("groupWorkersByRole buckets a Projeteur and an Ingenieur into distinct groups", () => {
  const grouped = groupWorkersByRole([
    { name: "Fouzia Raggui", role: "Projeteur", segments: [] },
    { name: "Guillaume Sadot", role: "Ingenieur", segments: [] },
  ]);

  assert.deepEqual(Object.keys(grouped), ["Projeteurs", "Ingenieurs"]);
  assert.equal(grouped["Projeteurs"].length, 1);
  assert.equal(grouped["Projeteurs"][0].name, "Fouzia Raggui");
  assert.equal(grouped["Ingenieurs"].length, 1);
  assert.equal(grouped["Ingenieurs"][0].name, "Guillaume Sadot");
});
