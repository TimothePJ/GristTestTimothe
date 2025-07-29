grist.ready();

let records = [];
let avancementChart = null;
const INDICES = ["0", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

// Register the datalabels plugin
Chart.register(ChartDataLabels);

grist.onRecords((newRecords) => {
  records = newRecords;
  populateProjectDropdown();
  populateIndiceDropdown();
  updateDashboard();
});

function populateProjectDropdown() {
  const projectDropdown = document.getElementById('projectDropdown');
  const projects = [...new Set(records.map(r => r.Nom_projet))].filter(Boolean).sort();
  
  const currentValue = projectDropdown.value;
  while (projectDropdown.options.length > 1) projectDropdown.remove(1);

  projects.forEach(project => {
    const option = document.createElement('option');
    option.value = project;
    option.textContent = project;
    projectDropdown.appendChild(option);
  });
  projectDropdown.value = currentValue;
}

function populateIndiceDropdown() {
    const indiceDropdown = document.getElementById('indiceDropdown');
    const usedIndices = [...new Set(records.map(r => r.Indice))].filter(Boolean).sort((a, b) => INDICES.indexOf(a) - INDICES.indexOf(b));

    const currentValue = indiceDropdown.value;
    while (indiceDropdown.options.length > 1) indiceDropdown.remove(1);

    usedIndices.forEach(indice => {
        const option = document.createElement('option');
        option.value = indice;
        option.textContent = indice;
        indiceDropdown.appendChild(option);
    });
    if (currentValue) {
        indiceDropdown.value = currentValue;
    } else if (usedIndices.length > 0) {
        indiceDropdown.value = usedIndices[0];
    }
}


document.getElementById('projectDropdown').addEventListener('change', () => updateDashboard());
document.getElementById('indiceDropdown').addEventListener('change', () => updateDashboard());

function updateDashboard() {
    const selectedProject = document.getElementById('projectDropdown').value;
    const selectedIndice = document.getElementById('indiceDropdown').value;
    const statsOutput = document.getElementById('stats-output');
    const chartContainer = document.querySelector('.chart-container');
    statsOutput.innerHTML = ''; // Clear old stats

    if (!selectedProject || !selectedIndice) {
        if(avancementChart) avancementChart.destroy();
        chartContainer.style.display = 'none';
        statsOutput.innerHTML = '<p>Veuillez sélectionner un projet et un indice.</p>';
        return;
    }

    const projectRecords = records.filter(r => r.Nom_projet === selectedProject);
    if (projectRecords.length === 0) {
        if(avancementChart) avancementChart.destroy();
        chartContainer.style.display = 'none';
        statsOutput.innerHTML = '<p>Aucune donnée pour ce projet.</p>';
        return;
    }
    
    chartContainer.style.display = 'block';
    generateChartDataAndTable(projectRecords, selectedIndice);
}

function generateChartDataAndTable(projectRecords, selectedIndice) {
  const statsByType = {};

  projectRecords.forEach(record => {
    const type = record.Type_document || 'Non spécifié';
    if (!statsByType[type]) {
      statsByType[type] = {
        totalDocs: new Set(),
        docsWithIndice: new Set()
      };
    }
    statsByType[type].totalDocs.add(record.N_Document);
    if (record.Indice === selectedIndice) {
      statsByType[type].docsWithIndice.add(record.N_Document);
    }
  });

  const chartLabels = [];
  const dataWithIndice = [];
  const dataWithoutIndice = [];
  const rawCountsWithIndice = [];
  const rawCountsWithoutIndice = [];
  let tableHtml = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>Type de document</th>
          <th>Plans à l'indice</th>
          <th>Plans sans l'indice</th>
          <th>Nombre total</th>
          <th>Pourcentage</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const type in statsByType) {
    const stats = statsByType[type];
    const total = stats.totalDocs.size;
    const withIndice = stats.docsWithIndice.size;
    const withoutIndice = total - withIndice;
    const percentage = total > 0 ? ((withIndice / total) * 100).toFixed(2) : 0;
    
    chartLabels.push(type);
    dataWithIndice.push(total > 0 ? (withIndice / total) * 100 : 0);
    dataWithoutIndice.push(total > 0 ? (withoutIndice / total) * 100 : 0);
    rawCountsWithIndice.push(withIndice);
    rawCountsWithoutIndice.push(withoutIndice);

    tableHtml += `
      <tr>
        <td>${type}</td>
        <td>${withIndice}</td>
        <td>${withoutIndice}</td>
        <td>${total}</td>
        <td>${percentage}%</td>
      </tr>
    `;
  }

  tableHtml += '</tbody></table>';
  document.getElementById('stats-output').innerHTML = tableHtml;

  renderChart(chartLabels, dataWithIndice, dataWithoutIndice, rawCountsWithIndice, rawCountsWithoutIndice, selectedIndice);
}

function renderChart(labels, dataWithIndice, dataWithoutIndice, rawCountsWith, rawCountsWithout, selectedIndice) {
    const ctx = document.getElementById('avancementChart').getContext('2d');
    if (avancementChart) {
        avancementChart.destroy();
    }
    avancementChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: `Avec l'indice ${selectedIndice}`,
                data: dataWithIndice,
                backgroundColor: 'rgba(75, 192, 192, 0.5)',
                datalabels: {
                    labels: {
                        value: {
                            formatter: (value, context) => rawCountsWith[context.dataIndex]
                        }
                    }
                }
            }, {
                label: 'Sans l\'indice',
                data: dataWithoutIndice,
                backgroundColor: 'rgba(255, 99, 132, 0.5)',
                datalabels: {
                    labels: {
                        value: {
                            formatter: (value, context) => rawCountsWithout[context.dataIndex]
                        }
                    }
                }
            }]
        },
        options: {
            indexAxis: 'y',
            scales: {
                x: {
                    stacked: true,
                    max: 100,
                    ticks: {
                        callback: function(value) {
                            return value + "%"
                        }
                    }
                },
                y: {
                    stacked: true,
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: 'Avancement'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.x !== null) {
                                label += context.parsed.x.toFixed(2) + '%';
                            }
                            return label;
                        }
                    }
                },
                datalabels: {
                    color: '#000',
                    display: function(context) {
                        return context.dataset.data[context.dataIndex] > 0;
                    },
                    font: {
                        weight: 'bold'
                    },
                    formatter: Math.round
                }
            }
        }
    });
}
