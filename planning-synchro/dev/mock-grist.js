// Injected before main.js in dev/harness.html. Mirrors the subset of the Grist API this widget uses.
import { FIXTURE_TABLES } from "./fixtures.js";
window.__appliedActions = [];
window.grist = {
  ready() {},
  docApi: {
    async fetchTable(name) {
      const rows = FIXTURE_TABLES[name] || [];
      // Real Grist returns every table column for every row. Fixtures have
      // heterogeneous keys (e.g. only some rows carry ID2/Groupe), so take the
      // UNION of keys across all rows — not just rows[0] — or later rows' extra
      // columns would be silently dropped.
      const cols = new Set(["id"]);
      rows.forEach((r) => Object.keys(r).forEach((k) => cols.add(k)));
      const out = {};
      cols.forEach((c) => { out[c] = rows.map((r) => r[c] ?? null); });
      return out; // column-oriented, like Grist
    },
    async applyUserActions(actions) {
      window.__appliedActions.push(...actions);
      // Apply the subset of actions this widget emits (AddRecord / UpdateRecord /
      // RemoveRecord) to the in-memory fixtures so a subsequent fetchTable()
      // reflects the write — the dev harness then behaves like real Grist
      // (edit/delete a segment -> re-render shows the change).
      const retValues = actions.map((action) => {
        const [verb, tableName, rowId, fields] = action;
        const table = FIXTURE_TABLES[tableName];
        if (!Array.isArray(table)) return null;

        if (verb === "AddRecord") {
          const nextId = table.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
          table.push({ id: nextId, ...(fields || {}) });
          return nextId;
        }
        if (verb === "UpdateRecord") {
          const row = table.find((r) => Number(r.id) === Number(rowId));
          if (row) Object.assign(row, fields || {});
          return Number(rowId);
        }
        if (verb === "RemoveRecord") {
          const index = table.findIndex((r) => Number(r.id) === Number(rowId));
          if (index >= 0) table.splice(index, 1);
          return Number(rowId);
        }
        return null;
      });
      return { retValues };
    },
  },
};
