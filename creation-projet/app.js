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

        // When pressing Enter on the last field, click the Suivant button
        projectNumberInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('next-to-step-2').click();
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
            .map(i => customDocuments[parseInt(i.value, 10)]);

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
                // If chapter is blank, click Suivant to go to next step
                if (!budgetChapterInput.value.trim()) {
                    document.getElementById('next-to-step-3').click();
                } else {
                    budgetAmountInput.focus();
                    budgetAmountInput.select();
                }
            }
        });

        // When pressing Enter on amount field, add the budget line
        budgetAmountInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('add-budget-line-btn').click();
                budgetChapterInput.focus();
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
            ? projectData.documents.map(d => d.numero ? `${d.name} [${d.numero}]` : d.name).join(', ')
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

    // Dynamic document list - each entry is { name, numero }
    let customDocuments = [];

    function renderDocumentsSelection() {
        const container = document.getElementById('documents-selection-container');
        container.innerHTML = '';

        if (customDocuments.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic;">Aucun document ajouté. Cliquez sur "+ Ajouter" pour commencer.</p>';
            return;
        }

        customDocuments.forEach((doc, index) => {
            const chip = document.createElement('span');
            chip.className = 'doc-chip';
            const numeroLabel = doc.numero ? ` [${doc.numero}]` : '';
            chip.innerHTML = `
                <input type="checkbox" name="project-docs" value="${index}" checked style="display: none;">
                <span>${doc.name}${numeroLabel}</span>
                <button type="button" class="doc-chip-delete" data-index="${index}" title="Supprimer">✖</button>
            `;
            container.appendChild(chip);
        });

        // Add delete handlers
        container.querySelectorAll('.doc-chip-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index, 10);
                customDocuments.splice(index, 1);
                renderDocumentsSelection();
            });
        });
    }

    function addDocuments(docs) {
        docs.forEach(doc => {
            const name = (typeof doc === 'string' ? doc : doc.name).trim();
            const numero = (typeof doc === 'string' ? '' : (doc.numero || '')).trim();
            if (name && !customDocuments.some(d => d.name === name)) {
                customDocuments.push({ name, numero });
            }
        });
        renderDocumentsSelection();
    }

    function generatePatternDocuments(prefix, suffix, start, end, padding, numeroStart, numeroStep, numeroPadding) {
        const docs = [];
        let currentNumero = numeroStart;
        for (let i = start; i <= end; i++) {
            let numStr = String(i);
            if (padding > 0) {
                numStr = numStr.padStart(padding, '0');
            }
            let numeroStr = String(currentNumero);
            if (numeroPadding > 0) {
                numeroStr = numeroStr.padStart(numeroPadding, '0');
            }
            docs.push({ name: `${prefix}${numStr}${suffix}`, numero: numeroStr });
            currentNumero += numeroStep;
        }
        return docs;
    }

    function updatePatternPreview() {
        const prefix = document.getElementById('pattern-prefix').value || '';
        const suffix = document.getElementById('pattern-suffix').value || '';
        const start = parseInt(document.getElementById('pattern-start').value, 10) || 0;
        const end = parseInt(document.getElementById('pattern-end').value, 10) || 0;
        const padding = parseInt(document.getElementById('pattern-padding').value, 10) || 0;
        const numeroStart = parseInt(document.getElementById('numero-start').value, 10) || 0;
        const numeroStep = parseInt(document.getElementById('numero-step').value, 10) || 1;
        const numeroPadding = parseInt(document.getElementById('numero-padding').value, 10) || 0;

        const previewBody = document.getElementById('pattern-preview-body');

        if (start > end) {
            previewBody.innerHTML = '<tr><td colspan="2" style="color: red;">(Erreur: "De" doit être &le; "&Agrave;")</td></tr>';
            return;
        }

        const docs = generatePatternDocuments(prefix, suffix, start, Math.min(end, start + 9), padding, numeroStart, numeroStep, numeroPadding);

        if (docs.length === 0) {
            previewBody.innerHTML = '<tr><td colspan="2">(Aucun aperçu)</td></tr>';
            return;
        }

        let html = '';
        docs.forEach(doc => {
            html += `<tr><td>${doc.numero}</td><td>${doc.name}</td></tr>`;
        });
        if (end - start > 9) {
            html += '<tr><td>...</td><td>...</td></tr>';
        }
        previewBody.innerHTML = html;
    }

    function setupDocsModal() {
        const modal = document.getElementById('docs-modal');
        const openBtn = document.getElementById('open-docs-modal-btn');
        const closeBtn = document.getElementById('close-docs-modal');
        const tabBtns = document.querySelectorAll('.tab-btn');
        const manualTab = document.getElementById('tab-manual');
        const patternTab = document.getElementById('tab-pattern');

        // Open modal
        openBtn.addEventListener('click', () => {
            modal.style.display = 'flex';
        });

        // Close modal
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });

        // Tab switching
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (btn.dataset.tab === 'manual') {
                    manualTab.style.display = 'block';
                    patternTab.style.display = 'none';
                } else {
                    manualTab.style.display = 'none';
                    patternTab.style.display = 'block';
                    updatePatternPreview();
                }
            });
        });

        // Manual add
        const manualInput = document.getElementById('manual-doc-name');
        const manualNumeroInput = document.getElementById('manual-doc-numero');
        const addManualBtn = document.getElementById('add-manual-doc-btn');

        addManualBtn.addEventListener('click', () => {
            const docName = manualInput.value.trim();
            const docNumero = manualNumeroInput.value.trim();
            if (docName) {
                addDocuments([{ name: docName, numero: docNumero }]);
                manualInput.value = '';
                manualNumeroInput.value = '';
                manualInput.focus();
            }
        });

        manualInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                manualNumeroInput.focus();
            }
        });

        manualNumeroInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addManualBtn.click();
            }
        });

        // Pattern add
        const prefixInput = document.getElementById('pattern-prefix');
        const suffixInput = document.getElementById('pattern-suffix');
        const startInput = document.getElementById('pattern-start');
        const endInput = document.getElementById('pattern-end');
        const paddingSelect = document.getElementById('pattern-padding');
        const addPatternBtn = document.getElementById('add-pattern-docs-btn');

        // Update preview on input change
        [prefixInput, suffixInput, startInput, endInput, paddingSelect].forEach(el => {
            el.addEventListener('input', updatePatternPreview);
            el.addEventListener('change', updatePatternPreview);
        });

        // N°Document inputs
        const numeroStartInput = document.getElementById('numero-start');
        const numeroStepInput = document.getElementById('numero-step');
        const numeroPaddingSelect = document.getElementById('numero-padding');

        // Update preview on numero input change
        [numeroStartInput, numeroStepInput, numeroPaddingSelect].forEach(el => {
            el.addEventListener('input', updatePatternPreview);
            el.addEventListener('change', updatePatternPreview);
        });

        addPatternBtn.addEventListener('click', () => {
            const prefix = prefixInput.value || '';
            const suffix = suffixInput.value || '';
            const start = parseInt(startInput.value, 10) || 0;
            const end = parseInt(endInput.value, 10) || 0;
            const padding = parseInt(paddingSelect.value, 10) || 0;
            const numeroStart = parseInt(numeroStartInput.value, 10) || 0;
            const numeroStep = parseInt(numeroStepInput.value, 10) || 1;
            const numeroPadding = parseInt(numeroPaddingSelect.value, 10) || 0;

            if (start > end) {
                alert('Erreur: "De" doit être inférieur ou égal à "À".');
                return;
            }

            const docs = generatePatternDocuments(prefix, suffix, start, end, padding, numeroStart, numeroStep, numeroPadding);
            addDocuments(docs);

            // Reset form but keep modal open for adding more
            prefixInput.value = '';
            suffixInput.value = '';
            startInput.value = '1';
            endInput.value = '5';
            paddingSelect.value = '0';
            numeroStartInput.value = '1';
            numeroStepInput.value = '1';
            numeroPaddingSelect.value = '3';
            updatePatternPreview();
        });

        // Initial preview
        updatePatternPreview();
    }

    function initDocumentsSection() {
        renderDocumentsSelection();
        setupDocsModal();
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
            for (const doc of projectData.documents) {
                for (const emitter of projectData.emitters) {
                    const row = {
                        NomProjet: projectData.name,       // nom écrit
                        NomDocument: doc.name,
                        NumeroDocument: doc.numero || '',
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

            // 5. Add to ListePlan_NDC_COF (COFFRAGE)
            const listePlanActions = projectData.documents.map(doc => {
                 return ["AddRecord", "ListePlan_NDC_COF", null, {
                     Nom_projet: projectData.name,
                     Type_document: "COFFRAGE",
                     NumeroDocument: doc.numero,
                     Designation: doc.name,
                     Indice: null,
                     DateDiffusion: null
                 }];
            });

            if (listePlanActions.length > 0) {
                await grist.docApi.applyUserActions(listePlanActions);
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
    initDocumentsSection();
    populateEmittersSelection();
    showStep(1);
});
