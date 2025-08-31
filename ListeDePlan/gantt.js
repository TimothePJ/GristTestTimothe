google.charts.load("current", {
  packages: ["timeline"],
  language: "fr"
});

google.charts.setOnLoadCallback(() => {
  window.googleChartsReady = true;
});

function convertToGoogleData(records, project, designation) {
  const indices = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const dataRows = [];

  const filtered = records.filter(r =>
    r.NomProjet === project && r.Designation === designation
  );

  filtered.forEach(rec => {
    const nomPlan = rec.NomPlan || "(Sans nom)";
    const dernierIndice = rec.DernierIndice || "";
    const lastIndex = indices.indexOf(dernierIndice);
    if (lastIndex === -1) return;

    for (let i = 0; i <= lastIndex; i++) {
      const ind = indices[i];
      const dateStr = rec[ind];
      const date = dateStr ? new Date(dateStr) : null;
      if (!date || isNaN(date)) continue;

      const end = new Date(date);
      end.setHours(end.getHours() + 1);

      dataRows.push([
        nomPlan,
        `Indice ${ind}`,
        date,
        end
      ]);
    }
  });

  return dataRows;
}

function renderTaskList(records, project, designation) {
  const container = document.getElementById("task-rows");
  container.innerHTML = "";

  const filtered = records.filter(r =>
    r.NomProjet === project && r.Designation === designation
  );

  filtered.forEach(row => {
    const div = document.createElement("div");
    div.className = "task-row";

    const cell1 = document.createElement("div");
    cell1.className = "task-cell";
    cell1.textContent = row.NomPlan || "(Sans nom)";

    const cell2 = document.createElement("div");
    cell2.className = "task-cell";
    cell2.textContent = row.DernierIndice || "";

    div.appendChild(cell1);
    div.appendChild(cell2);
    container.appendChild(div);
  });
}

function renderFakeTimeAxis(start, end) {
  const container = document.getElementById("gantt-fake-axis");
  container.innerHTML = "";

  const days = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  days.forEach(day => {
    const span = document.createElement("span");
    span.textContent = day.toLocaleDateString("fr-FR", {
      weekday: "short",
      day: "2-digit",
      month: "short"
    });
    container.appendChild(span);
  });
}

function renderGantt(dataRows) {
  const container = document.getElementById("gantt");
  container.innerHTML = "";

  const chart = new google.visualization.Timeline(container);
  const dataTable = new google.visualization.DataTable();

  dataTable.addColumn({ type: 'string', id: 'NomPlan' });
  dataTable.addColumn({ type: 'string', id: 'Indice' });
  dataTable.addColumn({ type: 'date', id: 'Start' });
  dataTable.addColumn({ type: 'date', id: 'End' });

  dataTable.addRows(dataRows);

  const height = Math.max(400, dataTable.getNumberOfRows() * 45);
  container.style.height = height + "px";

  const { startMargin, endMargin } = getMinMaxDates(dataRows);
  renderFakeTimeAxis(startMargin, endMargin);

  chart.draw(dataTable, {
    timeline: {
      showRowLabels: true,
      colorByRowLabel: false,
      barLabelStyle: { fontSize: 12, color: '#222' }
    },
    backgroundColor: '#ffffff',
    avoidOverlappingGridLines: true,
    hAxis: {
      minValue: startMargin,
      maxValue: endMargin,
      format: 'dd MMM',
      textStyle: { color: '#222' },
      slantedText: false
    }
  });
}

window.updateGanttChart = function(project, designation, records) {
  if (!window.googleChartsReady) return;
  const dataRows = convertToGoogleData(records, project, designation);
  renderTaskList(records, project, designation);
  renderGantt(dataRows);
};

function getMinMaxDates(rows) {
  let min = null;
  let max = null;

  for (const row of rows) {
    const start = row[2];
    const end = row[3];
    if (!min || start < min) min = start;
    if (!max || end > max) max = end;
  }

  const startMargin = new Date(min);
  startMargin.setDate(startMargin.getDate() - 3);

  const endMargin = new Date(max);
  endMargin.setDate(endMargin.getDate() + 3);

  return { startMargin, endMargin };
}
