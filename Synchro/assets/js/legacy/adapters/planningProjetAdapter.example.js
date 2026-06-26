export function createPlanningProjetViewportAdapter(api = {}) {
  return {
    getSnapshot() {
      return {
        scope: {
          projectId: String(api.getSelectedProjectId?.() || "").trim(),
          zoneId: String(api.getSelectedZoneId?.() || "").trim(),
        },
        viewport: {
          mode: api.getZoomMode?.() || "month",
          anchorDate: api.getAnchorDate?.() || api.getWindowCenterDate?.() || "",
          firstVisibleDate: api.getFirstVisibleDate?.() || api.getWindowStartDate?.() || "",
          visibleDays: api.getVisibleDays?.(),
          rangeStartDate: api.getRangeStartDate?.() || api.getWindowStartDate?.() || "",
          rangeEndDate: api.getRangeEndDate?.() || api.getWindowEndDate?.() || "",
        },
      };
    },

    applySnapshot(snapshot) {
      api.applyViewport?.({
        mode: snapshot.viewport.mode,
        anchorDate: snapshot.viewport.anchorDate,
        firstVisibleDate: snapshot.viewport.firstVisibleDate,
        visibleDays: snapshot.viewport.visibleDays,
        rangeStartDate: snapshot.viewport.rangeStartDate,
        rangeEndDate: snapshot.viewport.rangeEndDate,
        scope: snapshot.scope,
      });
    },

    subscribe(listener) {
      if (typeof api.onViewportChanged !== "function") {
        return () => {};
      }

      return api.onViewportChanged(listener);
    },
  };
}
