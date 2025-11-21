document.addEventListener('DOMContentLoaded', () => {
    const steps = document.querySelectorAll('.wizard-step');
    let currentStep = 1;
    let teamMembers = [];
    let projectData = {
        name: '',
        number: '',
        budgetLines: [],
        team: []
    };

    function showStep(stepNumber) {
        steps.forEach(step => step.style.display = 'none');
        const stepToShow = document.getElementById(`step-${stepNumber}`);
        if (stepToShow) {
            stepToShow.style.display = 'block';
            currentStep = stepNumber;
        }
    }

    // Navigation
    document.getElementById('next-to-step-2').addEventListener('click', () => {
        projectData.name = document.getElementById('project-name').value;
        projectData.number = document.getElementById('project-number').value;
        if (projectData.name && projectData.number) {
            showStep(2);
        } else {
            alert('Veuillez remplir le nom et le numéro du projet.');
        }
    });

    document.getElementById('prev-to-step-1').addEventListener('click', () => showStep(1));
    document.getElementById('next-to-step-3').addEventListener('click', () => showStep(3));
    document.getElementById('prev-to-step-2').addEventListener('click', () => showStep(2));
    document.getElementById('next-to-step-4').addEventListener('click', () => {
        const selectedTeamMembers = [];
        document.querySelectorAll('#team-selection-container input[type="checkbox"]:checked').forEach(checkbox => {
            selectedTeamMembers.push(parseInt(checkbox.value, 10));
        });
        projectData.team = selectedTeamMembers;
        renderReview();
        showStep(4);
    });
    document.getElementById('prev-to-step-3').addEventListener('click', () => showStep(3));

    // Budget Lines
    const addBudgetLineBtn = document.getElementById('add-budget-line-btn');
    const budgetLinesContainer = document.getElementById('budget-lines-container');
    const budgetChapterInput = document.getElementById('budget-chapter');
    const budgetAmountInput = document.getElementById('budget-amount');

    addBudgetLineBtn.addEventListener('click', () => {
        const chapter = budgetChapterInput.value.trim();
        const amount = parseFloat(budgetAmountInput.value);
        if (chapter && !isNaN(amount)) {
            projectData.budgetLines.push({ chapter, amount });
            renderBudgetLines();
            budgetChapterInput.value = '';
            budgetAmountInput.value = '';
        }
    });

    function renderBudgetLines() {
        budgetLinesContainer.innerHTML = '';
        projectData.budgetLines.forEach((line, index) => {
            const lineEl = document.createElement('p');
            lineEl.textContent = `${line.chapter}: ${line.amount.toFixed(2)} €`;
            budgetLinesContainer.appendChild(lineEl);
        });
    }

    // Team Selection
    async function populateTeamSelection() {
        const teamData = await grist.docApi.fetchTable("Team");
        teamMembers = teamData.id.map((id, index) => ({
            id: id,
            Prenom: teamData.Prenom[index],
            Nom: teamData.Nom[index],
            Role: teamData.Role[index]
        }));

        const groupedByRole = teamMembers.reduce((acc, member) => {
            const role = member.Role || 'Non assigné';
            if (!acc[role]) {
                acc[role] = [];
            }
            acc[role].push(member);
            return acc;
        }, {});

        const teamSelectionContainer = document.getElementById('team-selection-container');
        teamSelectionContainer.innerHTML = '';

        for (const role in groupedByRole) {
            const roleTitle = document.createElement('h3');
            roleTitle.textContent = role;
            teamSelectionContainer.appendChild(roleTitle);

            const roleContainer = document.createElement('div');
            roleContainer.classList.add('role-group');
            groupedByRole[role].forEach(member => {
                const label = document.createElement('label');
                label.classList.add('team-member');
                label.innerHTML = `<input type="checkbox" value="${member.id}"> ${member.Prenom} ${member.Nom}`;
                roleContainer.appendChild(label);
            });
            teamSelectionContainer.appendChild(roleContainer);
        }
    }

    // Review
    function renderReview() {
        const reviewContainer = document.getElementById('review-container');
        let budgetLinesHtml = projectData.budgetLines.map(line => `<p>${line.chapter}: ${line.amount.toFixed(2)} €</p>`).join('');
        
        const selectedTeamMembers = teamMembers.filter(member => projectData.team.includes(member.id));
        
        const groupedByRole = selectedTeamMembers.reduce((acc, member) => {
            const role = member.Role || 'Non assigné';
            if (!acc[role]) {
                acc[role] = [];
            }
            acc[role].push(member);
            return acc;
        }, {});

        let teamHtml = '';
        for (const role in groupedByRole) {
            teamHtml += `<h4>${role}</h4><ul>`;
            groupedByRole[role].forEach(member => {
                teamHtml += `<li>${member.Prenom} ${member.Nom}</li>`;
            });
            teamHtml += '</ul>';
        }

        reviewContainer.innerHTML = `
            <h3>Détails du Projet</h3>
            <p><strong>Nom:</strong> ${projectData.name}</p>
            <p><strong>Numéro:</strong> ${projectData.number}</p>
            <h3>Lignes Budgétaires</h3>
            ${budgetLinesHtml}
            <h3>Équipe</h3>
            ${teamHtml}
        `;
    }

    // Final Save
    document.getElementById('create-project-btn').addEventListener('click', async () => {
        try {
            // 1. Create Project
            const projectActions = [
                ["AddRecord", "Projet", null, { Projet: projectData.name, NumeroProjet: projectData.number }]
            ];
            await grist.docApi.applyUserActions(projectActions);

            // 2. Add Budget Lines
            const budgetActions = projectData.budgetLines.map(line =>
                ["AddRecord", "Budget", null, { NumeroProjet: projectData.number, Chapter: line.chapter, Amount: line.amount }]
            );
            if (budgetActions.length > 0) {
                await grist.docApi.applyUserActions(budgetActions);
            }

            // 3. Add Team Members
            const selectedTeamMembers = teamMembers.filter(member => projectData.team.includes(member.id));
            const teamActions = selectedTeamMembers.map(member => {
                const name = `${member.Prenom} ${member.Nom}`;
                const role = member.Role;
                return ["AddRecord", "ProjectTeam", null, { NumeroProjet: projectData.number, Role: role, Name: name, Daily_Rate: 0 }];
            });
            if (teamActions.length > 0) {
                await grist.docApi.applyUserActions(teamActions);
            }

            alert('Projet créé avec succès !');
            // Optionally, redirect or clear the form
            window.location.reload();
        } catch (error) {
            console.error('Error creating project:', error);
            alert('Erreur lors de la création du projet.');
        }
    });

    grist.ready();
    populateTeamSelection();
    showStep(1);
});
