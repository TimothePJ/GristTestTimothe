document.addEventListener('DOMContentLoaded', () => {
    const projectSelect = document.getElementById('project-select');
    const addProjectBtn = document.getElementById('add-project-btn');
    const addProjectForm = document.getElementById('add-project-form');
    const projectNameInput = document.getElementById('project-name');
    const projectBudgetInput = document.getElementById('project-budget');
    const saveProjectBtn = document.getElementById('save-project-btn');
    const currentProjectName = document.getElementById('current-project-name');
    const currentProjectBudget = document.getElementById('current-project-budget');
    const yearSelect = document.getElementById('year-select');
    const prevMonthBtn = document.getElementById('prev-month-btn');
    const nextMonthBtn = document.getElementById('next-month-btn');
    const currentMonthYear = document.getElementById('current-month-year');
    const monthSpanInput = document.getElementById('month-span-input');

    const chargePlanTableBody = document.querySelector('#charge-plan-table tbody');
    const expenseTableBody = document.querySelector('#expense-table tbody');
    const realExpenseTableBody = document.querySelector('#real-expense-table tbody');

    const addWorkerBtn = document.getElementById('add-worker-btn');
    const addWorkerForm = document.getElementById('add-worker-form');
    const workerRoleInput = document.getElementById('worker-role');
    const workerNameInput = document.getElementById('worker-name');
    const saveWorkerBtn = document.getElementById('save-worker-btn');
    const spendingChartCanvas = document.getElementById('spending-chart');

    let data = {
        projects: [],
        selectedProjectId: null,
        selectedYear: new Date().getFullYear(),
        selectedMonth: new Date().getMonth(),
        monthSpan: 3
    };

    let spendingChart;

    const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

    function saveData() {
        localStorage.setItem('projectExpenses', JSON.stringify(data));
    }

    function loadData() {
        const savedData = localStorage.getItem('projectExpenses');
        if (savedData) {
            data = JSON.parse(savedData);
            if (typeof data.selectedMonth !== 'number') {
                data.selectedMonth = new Date().getMonth();
            }
            if (typeof data.monthSpan !== 'number') {
                data.monthSpan = 3;
            }
        }
    }

    function initializeYears() {
        const currentYear = new Date().getFullYear();
        for (let i = currentYear - 5; i <= currentYear + 5; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            yearSelect.appendChild(option);
        }
        yearSelect.value = data.selectedYear;
    }

    function renderProjects() {
        projectSelect.innerHTML = '';
        data.projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = project.name;
            projectSelect.appendChild(option);
        });

        if (data.selectedProjectId) {
            projectSelect.value = data.selectedProjectId;
        }
        renderSelectedProject();
    }

    function renderSelectedProject() {
        updateCurrentMonthYear();
        const selectedProject = data.projects.find(p => p.id === data.selectedProjectId);
        if (selectedProject) {
            currentProjectName.textContent = selectedProject.name;
            currentProjectBudget.textContent = selectedProject.budget;
            renderTables(selectedProject);
            renderChart(selectedProject);
        } else {
            chargePlanTableBody.innerHTML = '';
            expenseTableBody.innerHTML = '';
            realExpenseTableBody.innerHTML = '';
            if(spendingChart) spendingChart.destroy();
        }
    }

    function groupWorkersByRole(workers) {
        return workers.reduce((acc, worker) => {
            (acc[worker.role] = acc[worker.role] || []).push(worker);
            return acc;
        }, {});
    }

    function renderTables(project) {
        const groupedWorkers = groupWorkersByRole(project.workers);
        renderChargePlanTable(project, groupedWorkers);
        renderExpenseTable(project, groupedWorkers);
        renderRealExpenseTable(project, groupedWorkers);
    }

    function renderChargePlanTable(project, groupedWorkers) {
        const headRow = document.querySelector('#charge-plan-table thead tr');
        headRow.innerHTML = '<th>Nom</th><th>Actions</th><th>Total Jours</th>';
        const monthSpan = data.monthSpan;

        for (let i = 0; i < monthSpan; i++) {
            const monthIndex = (data.selectedMonth + i) % 12;
            const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
            const th = document.createElement('th');
            th.innerHTML = `${months[monthIndex]}<br>${year}`;
            headRow.appendChild(th);
        }

        chargePlanTableBody.innerHTML = '';
        for (const role in groupedWorkers) {
            const roleRow = document.createElement('tr');
            roleRow.classList.add('role-row');
            roleRow.innerHTML = `<td colspan="${3 + monthSpan}"><strong>${role}</strong></td>`;
            chargePlanTableBody.appendChild(roleRow);

            groupedWorkers[role].forEach(worker => {
                const totalProvisionalDays = Object.values(worker.provisionalDays).reduce((sum, days) => sum + (days || 0), 0);
                const row = document.createElement('tr');
                row.innerHTML = `<td>${worker.name}</td><td><button class="delete-worker-btn" data-worker-id="${worker.id}">Supprimer</button></td><td>${totalProvisionalDays}</td>`;
                for (let i = 0; i < monthSpan; i++) {
                    const monthIndex = (data.selectedMonth + i) % 12;
                    const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
                    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
                    row.innerHTML += `<td><input type="number" class="provisional-days" data-worker-id="${worker.id}" data-month="${monthKey}" value="${worker.provisionalDays[monthKey] || ''}"></td>`;
                }
                chargePlanTableBody.appendChild(row);
            });
        }

        const totalRow = document.createElement('tr');
        const grandTotalProvisionalDays = project.workers.reduce((total, worker) => {
            return total + Object.values(worker.provisionalDays).reduce((sum, days) => sum + (days || 0), 0);
        }, 0);
        totalRow.innerHTML = `<td colspan="2"><strong>Total</strong></td><td><strong>${grandTotalProvisionalDays}</strong></td>`;
        for (let i = 0; i < monthSpan; i++) {
            const monthIndex = (data.selectedMonth + i) % 12;
            const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
            const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
            const totalDays = project.workers.reduce((sum, worker) => sum + (worker.provisionalDays[monthKey] || 0), 0);
            totalRow.innerHTML += `<td><strong>${totalDays}</strong></td>`;
        }
        chargePlanTableBody.appendChild(totalRow);
    }

    function renderExpenseTable(project, groupedWorkers) {
        const headRow = document.querySelector('#expense-table thead tr');
        headRow.innerHTML = '<th>Nom</th><th>Dépense journalière</th><th>Total Dépense</th>';
        const monthSpan = data.monthSpan;

        for (let i = 0; i < monthSpan; i++) {
            const monthIndex = (data.selectedMonth + i) % 12;
            const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
            const th = document.createElement('th');
            th.innerHTML = `${months[monthIndex]}<br>${year}`;
            headRow.appendChild(th);
        }

        expenseTableBody.innerHTML = '';
        for (const role in groupedWorkers) {
            const roleRow = document.createElement('tr');
            roleRow.classList.add('role-row');
            roleRow.innerHTML = `<td colspan="${3 + monthSpan}"><strong>${role}</strong></td>`;
            expenseTableBody.appendChild(roleRow);

            groupedWorkers[role].forEach(worker => {
                const totalProvisionalDays = Object.values(worker.provisionalDays).reduce((sum, days) => sum + (days || 0), 0);
                const totalProvisionalCost = totalProvisionalDays * (worker.dailyExpanse || 0);
                const row = document.createElement('tr');
                row.innerHTML = `<td>${worker.name}</td><td><input type="number" class="daily-expanse" data-worker-id="${worker.id}" value="${worker.dailyExpanse || ''}"></td><td>${totalProvisionalCost.toFixed(2)} €</td>`;
                for (let i = 0; i < monthSpan; i++) {
                    const monthIndex = (data.selectedMonth + i) % 12;
                    const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
                    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
                    const provisionalCost = (worker.provisionalDays[monthKey] || 0) * worker.dailyExpanse;
                    row.innerHTML += `<td>${provisionalCost.toFixed(2)} €</td>`;
                }
                expenseTableBody.appendChild(row);
            });
        }

        const totalRow = document.createElement('tr');
        const grandTotalProvisionalCost = project.workers.reduce((total, worker) => {
            const totalDays = Object.values(worker.provisionalDays).reduce((sum, days) => sum + (days || 0), 0);
            return total + (totalDays * (worker.dailyExpanse || 0));
        }, 0);
        totalRow.innerHTML = `<td colspan="2"><strong>Total</strong></td><td><strong>${grandTotalProvisionalCost.toFixed(2)} €</strong></td>`;
        for (let i = 0; i < monthSpan; i++) {
            const monthIndex = (data.selectedMonth + i) % 12;
            const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
            const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
            const totalCost = calculateProvisionalSpending(project, monthKey);
            totalRow.innerHTML += `<td><strong>${totalCost.toFixed(2)} €</strong></td>`;
        }
        expenseTableBody.appendChild(totalRow);
    }

    function renderRealExpenseTable(project, groupedWorkers) {
        const headRow = document.querySelector('#real-expense-table thead tr');
        headRow.innerHTML = '<th>Nom</th><th>Total Jours</th><th>Total Dépense</th>';
        const monthSpan = data.monthSpan;

        for (let i = 0; i < monthSpan; i++) {
            const monthIndex = (data.selectedMonth + i) % 12;
            const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
            const th = document.createElement('th');
            th.innerHTML = `${months[monthIndex]}<br>${year}`;
            headRow.appendChild(th);
        }

        realExpenseTableBody.innerHTML = '';
        for (const role in groupedWorkers) {
            const roleRow = document.createElement('tr');
            roleRow.classList.add('role-row');
            roleRow.innerHTML = `<td colspan="${3 + monthSpan}"><strong>${role}</strong></td>`;
            realExpenseTableBody.appendChild(roleRow);

            groupedWorkers[role].forEach(worker => {
                const totalWorkedDays = Object.values(worker.workedDays).reduce((sum, days) => sum + (days || 0), 0);
                const totalRealCost = totalWorkedDays * (worker.dailyExpanse || 0);
                const row = document.createElement('tr');
                row.innerHTML = `<td>${worker.name}</td><td>${totalWorkedDays}</td><td>${totalRealCost.toFixed(2)} €</td>`;
                for (let i = 0; i < monthSpan; i++) {
                    const monthIndex = (data.selectedMonth + i) % 12;
                    const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
                    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
                    row.innerHTML += `<td><input type="number" class="worked-days" data-worker-id="${worker.id}" data-month="${monthKey}" value="${worker.workedDays[monthKey] || ''}"></td>`;
                }
                realExpenseTableBody.appendChild(row);
            });
        }

        const totalRow = document.createElement('tr');
        const grandTotalWorkedDays = project.workers.reduce((total, worker) => {
            return total + Object.values(worker.workedDays).reduce((sum, days) => sum + (days || 0), 0);
        }, 0);
        const grandTotalRealCost = project.workers.reduce((total, worker) => {
            const totalDays = Object.values(worker.workedDays).reduce((sum, days) => sum + (days || 0), 0);
            return total + (totalDays * (worker.dailyExpanse || 0));
        }, 0);
        totalRow.innerHTML = `<td><strong>Total</strong></td><td><strong>${grandTotalWorkedDays}</strong></td><td><strong>${grandTotalRealCost.toFixed(2)} €</strong></td>`;
        for (let i = 0; i < monthSpan; i++) {
            const monthIndex = (data.selectedMonth + i) % 12;
            const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
            const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
            const totalCost = calculateRealSpending(project, monthKey);
            totalRow.innerHTML += `<td><strong>${totalCost.toFixed(2)} €</strong></td>`;
        }
        realExpenseTableBody.appendChild(totalRow);
    }

    function renderChart(project) {
        const monthSpan = data.monthSpan;
        const labels = [];
        const provisionalSpending = [];
        const realSpending = [];

        for (let i = 0; i < monthSpan; i++) {
            const monthIndex = (data.selectedMonth + i) % 12;
            const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
            const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
            
            labels.push([months[monthIndex], year.toString()]);
            provisionalSpending.push(calculateProvisionalSpending(project, monthKey));
            realSpending.push(calculateRealSpending(project, monthKey));
        }

        if (spendingChart) {
            spendingChart.destroy();
        }

        spendingChart = new Chart(spendingChartCanvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Dépenses prévisionnelles',
                        data: provisionalSpending,
                        borderColor: 'rgba(255, 99, 132, 1)',
                        borderWidth: 1,
                        fill: false
                    },
                    {
                        label: 'Dépenses réelles',
                        data: realSpending,
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1,
                        fill: false
                    }
                ]
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    function calculateProvisionalSpending(project, month) {
        return project.workers.reduce((total, worker) => {
            return total + (worker.provisionalDays[month] || 0) * worker.dailyExpanse;
        }, 0);
    }

    function calculateRealSpending(project, month) {
        return project.workers.reduce((total, worker) => {
            return total + (worker.workedDays[month] || 0) * worker.dailyExpanse;
        }, 0);
    }

    function updateCurrentMonthYear() {
        currentMonthYear.innerHTML = `${months[data.selectedMonth]}<br>${data.selectedYear}`;
    }

    addProjectBtn.addEventListener('click', () => {
        addProjectForm.style.display = addProjectForm.style.display === 'none' ? 'block' : 'none';
    });

    saveProjectBtn.addEventListener('click', () => {
        const name = projectNameInput.value.trim();
        const budget = parseFloat(projectBudgetInput.value);
        if (name && !isNaN(budget)) {
            const newProject = {
                id: Date.now(),
                name,
                budget,
                workers: []
            };
            data.projects.push(newProject);
            data.selectedProjectId = newProject.id;
            saveData();
            renderProjects();
            projectNameInput.value = '';
            projectBudgetInput.value = '';
            addProjectForm.style.display = 'none';
        }
    });

    projectSelect.addEventListener('change', () => {
        data.selectedProjectId = parseInt(projectSelect.value);
        saveData();
        renderSelectedProject();
    });

    yearSelect.addEventListener('change', () => {
        data.selectedYear = parseInt(yearSelect.value);
        saveData();
        renderSelectedProject();
    });

    prevMonthBtn.addEventListener('click', () => {
        data.selectedMonth--;
        if (data.selectedMonth < 0) {
            data.selectedMonth = 11;
            data.selectedYear--;
            yearSelect.value = data.selectedYear;
        }
        saveData();
        renderSelectedProject();
    });

    nextMonthBtn.addEventListener('click', () => {
        data.selectedMonth++;
        if (data.selectedMonth > 11) {
            data.selectedMonth = 0;
            data.selectedYear++;
            yearSelect.value = data.selectedYear;
        }
        saveData();
        renderSelectedProject();
    });

    monthSpanInput.addEventListener('change', () => {
        data.monthSpan = parseInt(monthSpanInput.value);
        saveData();
        renderSelectedProject();
    });

    addWorkerBtn.addEventListener('click', () => {
        addWorkerForm.style.display = addWorkerForm.style.display === 'none' ? 'block' : 'none';
    });

    saveWorkerBtn.addEventListener('click', () => {
        const role = workerRoleInput.value.trim();
        const name = workerNameInput.value.trim();
        const selectedProject = data.projects.find(p => p.id === data.selectedProjectId);
        if (role && name && selectedProject) {
            const newWorker = {
                id: Date.now(),
                role,
                name,
                provisionalDays: {},
                dailyExpanse: 0,
                workedDays: {}
            };
            selectedProject.workers.push(newWorker);
            saveData();
            renderSelectedProject();
            workerRoleInput.value = '';
            workerNameInput.value = '';
            addWorkerForm.style.display = 'none';
        }
    });

    function handleTableInputChange(e) {
        const workerId = parseInt(e.target.dataset.workerId);
        const selectedProject = data.projects.find(p => p.id === data.selectedProjectId);
        if (!selectedProject) return;

        const worker = selectedProject.workers.find(w => w.id === workerId);
        if (!worker) return;

        if (e.target.classList.contains('provisional-days')) {
            const month = e.target.dataset.month;
            worker.provisionalDays[month] = parseFloat(e.target.value) || 0;
        } else if (e.target.classList.contains('daily-expanse')) {
            worker.dailyExpanse = parseFloat(e.target.value) || 0;
        } else if (e.target.classList.contains('worked-days')) {
            const month = e.target.dataset.month;
            worker.workedDays[month] = parseFloat(e.target.value) || 0;
        }

        saveData();
        renderTables(selectedProject);
        renderChart(selectedProject);
    }
    
    function handleDeleteWorker(e) {
        if (!e.target.classList.contains('delete-worker-btn')) return;
        
        const workerId = parseInt(e.target.dataset.workerId);
        const selectedProject = data.projects.find(p => p.id === data.selectedProjectId);
        if (!selectedProject) return;

        selectedProject.workers = selectedProject.workers.filter(w => w.id !== workerId);
        saveData();
        renderSelectedProject();
    }

    chargePlanTableBody.addEventListener('change', handleTableInputChange);
    expenseTableBody.addEventListener('change', handleTableInputChange);
    realExpenseTableBody.addEventListener('change', handleTableInputChange);
    
    chargePlanTableBody.addEventListener('click', handleDeleteWorker);


    loadData();
    monthSpanInput.value = data.monthSpan;
    initializeYears();
    renderProjects();
});
