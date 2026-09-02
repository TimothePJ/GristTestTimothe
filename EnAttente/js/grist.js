window.App = {
  records: [],
  recordsReady: false,
};

const EN_ATTENTE_REFERENCE_DATA_CHANGE_STORAGE_KEY = "grist.references-data-change";

function installEnAttenteReferenceDataSync() {
  if (window.__referenceDataSyncAdded_enAttente) return;
  window.__referenceDataSyncAdded_enAttente = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== EN_ATTENTE_REFERENCE_DATA_CHANGE_STORAGE_KEY) return;
    let signal = { projectId: null, projectNumber: "" };
    try {
      const payload = JSON.parse(event.newValue || "{}");
      signal = {
        projectId: Number(payload.projectId) || null,
        projectNumber: String(payload.projectNumber || "").trim(),
      };
    } catch (_error) { }
    const matchesCurrentProject = window.GristServiceContext?.isSignalForCurrentProject;
    if (typeof matchesCurrentProject === "function" && !matchesCurrentProject(signal)) return;
    window.GristServiceContext?.refreshContextTables?.(
      ["References2"],
      {
        reason: "en-attente-window-signal",
        forceRefresh: true,
        signalProjectId: signal.projectId,
        signalProjectNumber: signal.projectNumber,
      }
    )?.catch((error) => {
      console.warn("EnAttente: actualisation References2 impossible :", error);
    });
  });
}

window.initGrist = function(onUpdate) {
  grist.ready({ requiredAccess: "full" });
  installEnAttenteReferenceDataSync();

  window.GristServiceContext.watchContextTable("References2", (recs) => {
    App.records = recs || [];
    App.recordsReady = true;
    if (typeof onUpdate === "function") onUpdate();
  }, {
    // Comme Reference2, EnAttente peut etre installe sur une vue ou une ancienne
    // table. onRecords reste le declencheur ; les lignes sont relues dans References2.
    acceptAnyNativeTableSignal: true,
    nativeSignalFilter: window.ReferenceProjectSyncRelay?.acceptNativeSignalForCurrentProject,
    projectScopedSignals: true,
  });
};
