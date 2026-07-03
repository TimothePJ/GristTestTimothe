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
      return { retValues: actions.map(() => 999) };
    },
  },
};
