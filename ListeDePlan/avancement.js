grist.ready();

let records = [];
let avancementChart = null;

// Register the datalabels plugin
Chart.register(ChartDataLabels);

grist.onRecords((newRecords) => {
  records = newRecords;
  populateProjectDropdown();
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

document.getElementById('projectDropdown').addEventListener('change', () => updateDashboard());

async function updateDashboard() {
    const selectedProject = document.getElementById('projectDropdown').value;
    const statsOutput = document.getElementById('stats-output');
    const chartContainer = document.querySelector('.chart-container');
    const avgContainer = document.getElementById('average-indices-container');
    statsOutput.innerHTML = ''; // Clear old stats

    if (!selectedProject) {
        if(avancementChart) avancementChart.destroy();
        chartContainer.style.display = 'none';
        if (avgContainer) avgContainer.style.display = 'none';
        statsOutput.innerHTML = '<p>Veuillez sélectionner un projet.</p>';
        return;
    }
    if (avgContainer) avgContainer.style.display = 'block';

    const projectRecords = records.filter(r => r.Nom_projet === selectedProject);
    if (projectRecords.length === 0) {
        if(avancementChart) avancementChart.destroy();
        chartContainer.style.display = 'none';
        if (avgContainer) avgContainer.style.display = 'none';
        statsOutput.innerHTML = '<p>Aucune donnée pour ce projet.</p>';
        return;
    }
    
    const ventilationData = await grist.docApi.fetchTable('Ventilation');
    const devisMap = {};
    for (let i = 0; i < ventilationData.id.length; i++) {
        devisMap[ventilationData.Type_document[i]] = ventilationData.Budget[i];
    }

    chartContainer.style.display = 'block';
    generateChartDataAndTable(projectRecords, devisMap);
}

function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function generateChartDataAndTable(projectRecords, devisMap) {
  const statsByType = {};
  const averageIndices = {};
  
  // Get all unique types and initialize stats objects
  const docTypes = [...new Set(projectRecords.map(r => r.Type_document || 'Non spécifié'))];
  docTypes.forEach(type => {
      statsByType[type] = { totalDocs: new Set(), advancedDocs: new Set() };
      averageIndices[type] = { withIndex: 0, withIndexZero: 0 };
  });
  if (docTypes.includes('COFFRAGE')) {
      statsByType['COFFRAGE - Indice B'] = { totalDocs: new Set(), advancedDocs: new Set() };
  }

  // Populate stats
  projectRecords.forEach(record => {
    const type = record.Type_document || 'Non spécifié';
    
    if (type === 'COFFRAGE' && record.Indice === 'B') {
        statsByType['COFFRAGE - Indice B'].advancedDocs.add(record.N_Document);
    }
    
    statsByType[type].totalDocs.add(record.N_Document);
    if (record.Indice === '0') {
        statsByType[type].advancedDocs.add(record.N_Document);
    }

    // Calculate average indices for specific types
    if (record.Indice !== null && record.Indice !== '') {
      averageIndices[type].withIndex++;
    }
    if (record.Indice === '0') {
      averageIndices[type].withIndexZero++;
    }
  });
  
  // Correct totals for COFFRAGE types
  if (statsByType['COFFRAGE']) {
      const coffrageTotalDocs = statsByType['COFFRAGE'].totalDocs;
      if (statsByType['COFFRAGE - Indice B']) {
          statsByType['COFFRAGE - Indice B'].totalDocs = coffrageTotalDocs;
      }
  }


  const chartLabels = [];
  const dataWithIndice = [];
  const dataWithoutIndice = [];
  const rawCountsWithIndice = [];
  const rawCountsWithoutIndice = [];
  const sortedTypes = Object.keys(statsByType).sort();
  let totalDevis = 0;
  for (const type of sortedTypes) {
    totalDevis += devisMap[type] || 0;
  }

  let tableHtml = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>Type de document</th>
          <th>Plans à l'indice</th>
          <th>Plans sans l'indice</th>
          <th>Nombre total</th>
          <th>Pourcentage plans</th>
          <th>Devis</th>
          <th>Pourcentage devis</th>
        </tr>
      </thead>
      <tbody>
  `;

  let totalPourcentageDevis = 0;

  for (const type of sortedTypes) {
    const stats = statsByType[type];
    const total = stats.totalDocs.size;
    const withIndice = stats.advancedDocs.size;
    const withoutIndice = total - withIndice;
    const percentage = total > 0 ? (withIndice / total) * 100 : 0;
    const devis = devisMap[type] || 0;
    const pourcentageDevis = totalDevis > 0 ? (percentage * devis) / totalDevis : 0;
    totalPourcentageDevis += pourcentageDevis;
    
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
        <td>${percentage.toFixed(2)}%</td>
        <td>${numberWithCommas(devis)}</td>
        <td>${pourcentageDevis.toFixed(2)}%</td>
      </tr>
    `;
  }
  // Calculate overall totals from the processed statsByType object
  let totalDocsCount = 0;
  let totalWithIndiceCount = 0;
  for(const type in statsByType){
      totalDocsCount+=statsByType[type].totalDocs.size;
      totalWithIndiceCount+=statsByType[type].advancedDocs.size;
  }

  const totalWithoutIndiceCount = totalDocsCount - totalWithIndiceCount;
  const totalPercentage = totalDocsCount > 0 ? ((totalWithIndiceCount / totalDocsCount) * 100).toFixed(2) : 0;

  tableHtml += `
    <tr class="total-row">
      <td><strong>Total</strong></td>
      <td><strong>${totalWithIndiceCount}</strong></td>
      <td><strong>${totalWithoutIndiceCount}</strong></td>
      <td><strong>${totalDocsCount}</strong></td>
      <td><strong>${totalPercentage}%</strong></td>
      <td><strong>${numberWithCommas(totalDevis)}</strong></td>
      <td><strong>${totalPourcentageDevis.toFixed(2)}%</strong></td>
    </tr>
  `;
  tableHtml += '</tbody></table>';
  document.getElementById('stats-output').innerHTML = tableHtml;

  // Add Total to Chart
  chartLabels.push('Total');
  dataWithIndice.push(totalDocsCount > 0 ? (totalWithIndiceCount / totalDocsCount) * 100 : 0);
  dataWithoutIndice.push(totalDocsCount > 0 ? (totalWithoutIndiceCount / totalDocsCount) * 100 : 0);
  rawCountsWithIndice.push(totalWithIndiceCount);
  rawCountsWithoutIndice.push(totalWithoutIndiceCount);

  renderChart(chartLabels, dataWithIndice, dataWithoutIndice, rawCountsWithIndice, rawCountsWithoutIndice);
  
  // Display average indices
  const avgContainer = document.getElementById('average-indices-container');
  let avgHtml = '<h3>Indice moyen</h3>';

  for (const type of sortedTypes) {
    if (type === 'COFFRAGE - Indice B') continue;
    const avgData = averageIndices[type];
    const avg = avgData.withIndexZero > 0 ? (avgData.withIndex / avgData.withIndexZero).toFixed(2) : 'N/A';
    avgHtml += `<p><strong>${type}:</strong> ${avg}</p>`;
  }
  
  avgContainer.innerHTML = avgHtml;
}

function renderChart(labels, dataWithIndice, dataWithoutIndice, rawCountsWith, rawCountsWithout) {
    const ctx = document.getElementById('avancementChart').getContext('2d');
    if (avancementChart) {
        avancementChart.destroy();
    }
    avancementChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: `Avancé`,
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
                label: 'Non avancé',
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
