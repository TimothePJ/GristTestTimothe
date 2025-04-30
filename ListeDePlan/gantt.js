google.charts.load("current", {packages:["timeline"]});
google.charts.setOnLoadCallback(() => { window.googleChartsReady = true; });

function convertToGoogleData(records, project, designation) {
  const indices = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const dataRows = [];
  const leftPanel = [];

  const filtered = records.filter(r => r.NomProjet === project && r.Designation === designation);

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

      // Pour Google Charts : début et fin = même date = événement ponctuel
      const end = new Date(date);
      end.setHours(end.getHours() + 1); // pour être visible

      dataRows.push([
        nomPlan,
        `Indice ${ind}`,
        date,
        end
      ]);
    }

    leftPanel.push({ nomPlan, dernierIndice });
  });

  return { dataRows, leftPanel };
}

function renderTaskList(leftPanel) {
  const container = document.getElementById("task-rows");
  container.innerHTML = "";

  leftPanel.forEach(row => {
    const div = document.createElement("div");
    div.className = "task-row";

    const plan = document.createElement("div");
    plan.className = "task-cell";
    plan.textContent = row.nomPlan;

    const dernier = document.createElement("div");
    dernier.className = "task-cell";
    dernier.textContent = row.dernierIndice;

    div.appendChild(plan);
    div.appendChild(dernier);
    container.appendChild(div);
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

    chart.draw(dataTable, {
    timeline: {
        showRowLabels: false,
        colorByRowLabel: false,
        barLabelStyle: { fontSize: 12, color: '#222' }
    },
    backgroundColor: '#ffffff',
    avoidOverlappingGridLines: true,
    hAxis: {
        minValue: startMargin,
        maxValue: endMargin
    }
    });

}

window.updateGanttChart = function(project, designation, records) {
  if (!window.googleChartsReady) return;

  const { dataRows, leftPanel } = convertToGoogleData(records, project, designation);
  renderTaskList(leftPanel);
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
  
    // Ajoute des jours de marge
    const startMargin = new Date(min);
    startMargin.setDate(startMargin.getDate() - 3);
  
    const endMargin = new Date(max);
    endMargin.setDate(endMargin.getDate() + 3);
  
    return { startMargin, endMargin };
  }
  