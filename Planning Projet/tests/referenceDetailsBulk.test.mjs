import test from "node:test";
import assert from "node:assert/strict";

// timeline.js lit `window.location.search` au chargement pour reconnaître ses modes
// embarqués : le bac à sable doit exister avant l'import.
globalThis.window = {
  location: { search: "" },
  addEventListener() {},
  removeEventListener() {},
};
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement() { return { style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }; },
};

const { applyBulkCheckboxState } = await import("../assets/js/ui/timeline.js");

function checkboxes(states) {
  return states.map((checked) => ({ checked }));
}

// Le défaut d'origine : la case d'en-tête était relue à chaque tour de boucle, or
// chaque ligne modifiée émettait un `change` qui resynchronisait cette même case.
// Dès la première ligne cochée, l'en-tête repassait à « décoché » et toutes les
// lignes suivantes recopiaient cette valeur : une seule ligne était cochée.
test("cocher l'en-tête coche toutes les lignes malgré la resynchronisation", () => {
  const rows = checkboxes([false, false, false, false, false]);
  const header = { checked: true, indeterminate: false };
  const resynchronizeHeader = () => {
    const allChecked = rows.every((row) => row.checked);
    header.checked = allChecked;
    header.indeterminate = rows.some((row) => row.checked) && !allChecked;
  };

  const changedCount = applyBulkCheckboxState(rows, header.checked, resynchronizeHeader);

  assert.equal(changedCount, 5);
  assert.deepEqual(rows.map((row) => row.checked), [true, true, true, true, true]);
});

test("décocher l'en-tête décoche toutes les lignes", () => {
  const rows = checkboxes([true, true, true]);
  const header = { checked: false, indeterminate: false };

  const changedCount = applyBulkCheckboxState(rows, header.checked, () => {
    header.checked = rows.every((row) => row.checked);
  });

  assert.equal(changedCount, 3);
  assert.deepEqual(rows.map((row) => row.checked), [false, false, false]);
});

// Marquer « modifiée » une ligne qui ne change pas ferait croire à une saisie de
// l'utilisateur, et l'enregistrement la réécrirait sans raison.
test("une ligne déjà dans l'état voulu n'est pas notifiée", () => {
  const rows = checkboxes([true, false, true]);
  const notified = [];

  const changedCount = applyBulkCheckboxState(rows, true, (row) => notified.push(row));

  assert.equal(changedCount, 1);
  assert.equal(notified.length, 1);
  assert.equal(notified[0], rows[1]);
  assert.deepEqual(rows.map((row) => row.checked), [true, true, true]);
});

test("une liste vide ou invalide ne fait rien", () => {
  assert.equal(applyBulkCheckboxState([], true, () => {}), 0);
  assert.equal(applyBulkCheckboxState(null, true, () => {}), 0);
  assert.equal(applyBulkCheckboxState([null, undefined], true, () => {}), 0);
});
