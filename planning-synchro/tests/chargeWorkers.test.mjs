import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkersFromSegments, groupWorkersByRole } from "../assets/js/bottom/chargeBoard.js";

const columns = {
  timeSegment: {
    id: "id",
    name: "Name",
    startDate: "Start_At",
    endDate: "End_At",
    allocationDays: "Allocation_Days",
    effectif: "Effectif",
    label: "Label",
  },
  projectTeam: { id: "id", name: "Name", role: "Role" },
};

test("two TimeSegment rows for the same Name collapse into one worker with 2 parsed segments", () => {
  const timeSegmentRows = [
    {
      id: 1,
      Name: "Fouzia Raggui",
      Start_At: "06/04/2026 08:00",
      End_At: "10/04/2026 17:00",
      Allocation_Days: "4,5",
      Effectif: "1",
      Label: "",
    },
    {
      id: 2,
      Name: "Fouzia Raggui",
      Start_At: "01/06/2026 08:00",
      End_At: "30/06/2026 17:00",
      Allocation_Days: "20",
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
  assert.equal(workers[0].segments[0].allocationDays, 4.5);
  assert.equal(workers[0].segments[1].allocationDays, 20);
});

test("role is attached from ProjectTeam by matching name", () => {
  const timeSegmentRows = [
    {
      id: 1,
      Name: "Guillaume Sadot",
      Start_At: "01/06/2026 08:00",
      End_At: "30/06/2026 17:00",
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
