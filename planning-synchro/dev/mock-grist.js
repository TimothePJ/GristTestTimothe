// Injected before main.js in dev/harness.html. Mirrors the subset of the Grist API this widget uses.
import { FIXTURE_TABLES } from "./fixtures.js";
window.__appliedActions = [];
window.grist = {
  ready() {},
  docApi: {
    async fetchTable(name) {
      const rows = FIXTURE_TABLES[name] || [];
      const cols = rows.length ? Object.keys(rows[0]) : ["id"];
      const out = {};
      cols.forEach((c) => { out[c] = rows.map((r) => r[c]); });
      return out; // column-oriented, like Grist
    },
    async applyUserActions(actions) {
      window.__appliedActions.push(...actions);
      return { retValues: actions.map(() => 999) };
    },
  },
};
