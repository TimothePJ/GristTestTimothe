window.App = {
  records: [],
  recordsReady: false,
};

window.initGrist = function(onUpdate) {
  grist.ready({ requiredAccess: "full" });

  grist.onRecords((recs) => {
    App.records = recs || [];
    App.recordsReady = true;
    if (typeof onUpdate === "function") onUpdate();
  });
};
