export function createGestionDepenses2ViewportAdapter(api = {}) {
  return {
    getSnapshot() {
      return {
        scope: {
          projectId: String(api.getSelectedProjectId?.() || "").trim(),
          zoneId: String(api.getSelectedZoneId?.() || "").trim(),
        },
        viewport: {
          mode: api.getZoomMode?.() || "month",
          anchorDate: api.getAnchorDate?.() || api.getFirstVisibleDate?.() || "",
          firstVisibleDate: api.getFirstVisibleDate?.() || "",
          visibleDays: api.getVisibleDays?.(),
          rangeStartDate: api.getRangeStartDate?.() || "",
          rangeEndDate: api.getRangeEndDate?.() || "",
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
