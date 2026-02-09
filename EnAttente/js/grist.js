const GristData = {
  records: [],
  tableId: null
};

function initGrist(onUpdate) {
  grist.ready({ requiredAccess: "read table" });

  grist.onTable((table) => {
    GristData.tableId = table?.id || null;
  });

  grist.onRecords((recs) => {
    GristData.records = recs || [];
    onUpdate();
  });
}
