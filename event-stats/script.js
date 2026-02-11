// Grist Options
function getGristOptions() {
  return [
    {
      name: "startDate",
      title: "Date de début",
      optional: false,
      type: "Date,DateTime",
      description: "Date de début"
    },
    {
      name: "endDate",
      title: "Date de fin",
      optional: true,
      type: "Date,DateTime",
      description: "Date de fin"
    },
    {
      name: "user",
      title: "Utilisateur",
      optional: true,
      type: "Text,Reference,Choice",
      description: "Utilisateur"
    },
    {
      name: "project",
      title: "Projet",
      optional: true,
      type: "Text,Reference,Choice",
      description: "Projet"
    },
    {
      name: "chapter",
      title: "Chapitre",
      optional: true,
      type: "Text,Reference,Choice",
      description: "Chapitre"
    }
  ];
}

let allRecords = [];
let chartInstance = null;

// Initialize
grist.ready({
  requiredAccess: 'read table',
  columns: getGristOptions(),
  allowSelectBy: true
});

grist.onRecords(function (records, mappings) {
  const mapped = grist.mapColumnNames(records, mappings);
  if (mapped) {
    allRecords = mapped.map(processRecord);
    populateFilters();
    updateDashboard();
  }
});

function processRecord(record) {
    // Parse Dates (Handle seconds vs milliseconds vs ISO)
    let start = parseDate(record.startDate);
    let end = parseDate(record.endDate);
    
    // Duration in hours
    let duration = 0;
    if (start && end) {
        duration = (end - start) / (1000 * 60 * 60); // ms to hours
    }
    // Default to 0 if negative or invalid
    if (duration < 0) duration = 0;

    return {
        ...record,
        _start: start,
        _end: end,
        _duration: duration,
        _year: start ? start.getFullYear() : null,
        _month: start ? start.getMonth() : null // 0-11
    };
}

function parseDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'number') {
        // Grist often sends seconds. Check if it looks like seconds (small number) vs ms.
        // 2000 year is ~946684800 seconds. 
        // 1975 is ~157766400000 ms.
        if (val < 10000000000) { 
            return new Date(val * 1000); 
        }
        return new Date(val);
    }
    return new Date(val);
}

function populateFilters() {
    const years = new Set();
    const users = new Set();
    const projects = new Set();
    const chapters = new Set();

    allRecords.forEach(r => {
        if (r._year) years.add(r._year);
        if (r.user) users.add(r.user);
        if (r.project) projects.add(r.project);
        if (r.chapter) chapters.add(r.chapter);
    });

    populateSelect('filter-year', Array.from(years).sort().reverse());
    populateSelect('filter-user', Array.from(users).sort());
    populateSelect('filter-project', Array.from(projects).sort());
    populateSelect('filter-chapter', Array.from(chapters).sort());
}

function populateSelect(id, values) {
    const select = document.getElementById(id);
    const current = select.value;
    
    // Keep "all" option
    select.innerHTML = '<option value="all">Tous</option>';
    
    values.forEach(v => {
        if (v === null || v === undefined || v === '') return;
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    });

    // Restore selection if valid
    if (values.includes(current) || (typeof current === 'string' && values.includes(parseInt(current)))) {
        select.value = current;
    }
}

// Event Listeners
['filter-year', 'filter-user', 'filter-project', 'filter-chapter', 'group-by'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateDashboard);
});

function updateDashboard() {
    const filters = {
        year: document.getElementById('filter-year').value,
        user: document.getElementById('filter-user').value,
        project: document.getElementById('filter-project').value,
        chapter: document.getElementById('filter-chapter').value
    };
    
    const groupBy = document.getElementById('group-by').value;

    // Filter Data
    const filtered = allRecords.filter(r => {
        if (filters.year !== 'all' && r._year != filters.year) return false;
        if (filters.user !== 'all' && r.user != filters.user) return false;
        if (filters.project !== 'all' && r.project != filters.project) return false;
        if (filters.chapter !== 'all' && r.chapter != filters.chapter) return false;
        return true;
    });

    // Update Stats
    const totalHours = filtered.reduce((sum, r) => sum + r._duration, 0);
    document.getElementById('total-hours').textContent = totalHours.toFixed(1);
    document.getElementById('total-events').textContent = filtered.length;

    // Prepare Chart Data
    renderChart(filtered, groupBy, filters.year);
}

function renderChart(data, groupBy, selectedYear) {
    const ctx = document.getElementById('hoursChart').getContext('2d');
    
    // X-Axis Labels (Months if Year selected, or Years if 'all' years)
    // Actually, usually we want to see trend over time (Months).
    // If "All Years" selected, showing months aggregates all years? Or show Year-Month?
    // Let's simplify: 
    // If Year selected -> Show Months (Jan-Dec).
    // If All Years -> Show Years.
    
    const isYearly = selectedYear === 'all';
    const labels = isYearly 
        ? [...new Set(data.map(r => r._year))].sort() 
        : ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

    // Group Data
    // We want series based on 'groupBy' (e.g. User).
    // Datasets map: SeriesName -> { label: SeriesName, data: [val1, val2...] }
    
    const datasetsMap = new Map();
    
    data.forEach(r => {
        // Determine Series Key
        let key = 'Total';
        if (groupBy === 'user') key = r.user || 'Inconnu';
        if (groupBy === 'project') key = r.project || 'Inconnu';
        if (groupBy === 'chapter') key = r.chapter || 'Inconnu';
        
        // Initialize Dataset
        if (!datasetsMap.has(key)) {
            datasetsMap.set(key, new Array(labels.length).fill(0));
        }
        
        // Determine Index
        let index = -1;
        if (isYearly) {
            index = labels.indexOf(r._year);
        } else {
            index = r._month;
        }
        
        if (index !== -1) {
            datasetsMap.get(key)[index] += r._duration;
        }
    });

    // Create Datasets
    const datasets = Array.from(datasetsMap.entries()).map(([label, data], i) => ({
        label: label,
        data: data,
        backgroundColor: getColor(i),
        borderColor: getColor(i),
        borderWidth: 1
    }));

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Heures'
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.raw.toFixed(1) + ' h';
                        }
                    }
                }
            }
        }
    });
}

const colors = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', 
    '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#06b6d4'
];

function getColor(i) {
    return colors[i % colors.length];
}
