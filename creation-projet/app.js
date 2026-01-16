document.addEventListener('DOMContentLoaded', () => {
    const steps = document.querySelectorAll('.wizard-step');
    let currentStep = 1;
    let teamMembers = [];
    let projectData = {
        name: '',
        number: '',
        budgetLines: [],
        team: [],
        documents: [],
        emitters: []
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

    const projectNameInput = document.getElementById('project-name');
    const projectNumberInput = document.getElementById('project-number');

    if (projectNameInput && projectNumberInput) {
        projectNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
            e.preventDefault();
            projectNumberInput.focus();
            projectNumberInput.select();
            }
        });
    }

    document.getElementById('prev-to-step-1').addEventListener('click', () => showStep(1));
    document.getElementById('next-to-step-3').addEventListener('click', () => {
        const chapter = budgetChapterInput.value.trim();
        const amount = parseFloat(budgetAmountInput.value);

        if (chapter && !isNaN(amount)) {
            projectData.budgetLines.push({ chapter, amount });
            renderBudgetLines();
            budgetChapterInput.value = '';
            budgetAmountInput.value = '';
        }

        showStep(3);
    });

    document.getElementById('prev-to-step-2').addEventListener('click', () => showStep(2));
    document.getElementById('next-to-step-4').addEventListener('click', () => {
        const selectedTeamMembers = [];
        document.querySelectorAll('#team-selection-container input[type="checkbox"]:checked').forEach(checkbox => {
            selectedTeamMembers.push(parseInt(checkbox.value, 10));
        });
        projectData.team = selectedTeamMembers;

        // On va à la NOUVELLE étape 4 (pas de review ici)
        showStep(4);
    });

    // Le bouton prev-to-step-3 est maintenant dans la NOUVELLE étape 4
    document.getElementById('prev-to-step-3').addEventListener('click', () => showStep(3));

    document.getElementById('next-to-step-5').addEventListener('click', () => {
    projectData.documents = Array.from(document.querySelectorAll('input[name="project-docs"]:checked'))
        .map(i => i.value);

    projectData.emitters = Array.from(document.querySelectorAll('input[name="project-emitters"]:checked'))
        .map(i => i.value);

    if (projectData.documents.length === 0) {
        alert("Sélectionne au moins 1 document (RDC, R+1, ...).");
        return;
    }
    if (projectData.emitters.length === 0) {
        alert("Sélectionne au moins 1 émetteur.");
        return;
    }

    renderReview();
    showStep(5);
    });

    document.getElementById('prev-to-step-4').addEventListener('click', () => showStep(4));

    // Budget Lines
    const addBudgetLineBtn = document.getElementById('add-budget-line-btn');
    const budgetLinesContainer = document.getElementById('budget-lines-container');
    const budgetChapterInput = document.getElementById('budget-chapter');
    const budgetAmountInput = document.getElementById('budget-amount');

    if (budgetChapterInput && budgetAmountInput) {
        budgetChapterInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                budgetAmountInput.focus();
                budgetAmountInput.select();
            }
        });
    }

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
            const row = document.createElement('div');
            row.className = 'budget-line';

            const text = document.createElement('span');
            text.className = 'budget-line-text';
            text.textContent = `${line.chapter}: ${line.amount.toFixed(2)} €`;

            const del = document.createElement('button');
            del.className = 'budget-line-delete';
            del.type = 'button';
            del.title = 'Supprimer cette ligne';
            del.textContent = '✖';

            del.addEventListener('click', () => {
            projectData.budgetLines.splice(index, 1);
            renderBudgetLines();
            });

            row.appendChild(text);
            row.appendChild(del);
            budgetLinesContainer.appendChild(row);
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

    async function getTeamService() {
        try {
            const teamTable = await grist.docApi.fetchTable('Team');

            // Cas 1: Grist renvoie un tableau d'objets
            if (Array.isArray(teamTable) && teamTable.length > 0) {
            return teamTable[0].Service || "";
            }

            // Cas 2: Grist renvoie un objet de colonnes
            if (teamTable && Array.isArray(teamTable.Service) && teamTable.Service.length > 0) {
            return teamTable.Service[0] || "";
            }

            return "";
        } catch (error) {
            console.error("Erreur récupération service depuis Team:", error);
            return "";
        }
    }


    function renderReview() {
        const reviewContainer = document.getElementById('review-container');

        const docsHtml = (projectData.documents && projectData.documents.length)
            ? projectData.documents.join(', ')
            : '-';

        const emittersHtml = (projectData.emitters && projectData.emitters.length)
            ? projectData.emitters.join(', ')
            : '-';

        // Budget
        const budgetLinesHtml = (projectData.budgetLines || [])
            .map(line => `<p>${line.chapter}: ${Number(line.amount).toFixed(2)} €</p>`)
            .join('');

        // Team
        const selectedTeamMembers = (teamMembers || []).filter(member =>
            (projectData.team || []).includes(member.id)
        );

        const groupedByRole = selectedTeamMembers.reduce((acc, member) => {
            const role = member.Role || 'Non assigné';
            if (!acc[role]) acc[role] = [];
            acc[role].push(member);
            return acc;
        }, {});

        let teamHtml = '';
        for (const role in groupedByRole) {
            teamHtml += `<h4>${role}</h4><ul>`;
            groupedByRole[role].forEach(member => {
            teamHtml += `<li>${member.Prenom} ${member.Nom}</li>`;
            });
            teamHtml += `</ul>`;
        }

        reviewContainer.innerHTML = `
            <h3>Détails du Projet</h3>
            <p><strong>Nom:</strong> ${projectData.name}</p>
            <p><strong>Numéro:</strong> ${projectData.number}</p>

            <h3>Lignes Budgétaires</h3>
            ${budgetLinesHtml || '<p>-</p>'}

            <h3>Équipe</h3>
            ${teamHtml || '<p>-</p>'}

            <h3>Documents</h3>
            <p>${docsHtml}</p>

            <h3>Émetteurs</h3>
            <p>${emittersHtml}</p>
        `;
    }

    const DOCUMENTS_PRESETS = [
        "RDC", "RDJ",
        "SS1", "SS2", "SS3", "SS4",
        ...Array.from({ length: 10 }, (_, i) => `R+${i + 1}`)
    ];

    function populateDocumentsSelection() {
        const container = document.getElementById('documents-selection-container');
        container.innerHTML = '';

        DOCUMENTS_PRESETS.forEach(doc => {
            const label = document.createElement('label');
            label.className = 'checkbox-item';
            label.innerHTML = `<input type="checkbox" name="project-docs" value="${doc}"> ${doc}`;
            container.appendChild(label);
        });
    }

    async function populateEmittersSelection() {
        const container = document.getElementById('emitters-selection-container');
        container.innerHTML = '';

        const emitterTable = await grist.docApi.fetchTable('Emetteurs');

        function normalizeEmitterName(v) {
            if (v == null) return "";
            return String(v).trim();
        }

        const raw = emitterTable.Emetteurs || [];

        const map = new Map();
        for (const v of raw) {
            const display = normalizeEmitterName(v);
            if (!display) continue;

            const key = display.toLowerCase();
            if (!map.has(key)) map.set(key, display);
        }

        const emitters = Array.from(map.values())
            .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

        emitters.forEach(em => {
            const label = document.createElement('label');
            label.className = 'checkbox-item';
            label.innerHTML = `<input type="checkbox" name="project-emitters" value="${em}"> ${em}`;
            container.appendChild(label);
        });
    }

    // Final Save
    document.getElementById('create-project-btn').addEventListener('click', async () => {
        try {
            // 1. Create Project
            const projectActions = [
                ["AddRecord", "Projets", null, { Nom_de_projet: projectData.name, Numero_de_projet: projectData.number }]
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

            // 4. Create References (documents x emitters)
            const refTable = await grist.docApi.fetchTable("References");
            const refCols = new Set(Object.keys(refTable)); // colonnes existantes dans Grist

            const descCol =
            refCols.has("DescriptionObservations") ? "DescriptionObservations" :
            (refCols.has("DescriptionObservation") ? "DescriptionObservation" : null);

            const serviceValue = await getTeamService();

            const referencesActions = [];
            for (const docName of projectData.documents) {
                for (const emitter of projectData.emitters) {
                    const row = {
                    NomProjet: projectData.name,       // nom écrit
                    NomDocument: docName,
                    Emetteur: emitter,
                    Reference: "_",
                    Indice: "-",
                    Recu: "1900-01-01",
                    DateLimite: "1900-01-01",
                    Bloquant: false,
                    Archive: false,
                    Service: serviceValue
                    };
                    if (descCol) row[descCol] = "EN ATTENTE";

                    // On ne garde que les champs qui existent vraiment dans la table
                    for (const key of Object.keys(row)) {
                    if (!refCols.has(key)) delete row[key];
                    }

                    referencesActions.push(["AddRecord", "References", null, row]);
                }
            }

            if (referencesActions.length > 0) {
            await grist.docApi.applyUserActions(referencesActions);
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
    populateDocumentsSelection();
    populateEmittersSelection();
    showStep(1);
});
