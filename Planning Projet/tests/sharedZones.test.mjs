import test from "node:test";
import assert from "node:assert/strict";

import { buildTimelineDataFromPlanningRows } from "../assets/js/services/planningService.js";

const PROJECT = "HOTEL DIEU";
const ROWS = [
  { id: 1, NomProjet: PROJECT, Zone: "ZONE 1A (BAT A3, A4)", Service: "Structure" },
  {
    id: 2,
    NomProjet: PROJECT,
    Zone: "ZONE 1A (BAT A3, A4)",
    ID2: "1100",
    Taches: "PET_HD_STR_EXE_PL_Z01_RDCB",
    Type_doc: "COFFRAGE",
    Service: "Structure",
  },
];

function zoneHeaderLabels(timelineData) {
  return timelineData.groups.filter((group) => group.isZoneHeader).map((group) => group.zoneLabel);
}

test("les zones créées par un autre service ont leur bandeau dans le planning", () => {
  const data = buildTimelineDataFromPlanningRows(ROWS, PROJECT, "", null, null, [
    "ZONE 1A (BAT A3, A4)",
    "zone 1a bat a3 a4",
    "ELEVATIONS OUVERTURES",
  ]);
  const labels = zoneHeaderLabels(data);
  assert.ok(labels.includes("ELEVATIONS OUVERTURES"));
  assert.equal(labels.filter((label) => /1a/i.test(label)).length, 1);
});

test("une zone d'un autre service ne s'affiche pas quand une autre zone est filtrée", () => {
  const data = buildTimelineDataFromPlanningRows(ROWS, PROJECT, "ZONE 1A (BAT A3, A4)", null, null, [
    "ELEVATIONS OUVERTURES",
  ]);
  const labels = zoneHeaderLabels(data);
  assert.ok(labels.includes("ZONE 1A (BAT A3, A4)"));
  assert.ok(!labels.includes("ELEVATIONS OUVERTURES"));
});
