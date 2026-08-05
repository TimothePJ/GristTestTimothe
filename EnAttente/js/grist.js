window.App = {
  records: [],
  recordsReady: false,
};

window.initGrist = function(onUpdate) {
  grist.ready({ requiredAccess: "full" });

  window.GristServiceContext.watchContextTable("References2", (recs) => {
    App.records = recs || [];
    App.recordsReady = true;
    if (typeof onUpdate === "function") onUpdate();
  });
};
