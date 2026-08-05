import test from "node:test";
import assert from "node:assert/strict";

import { renderPlanningManagement } from "../assets/js/ui/planningManagement.js";

class FakeHTMLElement {
  constructor() {
    this.innerHTML = "";
  }
}

test("la navigation mensuelle de Gestion - Plan reste identifiée comme consultation", () => {
  globalThis.HTMLElement = FakeHTMLElement;
  const board = new FakeHTMLElement();

  renderPlanningManagement(board, { planningTasks: [] }, "2026-03", {
    monthPickerOpen: true,
    monthPickerViewYear: 2026,
  });

  const buttons = [...board.innerHTML.matchAll(/<button[\s\S]*?<\/button>/g)]
    .map((match) => match[0]);
  assert.equal(buttons.length, 17);
  buttons.forEach((button) => {
    assert.match(button, /data-service-context-navigation/);
  });
  assert.match(board.innerHTML, /data-month-delta="-1"/);
  assert.match(board.innerHTML, /data-month-delta="1"/);
  assert.match(board.innerHTML, /data-month-value="2026-03"/);
});
