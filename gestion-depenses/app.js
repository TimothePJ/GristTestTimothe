document.addEventListener('DOMContentLoaded', () => {
    const projectSelect = document.getElementById('project-select');
    const addProjectBtn = document.getElementById('add-project-btn');
    const addProjectForm = document.getElementById('add-project-form');
    const projectNameInput = document.getElementById('project-name');
    const projectNumberInput = document.getElementById('project-number');
    const budgetLinesContainer = document.getElementById('budget-lines-container');
    const budgetChapterInput = document.getElementById('budget-chapter');
    const budgetAmountInput = document.getElementById('budget-amount');
    const addBudgetLineBtn = document.getElementById('add-budget-line-btn');
    const saveProjectBtn = document.getElementById('save-project-btn');
    const editBudgetBtn = document.getElementById('edit-budget-btn');
    const editBudgetModal = document.getElementById('edit-budget-modal');
    const editBudgetLinesContainer = document.getElementById('edit-budget-lines-container');
    const editBudgetChapterInput = document.getElementById('edit-budget-chapter');
    const editBudgetAmountInput = document.getElementById('edit-budget-amount');
    const addEditBudgetLineBtn = document.getElementById('add-edit-budget-line-btn');
    const saveEditedBudgetBtn = document.getElementById('save-edited-budget-btn');
    const cancelEditBudgetBtn = document.getElementById('cancel-edit-budget-btn');
    const currentProjectName = document.getElementById('current-project-name');
    const totalProjectBudget = document.getElementById('total-project-budget');
    const kpiTotalBudget = document.getElementById('kpi-total-budget');
    const kpiTotalSpending = document.getElementById('kpi-total-spending');
    const kpiRemainingBudget = document.getElementById('kpi-remaining-budget');
    const kpiRemainingPercentage = document.getElementById('kpi-remaining-percentage');
    const currentProjectBudgetBreakdown = document.getElementById('current-project-budget-breakdown');
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
    let newProjectBudgetLines = [];
    let editingBudgetLines = [];

    const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

    function formatNumber(num) {
        return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ").replace('.', ',');
    }

    async function loadGristData() {
        const projectsData = await grist.docApi.fetchTable("Projects");
        const budgetData = await grist.docApi.fetchTable("Budget");
        const teamData = await grist.docApi.fetchTable("Team");
        const timesheetData = await grist.docApi.fetchTable("Timesheet");

        const projects = projectsData.id.map((id, i) => ({
            id: id,
            projectNumber: projectsData.Project_Number[i],
            name: projectsData.Name[i],
            budgetLines: [],
            workers: []
        }));

        const projectsByNumber = {};
        projects.forEach(p => {
            projectsByNumber[p.projectNumber] = p;
        });

        for (let i = 0; i < budgetData.id.length; i++) {
            const projectNumber = budgetData.Project_Number[i];
            if (projectsByNumber[projectNumber]) {
                projectsByNumber[projectNumber].budgetLines.push({
                    id: budgetData.id[i],
                    chapter: budgetData.Chapter[i],
                    amount: budgetData.Amount[i]
                });
            }
        }

        const teamById = {};
        for (let i = 0; i < teamData.id.length; i++) {
            const projectNumber = teamData.Project_Number[i];
            if (projectsByNumber[projectNumber]) {
                const worker = {
                    id: teamData.id[i],
                    role: teamData.Role[i],
                    name: teamData.Name[i],
                    dailyExpanse: teamData.Daily_Rate[i],
                    provisionalDays: {},
                    workedDays: {}
                };
                projectsByNumber[projectNumber].workers.push(worker);
                teamById[worker.id] = worker;
            }
        }

        for (let i = 0; i < timesheetData.id.length; i++) {
            const teamMemberId = timesheetData.Team_Member[i];
            if (teamById[teamMemberId]) {
                const worker = teamById[teamMemberId];
                const month = timesheetData.Month[i];
                const provisionalDays = timesheetData.Provisional_Days[i];
                const workedDays = timesheetData.Worked_Days[i];

                // Grist returns dates as seconds since epoch
                const date = new Date(month * 1000);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

                if (provisionalDays) {
                    worker.provisionalDays[monthKey] = provisionalDays;
                }
                if (workedDays) {
                    worker.workedDays[monthKey] = workedDays;
                }
            }
        }

        data.projects = projects;
        if (data.projects.length > 0) {
            data.selectedProjectId = data.projects[0].id;
        }
        renderProjects();
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
            const totalBudget = selectedProject.budgetLines.reduce((sum, line) => sum + line.amount, 0);
            totalProjectBudget.textContent = `${formatNumber(totalBudget)} €`;
            currentProjectBudgetBreakdown.innerHTML = '';
            selectedProject.budgetLines.forEach(line => {
                const budgetLineEl = document.createElement('p');
                budgetLineEl.textContent = `${line.chapter}: ${formatNumber(line.amount)} €`;
                currentProjectBudgetBreakdown.appendChild(budgetLineEl);
            });
            renderTables(selectedProject);
            renderChart(selectedProject);
            renderKpiReport(selectedProject);
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
                row.innerHTML = `<td>${worker.name}</td><td><button class="delete-worker-btn" data-worker-id="${worker.id}">Supprimer</button></td><td>${totalProvisionalDays.toFixed(2)}</td>`;
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
        totalRow.innerHTML = `<td colspan="2"><strong>Total</strong></td><td><strong>${grandTotalProvisionalDays.toFixed(2)}</strong></td>`;
        for (let i = 0; i < monthSpan; i++) {
            const monthIndex = (data.selectedMonth + i) % 12;
            const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
            const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
            const totalDays = project.workers.reduce((sum, worker) => sum + (worker.provisionalDays[monthKey] || 0), 0);
            totalRow.innerHTML += `<td><strong>${totalDays.toFixed(2)}</strong></td>`;
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
                row.innerHTML = `<td>${worker.name}</td><td><input type="number" class="daily-expanse" data-worker-id="${worker.id}" value="${worker.dailyExpanse || ''}"></td><td>${formatNumber(totalProvisionalCost)} €</td>`;
                for (let i = 0; i < monthSpan; i++) {
                    const monthIndex = (data.selectedMonth + i) % 12;
                    const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
                    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
                    const provisionalCost = (worker.provisionalDays[monthKey] || 0) * worker.dailyExpanse;
                    row.innerHTML += `<td>${formatNumber(provisionalCost)} €</td>`;
                }
                expenseTableBody.appendChild(row);
            });
        }

        const totalRow = document.createElement('tr');
        const grandTotalProvisionalCost = project.workers.reduce((total, worker) => {
            const totalDays = Object.values(worker.provisionalDays).reduce((sum, days) => sum + (days || 0), 0);
            return total + (totalDays * (worker.dailyExpanse || 0));
        }, 0);
        totalRow.innerHTML = `<td colspan="2"><strong>Total</strong></td><td><strong>${formatNumber(grandTotalProvisionalCost)} €</strong></td>`;
        for (let i = 0; i < monthSpan; i++) {
            const monthIndex = (data.selectedMonth + i) % 12;
            const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
            const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
            const totalCost = calculateProvisionalSpending(project, monthKey);
            totalRow.innerHTML += `<td><strong>${formatNumber(totalCost)} €</strong></td>`;
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
                row.innerHTML = `<td>${worker.name}</td><td>${totalWorkedDays.toFixed(2)}</td><td>${formatNumber(totalRealCost)} €</td>`;
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
        totalRow.innerHTML = `<td><strong>Total</strong></td><td><strong>${grandTotalWorkedDays.toFixed(2)}</strong></td><td><strong>${formatNumber(grandTotalRealCost)} €</strong></td>`;
        for (let i = 0; i < monthSpan; i++) {
            const monthIndex = (data.selectedMonth + i) % 12;
            const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
            const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
            const totalCost = calculateRealSpending(project, monthKey);
            totalRow.innerHTML += `<td><strong>${formatNumber(totalCost)} €</strong></td>`;
        }
        realExpenseTableBody.appendChild(totalRow);
    }

    function renderChart(project) {
        const allMonthKeys = new Set();
        project.workers.forEach(worker => {
            Object.keys(worker.provisionalDays).forEach(key => allMonthKeys.add(key));
            Object.keys(worker.workedDays).forEach(key => allMonthKeys.add(key));
        });
        const sortedKeys = Array.from(allMonthKeys).sort();

        const cumulativeProvisionalMap = new Map();
        const cumulativeRealMap = new Map();

        if (sortedKeys.length > 0) {
            const [startYear, startMonth] = sortedKeys[0].split('-').map(Number);
            const [endYear, endMonth] = sortedKeys[sortedKeys.length - 1].split('-').map(Number);
            
            let runningProvisionalTotal = 0;
            let runningRealTotal = 0;
            
            let currentYear = startYear;
            let currentMonth = startMonth;

            while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
                const monthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
                
                runningProvisionalTotal += calculateProvisionalSpending(project, monthKey);
                runningRealTotal += calculateRealSpending(project, monthKey);
                
                cumulativeProvisionalMap.set(monthKey, runningProvisionalTotal);
                cumulativeRealMap.set(monthKey, runningRealTotal);

                currentMonth++;
                if (currentMonth > 12) {
                    currentMonth = 1;
                    currentYear++;
                }
            }
        }

        const monthSpan = data.monthSpan;
        const labels = [];
        const provisionalSpendingData = [];
        const realSpendingData = [];

        for (let i = 0; i < monthSpan; i++) {
            const monthIndex = (data.selectedMonth + i) % 12;
            const year = data.selectedYear + Math.floor((data.selectedMonth + i) / 12);
            const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
            
            labels.push([months[monthIndex], year.toString()]);

            let provisionalValue = 0;
            let realValue = 0;

            if (sortedKeys.length > 0) {
                const lastKey = sortedKeys[sortedKeys.length - 1];
                if (monthKey < sortedKeys[0]) {
                    provisionalValue = 0;
                    realValue = 0;
                } else if (monthKey > lastKey) {
                    provisionalValue = cumulativeProvisionalMap.get(lastKey);
                    realValue = cumulativeRealMap.get(lastKey);
                } else {
                    provisionalValue = cumulativeProvisionalMap.get(monthKey) || 0;
                    realValue = cumulativeRealMap.get(monthKey) || 0;
                }
            }

            provisionalSpendingData.push(provisionalValue);
            realSpendingData.push(realValue);
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
                        label: 'Dépenses prévisionnelles cumulées',
                        data: provisionalSpendingData,
                        borderColor: 'rgba(255, 99, 132, 1)',
                        borderWidth: 1,
                        fill: false
                    },
                    {
                        label: 'Dépenses réelles cumulées',
                        data: realSpendingData,
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

    addBudgetLineBtn.addEventListener('click', () => {
        const chapter = budgetChapterInput.value.trim();
        const amount = parseFloat(budgetAmountInput.value);
        if (chapter && !isNaN(amount)) {
            newProjectBudgetLines.push({ chapter, amount });
            budgetLinesContainer.innerHTML += `<p>${chapter}: ${formatNumber(amount)} €</p>`;
            budgetChapterInput.value = '';
            budgetAmountInput.value = '';
        }
    });

    saveProjectBtn.addEventListener('click', async () => {
        const name = projectNameInput.value.trim();
        const projectNumber = projectNumberInput.value.trim();
        if (name && projectNumber && newProjectBudgetLines.length > 0) {
            const projectActions = [
                ["AddRecord", "Projects", null, { Name: name, Project_Number: projectNumber }]
            ];
            await grist.docApi.applyUserActions(projectActions);

            // We need the ID of the newly created project.
            // A robust way would be to fetch projects again and find the one with the matching project number.
            // For simplicity, we'll just reload all data. A more optimized approach could be implemented.
            await loadGristData();

            const newProject = data.projects.find(p => p.projectNumber === projectNumber);
            if (newProject) {
                const budgetActions = newProjectBudgetLines.map(line =>
                    ["AddRecord", "Budget", null, { Project_Number: projectNumber, Chapter: line.chapter, Amount: line.amount }]
                );
                await grist.docApi.applyUserActions(budgetActions);
            }

            projectNameInput.value = '';
            newProjectBudgetLines = [];
            budgetLinesContainer.innerHTML = '';
            addProjectForm.style.display = 'none';
            loadGristData();
        }
    });

    projectSelect.addEventListener('change', () => {
        data.selectedProjectId = parseInt(projectSelect.value);
        renderSelectedProject();
    });

    yearSelect.addEventListener('change', () => {
        data.selectedYear = parseInt(yearSelect.value);
        renderSelectedProject();
    });

    prevMonthBtn.addEventListener('click', () => {
        data.selectedMonth--;
        if (data.selectedMonth < 0) {
            data.selectedMonth = 11;
            data.selectedYear--;
            yearSelect.value = data.selectedYear;
        }
        renderSelectedProject();
    });

    nextMonthBtn.addEventListener('click', () => {
        data.selectedMonth++;
        if (data.selectedMonth > 11) {
            data.selectedMonth = 0;
            data.selectedYear++;
            yearSelect.value = data.selectedYear;
        }
        renderSelectedProject();
    });

    monthSpanInput.addEventListener('change', () => {
        data.monthSpan = parseInt(monthSpanInput.value);
        renderSelectedProject();
    });

    addWorkerBtn.addEventListener('click', () => {
        addWorkerForm.style.display = addWorkerForm.style.display === 'none' ? 'block' : 'none';
    });

    saveWorkerBtn.addEventListener('click', async () => {
        const role = workerRoleInput.value.trim();
        const name = workerNameInput.value.trim();
        const selectedProject = data.projects.find(p => p.id === data.selectedProjectId);
        if (role && name && selectedProject) {
            const actions = [
                ["AddRecord", "Team", null, { Project_Number: selectedProject.id, Role: role, Name: name, Daily_Rate: 0 }]
            ];
            await grist.docApi.applyUserActions(actions);
            workerRoleInput.value = '';
            workerNameInput.value = '';
            addWorkerForm.style.display = 'none';
            loadGristData();
        }
    });

    async function handleTableInputChange(e) {
        const workerId = parseInt(e.target.dataset.workerId);
        const selectedProject = data.projects.find(p => p.id === data.selectedProjectId);
        if (!selectedProject) return;

        const worker = selectedProject.workers.find(w => w.id === workerId);
        if (!worker) return;

        if (e.target.classList.contains('daily-expanse')) {
            const dailyExpanse = parseFloat(e.target.value) || 0;
            worker.dailyExpanse = dailyExpanse;
            const actions = [
                ["UpdateRecord", "Team", worker.id, { Daily_Rate: dailyExpanse }]
            ];
            await grist.docApi.applyUserActions(actions);
        } else if (e.target.classList.contains('provisional-days') || e.target.classList.contains('worked-days')) {
            const month = e.target.dataset.month;
            const value = parseFloat(e.target.value) || 0;
            const isProvisional = e.target.classList.contains('provisional-days');

            if (isProvisional) {
                worker.provisionalDays[month] = value;
            } else {
                worker.workedDays[month] = value;
            }

            const [year, monthNum] = month.split('-').map(Number);
            const date = new Date(year, monthNum - 1);
            const gristDate = date.getTime() / 1000;

            // Find if a timesheet record already exists for this worker and month
            const timesheetData = await grist.docApi.fetchTable("Timesheet");
            let recordId = null;
            for (let i = 0; i < timesheetData.id.length; i++) {
                if (timesheetData.Team_Member[i] === worker.id && new Date(timesheetData.Month[i] * 1000).getTime() === date.getTime()) {
                    recordId = timesheetData.id[i];
                    break;
                }
            }

            const fields = {};
            if (isProvisional) {
                fields.Provisional_Days = value;
            } else {
                fields.Worked_Days = value;
            }

            let action;
            if (recordId) {
                action = ["UpdateRecord", "Timesheet", recordId, fields];
            } else {
                fields.Team_Member = worker.id;
                fields.Month = gristDate;
                action = ["AddRecord", "Timesheet", null, fields];
            }
            await grist.docApi.applyUserActions([action]);
        }

        renderTables(selectedProject);
        renderChart(selectedProject);
        renderKpiReport(selectedProject);
    }
    
    async function handleDeleteWorker(e) {
        if (!e.target.classList.contains('delete-worker-btn')) return;
        
        const workerId = parseInt(e.target.dataset.workerId);
        const selectedProject = data.projects.find(p => p.id === data.selectedProjectId);
        if (!selectedProject) return;

        const actions = [
            ["RemoveRecord", "Team", workerId]
        ];
        await grist.docApi.applyUserActions(actions);
        loadGristData();
    }

    chargePlanTableBody.addEventListener('change', handleTableInputChange);
    expenseTableBody.addEventListener('change', handleTableInputChange);
    realExpenseTableBody.addEventListener('change', handleTableInputChange);
    
    chargePlanTableBody.addEventListener('click', handleDeleteWorker);


    function renderKpiReport(project) {
        const totalBudget = project.budgetLines.reduce((sum, line) => sum + line.amount, 0);
        const totalProvisionalSpending = project.workers.reduce((total, worker) => {
            const totalDays = Object.values(worker.provisionalDays).reduce((sum, days) => sum + (days || 0), 0);
            return total + (totalDays * (worker.dailyExpanse || 0));
        }, 0);
        const totalSpending = project.workers.reduce((total, worker) => {
            const totalDays = Object.values(worker.workedDays).reduce((sum, days) => sum + (days || 0), 0);
            return total + (totalDays * (worker.dailyExpanse || 0));
        }, 0);
        const remainingBudget = totalBudget - totalSpending;
        const remainingPercentage = totalBudget > 0 ? (remainingBudget / totalBudget) * 100 : 0;

        kpiTotalBudget.textContent = `${formatNumber(totalBudget)} € (Assigné : ${formatNumber(totalProvisionalSpending)} €)`;
        kpiTotalSpending.textContent = `${formatNumber(totalSpending)} €`;
        kpiRemainingBudget.textContent = `${formatNumber(remainingBudget)} €`;
        kpiRemainingPercentage.textContent = `${remainingPercentage.toFixed(2).replace('.', ',')} %`;
    }

    editBudgetBtn.addEventListener('click', () => {
        const selectedProject = data.projects.find(p => p.id === data.selectedProjectId);
        if (selectedProject) {
            editingBudgetLines = JSON.parse(JSON.stringify(selectedProject.budgetLines));
            renderEditBudgetLines();
            editBudgetModal.style.display = 'block';
        }
    });

    function renderEditBudgetLines() {
        editBudgetLinesContainer.innerHTML = '';
        editingBudgetLines.forEach((line, index) => {
            const lineEl = document.createElement('div');
            lineEl.innerHTML = `
                <span>${line.chapter}: ${formatNumber(line.amount)} €</span>
                <button class="delete-budget-line-btn" data-index="${index}">Supprimer</button>
            `;
            editBudgetLinesContainer.appendChild(lineEl);
        });
    }

    editBudgetLinesContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-budget-line-btn')) {
            const index = parseInt(e.target.dataset.index);
            editingBudgetLines.splice(index, 1);
            renderEditBudgetLines();
        }
    });

    addEditBudgetLineBtn.addEventListener('click', () => {
        const chapter = editBudgetChapterInput.value.trim();
        const amount = parseFloat(editBudgetAmountInput.value);
        if (chapter && !isNaN(amount)) {
            editingBudgetLines.push({ chapter, amount });
            renderEditBudgetLines();
            editBudgetChapterInput.value = '';
            editBudgetAmountInput.value = '';
        }
    });

    saveEditedBudgetBtn.addEventListener('click', async () => {
        const selectedProject = data.projects.find(p => p.id === data.selectedProjectId);
        if (selectedProject) {
            const originalLines = selectedProject.budgetLines;
            const editedLines = editingBudgetLines;

            const originalIds = new Set(originalLines.map(l => l.id));
            const editedIds = new Set(editedLines.map(l => l.id).filter(id => id));

            const toDelete = originalLines.filter(l => !editedIds.has(l.id));
            const toAdd = editedLines.filter(l => !l.id);
            const toUpdate = editedLines.filter(l => l.id && originalIds.has(l.id));

            const actions = [];
            toDelete.forEach(line => actions.push(["RemoveRecord", "Budget", line.id]));
            toAdd.forEach(line => actions.push(["AddRecord", "Budget", null, { Project_Number: selectedProject.projectNumber, Chapter: line.chapter, Amount: line.amount }]));
            toUpdate.forEach(line => {
                const original = originalLines.find(l => l.id === line.id);
                if (original.chapter !== line.chapter || original.amount !== line.amount) {
                    actions.push(["UpdateRecord", "Budget", line.id, { Chapter: line.chapter, Amount: line.amount }]);
                }
            });

            if (actions.length > 0) {
                await grist.docApi.applyUserActions(actions);
            }

            editBudgetModal.style.display = 'none';
            loadGristData();
        }
    });

    cancelEditBudgetBtn.addEventListener('click', () => {
        editBudgetModal.style.display = 'none';
    });


    document.querySelectorAll('.prev-month-table-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            data.selectedMonth--;
            if (data.selectedMonth < 0) {
                data.selectedMonth = 11;
                data.selectedYear--;
                yearSelect.value = data.selectedYear;
            }
            renderSelectedProject();
        });
    });

    document.querySelectorAll('.next-month-table-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            data.selectedMonth++;
            if (data.selectedMonth > 11) {
                data.selectedMonth = 0;
                data.selectedYear++;
                yearSelect.value = data.selectedYear;
            }
            renderSelectedProject();
        });
    });


    grist.ready();
    monthSpanInput.value = data.monthSpan;
    initializeYears();
    loadGristData();
});
