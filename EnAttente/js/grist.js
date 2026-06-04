window.App = {
  records: [],
};

window.initGrist = function(onUpdate) {
  grist.ready({ requiredAccess: "full" });

  grist.onRecords((recs) => {
    App.records = recs || [];
    if (typeof onUpdate === "function") onUpdate();
  });
};
