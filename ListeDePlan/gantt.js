google.charts.load("current", {
  packages: ["timeline"],
  language: "fr"
});

google.charts.setOnLoadCallback(() => {
  window.googleChartsReady = true;
});

let recordMap = new Map(); // Map NomPlan → ligne Grist

function convertToGoogleData(records, project, designation) {
  const indices = ["c0", ...("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""))];
  const dataRows = [];

  const filtered = records.filter(r =>
    r.NomProjet === project && r.Designation === designation
  );

  recordMap.clear();

  filtered.forEach(rec => {
    const nomPlan = rec.NomPlan || "(Sans nom)";
    recordMap.set(nomPlan, rec); // on lie le nom à l'objet complet

    let dernierIndice = rec.DernierIndice || "";
    if (dernierIndice === "0") dernierIndice = "c0";

    const lastIndex = indices.indexOf(dernierIndice);
    if (lastIndex === -1) return;

    for (let i = 0; i <= lastIndex; i++) {
      const ind = indices[i];
      const dateStr = rec[ind];
      const date = dateStr ? new Date(dateStr) : null;
      if (!date || isNaN(date)) continue;

      const end = new Date(date);
      end.setHours(end.getHours() + 1);
      const labelIndice = ind === "c0" ? "0" : ind;

      dataRows.push([nomPlan, labelIndice, date, end]);
    }
  });

  return dataRows;
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

  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();

    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top + container.scrollTop;

    const rowHeight = height / dataTable.getNumberOfRows();
    const rowIndex = Math.floor(y / rowHeight);
    if (rowIndex < 0 || rowIndex >= dataTable.getNumberOfRows()) return;

    const nomPlan = dataTable.getValue(rowIndex, 0);
    const indice = dataTable.getValue(rowIndex, 1);
    const record = recordMap.get(nomPlan);
    if (!record) return;

    const menu = document.getElementById('custom-context-menu');
    if (!menu) return;

    menu.style.display = 'block';
    menu.style.position = 'absolute';
    menu.style.top = `${e.pageY}px`;
    menu.style.left = `${e.pageX}px`;
    menu.style.background = '#333';
    menu.style.color = '#fff';
    menu.style.padding = '10px';
    menu.style.borderRadius = '4px';
    menu.style.zIndex = 10000;
    menu.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
    menu.innerHTML = `
      <div onclick="modifierPlan(${record.id})">Modifier</div>
      <div onclick="ajouterIndice(${record.id})">Ajouter un indice</div>
      <div onclick="supprimerIndice(${record.id}, '${indice}')">Supprimer l'indice ${indice}</div>
    `;
  });

  document.addEventListener('click', () => {
    const menu = document.getElementById('custom-context-menu');
    if (menu) menu.style.display = 'none';
  });
}

window.updateGanttChart = function (project, designation, records) {
  if (!window.googleChartsReady) return;
  const dataRows = convertToGoogleData(records, project, designation);
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
  startMargin.setDate(startMargin.getDate() - 5);
  const endMargin = new Date(max);
  endMargin.setDate(endMargin.getDate() + 5);

  return { startMargin, endMargin };
}

// Fonctions tests
function modifierPlan(id) {
  alert(`Modifier le plan ID ${id}`);
}

function ajouterIndice(id) {
  alert(`Ajouter un indice au plan ID ${id}`);
}

function supprimerIndice(id, indice) {
  alert(`Supprimer l'indice ${indice} du plan ID ${id}`);
}
