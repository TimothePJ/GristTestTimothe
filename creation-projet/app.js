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

    function cleanProjectName(name) {
        return String(name ?? "").replace(/\s+$/g, "");
    }

    function formatBudgetAmount(amount) {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount)) {
            return "";
        }

        return new Intl.NumberFormat("fr-FR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })
            .format(numericAmount)
            .replace(/\u202f/g, " ")
            .replace(/\u00a0/g, " ");
    }

    function toBooleanFlag(value) {
        if (value === true || value === 1) {
            return true;
        }

        const normalizedValue = String(value ?? "").trim().toLowerCase();
        return ["true", "1", "oui", "yes", "vrai"].includes(normalizedValue);
    }

    function getTeamExternalColumn(teamData = {}) {
        const candidateColumns = [
            'Externe',
            'EstExterne',
            'External',
            'IsExternal',
            'Externe'
        ];

        return candidateColumns.find((columnName) => Array.isArray(teamData?.[columnName])) || null;
    }

    const LISTEPLAN_TABLE_CANDIDATES = [
        'ListePlan_NDC_COF',
        'ListePlan NDC+COF',
        'ListePlan_NDC+COF'
    ];
    const PLANNING_TABLE_CANDIDATES = ['Planning_Projet', 'Planning_Project'];

    function normalizeText(value) {
        return String(value ?? '').trim();
    }

    function normalizeDocumentType(value) {
        return normalizeText(value).toUpperCase();
    }

    function normalizeZoneValue(value) {
        const text = normalizeText(value);
        if (!text) return '';
        return text.toLowerCase() === 'sans zone' ? '' : text;
    }

    function formatZoneLabel(value) {
        return normalizeZoneValue(value) || 'Sans zone';
    }

    function buildDocumentIdentityKey(doc = {}) {
        return [
            normalizeText(doc.name).toLowerCase(),
            normalizeText(doc.numero).toLowerCase(),
            normalizeDocumentType(doc.type),
            normalizeZoneValue(doc.zone).toLowerCase()
        ].join('||');
    }

    function buildDocumentNumeroScopeKey(doc = {}) {
        return [
            normalizeText(doc.numero).toLowerCase(),
            normalizeDocumentType(doc.type),
            normalizeZoneValue(doc.zone).toLowerCase()
        ].join('||');
    }

    function collectCustomDocumentZones() {
        const seen = new Set();
        return customDocuments
            .map((doc) => normalizeZoneValue(doc?.zone))
            .filter((zone) => {
                if (!zone || seen.has(zone.toLowerCase())) return false;
                seen.add(zone.toLowerCase());
                return true;
            })
            .sort((left, right) => left.localeCompare(right, 'fr', {
                sensitivity: 'base',
                numeric: true
            }));
    }

    function refreshDocumentZoneSuggestionLists() {
        const zones = collectCustomDocumentZones();
        ['manual-doc-zone-list', 'pattern-doc-zone-list'].forEach((listId) => {
            const datalist = document.getElementById(listId);
            if (!(datalist instanceof HTMLDataListElement)) return;
            datalist.innerHTML = '';
            zones.forEach((zone) => {
                const option = document.createElement('option');
                option.value = zone;
                datalist.appendChild(option);
            });
        });
    }

    function getTableColumnNames(tableData = {}) {
        if (Array.isArray(tableData)) {
            const names = new Set();
            tableData.forEach((row) => {
                Object.keys(row || {}).forEach((key) => names.add(String(key)));
            });
            return names;
        }

        return new Set(Object.keys(tableData || {}));
    }

    async function fetchFirstAvailableTable(tableCandidates = []) {
        let lastError = null;
        for (const tableName of tableCandidates) {
            try {
                const data = await grist.docApi.fetchTable(tableName);
                return { tableName, data, columns: getTableColumnNames(data) };
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error('Aucune table disponible.');
    }

    function setFieldIfPresent(columnNames, fields, columnName, value) {
        if (columnNames.has(columnName)) {
            fields[columnName] = value;
        }
    }

    function getTableColumnArray(tableData, columnName) {
        if (!tableData || !columnName) return [];
        return Array.isArray(tableData[columnName]) ? tableData[columnName] : [];
    }

    function planningZoneExists(planningData, projectName, zoneName) {
        const normalizedZone = normalizeZoneValue(zoneName);
        if (!normalizedZone) return true;

        const projects = getTableColumnArray(planningData, 'NomProjet');
        const zones = getTableColumnArray(planningData, 'Zone');

        for (let index = 0; index < Math.max(projects.length, zones.length); index += 1) {
            if (
                normalizeText(projects[index]).toLowerCase() === normalizeText(projectName).toLowerCase() &&
                normalizeZoneValue(zones[index]) === normalizedZone
            ) {
                return true;
            }
        }

        return false;
    }

    function buildPlanningZoneAnchorFields(columnNames, projectName, zoneName) {
        const normalizedZone = normalizeZoneValue(zoneName);
        const fields = {};

        setFieldIfPresent(columnNames, fields, 'ID2', '');
        setFieldIfPresent(columnNames, fields, 'Taches', '');
        setFieldIfPresent(columnNames, fields, 'Tache', '');
        setFieldIfPresent(columnNames, fields, 'Type_doc', '');
        setFieldIfPresent(columnNames, fields, 'Prev_Indice_0', null);
        setFieldIfPresent(columnNames, fields, 'Date_limite', null);
        setFieldIfPresent(columnNames, fields, 'Duree_1', 0);
        setFieldIfPresent(columnNames, fields, 'Diff_coffrage', null);
        setFieldIfPresent(columnNames, fields, 'Duree_2', 0);
        setFieldIfPresent(columnNames, fields, 'Diff_armature', null);
        setFieldIfPresent(columnNames, fields, 'Duree_3', 0);
        setFieldIfPresent(columnNames, fields, 'Demarrages_travaux', null);
        setFieldIfPresent(columnNames, fields, 'Retards', 0);
        setFieldIfPresent(columnNames, fields, 'Indice', '');
        setFieldIfPresent(columnNames, fields, 'Realise', 0);
        setFieldIfPresent(columnNames, fields, 'NomProjet', projectName);
        setFieldIfPresent(columnNames, fields, 'Groupe', '');
        setFieldIfPresent(columnNames, fields, 'Zone', normalizedZone);

        return fields;
    }

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
        projectData.name = cleanProjectName(document.getElementById('project-name').value);
        projectData.number = document.getElementById('project-number').value.trim();

        // (optionnel mais pratique) mettre à jour le champ affiché
        document.getElementById('project-name').value = projectData.name;
        document.getElementById('project-number').value = projectData.number;

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
        if (budgetChapterInput.value.trim() && budgetAmountInput.value.trim()) {
            saveBudgetLineFromInputs();
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

        const numeroCounts = {};
        let hasDuplicate = false;
        projectData.documents.forEach(doc => {
            if (doc.numero) {
                const duplicateKey = buildDocumentNumeroScopeKey(doc);
                numeroCounts[duplicateKey] = (numeroCounts[duplicateKey] || 0) + 1;
                if (numeroCounts[duplicateKey] > 1) {
                    hasDuplicate = true;
                }
            }
        });

        if (hasDuplicate) {
            alert("Des numeros de documents sont en doublons");
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
    let editingBudgetLineIndex = null;

    function getBudgetLineOrder(chapter) {
        const match = String(chapter ?? '').trim().match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
    }

    function sortBudgetLines() {
        projectData.budgetLines.sort((left, right) => {
            const leftOrder = getBudgetLineOrder(left?.chapter);
            const rightOrder = getBudgetLineOrder(right?.chapter);

            if (leftOrder !== rightOrder) {
                return leftOrder - rightOrder;
            }

            return String(left?.chapter ?? '').localeCompare(String(right?.chapter ?? ''), 'fr', {
                sensitivity: 'base',
                numeric: true
            });
        });
    }

    function resetBudgetLineForm() {
        editingBudgetLineIndex = null;
        budgetChapterInput.value = '';
        budgetAmountInput.value = '';
        addBudgetLineBtn.textContent = 'Ajouter Ligne';
    }

    function saveBudgetLineFromInputs() {
        const chapter = budgetChapterInput.value.trim();
        const amount = parseFloat(budgetAmountInput.value);

        if (!chapter || Number.isNaN(amount)) {
            return false;
        }

        const nextLine = { chapter, amount };
        if (
            Number.isInteger(editingBudgetLineIndex) &&
            editingBudgetLineIndex >= 0 &&
            editingBudgetLineIndex < projectData.budgetLines.length
        ) {
            projectData.budgetLines[editingBudgetLineIndex] = nextLine;
        } else {
            projectData.budgetLines.push(nextLine);
        }

        sortBudgetLines();
        resetBudgetLineForm();
        renderBudgetLines();
        return true;
    }

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
        saveBudgetLineFromInputs();
        budgetChapterInput.focus();
    });

    function renderBudgetLinesLegacy() {
        budgetLinesContainer.innerHTML = '';
        sortBudgetLines();

        projectData.budgetLines.forEach((line, index) => {
            const row = document.createElement('div');
            row.className = 'budget-line';
            if (editingBudgetLineIndex === index) {
                row.classList.add('is-editing');
            }

            const text = document.createElement('span');
            text.className = 'budget-line-text';
            text.textContent = `${line.chapter}: ${formatBudgetAmount(line.amount)} €`;

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

    function renderBudgetLines() {
        budgetLinesContainer.innerHTML = '';
        sortBudgetLines();

        projectData.budgetLines.forEach((line, index) => {
            const row = document.createElement('div');
            row.className = 'budget-line';
            if (editingBudgetLineIndex === index) {
                row.classList.add('is-editing');
            }

            const text = document.createElement('span');
            text.className = 'budget-line-text';
            text.textContent = `${line.chapter}: ${formatBudgetAmount(line.amount)} \u20AC`;

            const actions = document.createElement('div');
            actions.className = 'budget-line-actions';

            const edit = document.createElement('button');
            edit.className = 'budget-line-edit';
            edit.type = 'button';
            edit.title = 'Modifier cette ligne';
            edit.textContent = 'Modifier';

            edit.addEventListener('click', () => {
                editingBudgetLineIndex = index;
                budgetChapterInput.value = line.chapter;
                budgetAmountInput.value = String(line.amount);
                addBudgetLineBtn.textContent = 'Enregistrer Ligne';
                renderBudgetLines();
                budgetChapterInput.focus();
                budgetChapterInput.select();
            });

            const del = document.createElement('button');
            del.className = 'budget-line-delete';
            del.type = 'button';
            del.title = 'Supprimer cette ligne';
            del.textContent = '✖';

            del.addEventListener('click', () => {
                projectData.budgetLines.splice(index, 1);

                if (editingBudgetLineIndex === index) {
                    resetBudgetLineForm();
                } else if (
                    Number.isInteger(editingBudgetLineIndex) &&
                    editingBudgetLineIndex > index
                ) {
                    editingBudgetLineIndex -= 1;
                }

                renderBudgetLines();
            });

            actions.appendChild(edit);
            actions.appendChild(del);
            row.appendChild(text);
            row.appendChild(actions);
            budgetLinesContainer.appendChild(row);
        });
    }

    // Team Selection
    async function populateTeamSelection() {
        const teamData = await grist.docApi.fetchTable("Team");
        const externalColumn = getTeamExternalColumn(teamData);
        teamMembers = teamData.id.map((id, index) => ({
            id: id,
            Prenom: teamData.Prenom[index],
            Nom: teamData.Nom[index],
            Role: teamData.Role[index],
            Externe: externalColumn ? toBooleanFlag(teamData[externalColumn][index]) : false
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
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = String(member.id);

                const name = document.createElement('span');
                name.className = 'team-member-name';
                name.textContent = `${member.Prenom} ${member.Nom}`;

                label.appendChild(checkbox);
                label.appendChild(name);

                if (member.Externe) {
                    const badge = document.createElement('span');
                    badge.className = 'team-member-badge';
                    badge.textContent = '(Externe)';
                    label.appendChild(badge);
                }

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
        sortBudgetLines();

        const docsHtml = (projectData.documents && projectData.documents.length)
            ? projectData.documents
                .map((d) => {
                    const numeroLabel = d.numero ? ` [${d.numero}]` : '';
                    const typeLabel = normalizeDocumentType(d.type || 'COFFRAGE');
                    const zoneLabel = ` - ${formatZoneLabel(d.zone)}`;
                    return `${d.name}${numeroLabel} (${typeLabel}${zoneLabel})`;
                })
                .join(', ')
            : '-';

        const emittersHtml = (projectData.emitters && projectData.emitters.length)
            ? projectData.emitters.join(', ')
            : '-';

        // Budget
        const budgetLinesHtml = (projectData.budgetLines || [])
            .map(line => `<p>${line.chapter}: ${formatBudgetAmount(line.amount)} €</p>`)
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
        
        // Override grid display to allow full-width groups
        container.style.display = 'block';
        refreshDocumentZoneSuggestionLists();

        if (customDocuments.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic;">Aucun document ajouté. Cliquez sur "+ Ajouter" pour commencer.</p>';
            return;
        }

        const numeroCounts = {};
        customDocuments.forEach(doc => {
            if (doc.numero) {
                const duplicateKey = buildDocumentNumeroScopeKey(doc);
                numeroCounts[duplicateKey] = (numeroCounts[duplicateKey] || 0) + 1;
            }
        });

        // Group by type
        const groupedDocs = {};
        customDocuments.forEach((doc, index) => {
            const type = normalizeDocumentType(doc.type || 'COFFRAGE') || 'AUTRE';
            if (!groupedDocs[type]) {
                groupedDocs[type] = [];
            }
            groupedDocs[type].push({ doc, index });
        });

        const sortedTypes = Object.keys(groupedDocs).sort();

        sortedTypes.forEach(type => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'doc-group';
            groupDiv.style.marginBottom = '15px';

            const header = document.createElement('h4');
            header.textContent = type;
            header.style.marginTop = '0';
            header.style.marginBottom = '8px';
            header.style.borderBottom = '1px solid #ccc';
            header.style.color = '#004990';
            header.style.fontSize = '1em';
            groupDiv.appendChild(header);

            const docsByZone = new Map();
            groupedDocs[type].forEach((entry) => {
                const zoneKey = normalizeZoneValue(entry.doc.zone);
                if (!docsByZone.has(zoneKey)) {
                    docsByZone.set(zoneKey, []);
                }
                docsByZone.get(zoneKey).push(entry);
            });

            const zoneKeys = Array.from(docsByZone.keys()).sort((left, right) => {
                const leftBlank = normalizeZoneValue(left) ? 0 : 1;
                const rightBlank = normalizeZoneValue(right) ? 0 : 1;
                if (leftBlank !== rightBlank) {
                    return leftBlank - rightBlank;
                }
                return formatZoneLabel(left).localeCompare(formatZoneLabel(right), 'fr', {
                    sensitivity: 'base',
                    numeric: true
                });
            });

            zoneKeys.forEach((zoneKey) => {
                const zoneSection = document.createElement('div');
                zoneSection.className = 'doc-zone-group';

                const zoneTitle = document.createElement('h5');
                zoneTitle.className = 'doc-zone-title';
                zoneTitle.textContent = formatZoneLabel(zoneKey);
                zoneSection.appendChild(zoneTitle);

                const chipsContainer = document.createElement('div');
                chipsContainer.className = 'doc-chip-list';

                docsByZone.get(zoneKey)
                    .sort((left, right) =>
                        normalizeText(left.doc.numero).localeCompare(normalizeText(right.doc.numero), 'fr', {
                            sensitivity: 'base',
                            numeric: true
                        }) ||
                        normalizeText(left.doc.name).localeCompare(normalizeText(right.doc.name), 'fr', {
                            sensitivity: 'base',
                            numeric: true
                        })
                    )
                    .forEach(({ doc, index }) => {
                        const chip = document.createElement('span');
                        chip.className = 'doc-chip';

                        const duplicateKey = buildDocumentNumeroScopeKey(doc);
                        const isDuplicate = doc.numero && numeroCounts[duplicateKey] > 1;
                        if (isDuplicate) {
                            chip.style.borderColor = 'red';
                            chip.title = `Numéro de document dupliqué pour ${type} - ${formatZoneLabel(doc.zone)}`;
                        }

                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.name = 'project-docs';
                        checkbox.value = String(index);
                        checkbox.checked = true;
                        checkbox.style.display = 'none';

                        const text = document.createElement('span');
                        text.className = 'doc-chip-text';
                        text.textContent = doc.name;

                        chip.appendChild(checkbox);
                        chip.appendChild(text);

                        if (doc.numero) {
                            const numero = document.createElement('span');
                            numero.className = 'doc-chip-numero';
                            numero.textContent = `[${doc.numero}]`;
                            if (isDuplicate) {
                                numero.style.color = 'red';
                                numero.style.fontWeight = 'bold';
                            }
                            chip.appendChild(numero);
                        }

                        const deleteBtn = document.createElement('button');
                        deleteBtn.type = 'button';
                        deleteBtn.className = 'doc-chip-delete';
                        deleteBtn.dataset.index = String(index);
                        deleteBtn.title = 'Supprimer';
                        deleteBtn.textContent = '✖';
                        chip.appendChild(deleteBtn);

                        chipsContainer.appendChild(chip);
                    });

                zoneSection.appendChild(chipsContainer);
                groupDiv.appendChild(zoneSection);
            });
            container.appendChild(groupDiv);
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
            const type = normalizeDocumentType(typeof doc === 'string' ? '' : (doc.type || 'COFFRAGE'));
            const zone = normalizeZoneValue(typeof doc === 'string' ? '' : (doc.zone || ''));
            const nextDoc = { name, numero, type, zone };
            if (name && !customDocuments.some(d => buildDocumentIdentityKey(d) === buildDocumentIdentityKey(nextDoc))) {
                customDocuments.push(nextDoc);
            }
        });
        renderDocumentsSelection();
    }

    function generatePatternDocuments(prefix, suffix, start, end, padding, numeroStart, numeroStep, numeroPadding, type, zone = '') {
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
            docs.push({
                name: `${prefix}${numStr}${suffix}`,
                numero: numeroStr,
                type: normalizeDocumentType(type),
                zone: normalizeZoneValue(zone)
            });
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
        const type = document.getElementById('pattern-doc-type').value || '';
        const zone = normalizeZoneValue(document.getElementById('pattern-doc-zone').value || '');

        const previewBody = document.getElementById('pattern-preview-body');

        if (start > end) {
            previewBody.innerHTML = '<tr><td colspan="2" style="color: red;">(Erreur: "De" doit être &le; "&Agrave;")</td></tr>';
            return;
        }

        const docs = generatePatternDocuments(prefix, suffix, start, Math.min(end, start + 9), padding, numeroStart, numeroStep, numeroPadding, type);

        if (docs.length === 0) {
            previewBody.innerHTML = '<tr><td colspan="3">(Aucun aperçu)</td></tr>';
            return;
        }

        let html = '';
        docs.forEach(doc => {
            html += `<tr><td>${doc.numero}</td><td>${doc.name}</td><td>${doc.type}</td></tr>`;
        });
        if (end - start > 9) {
            html += '<tr><td>...</td><td>...</td><td>...</td></tr>';
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
        const manualTypeInput = document.getElementById('manual-doc-type');
        const addManualBtn = document.getElementById('add-manual-doc-btn');

        addManualBtn.addEventListener('click', () => {
            const docNames = manualInput.value.split(',').map(s => s.trim()).filter(s => s);
            const docNumeros = manualNumeroInput.value.split(',').map(s => s.trim()).filter(s => s);
            const type = manualTypeInput.value.trim();

            if (docNames.length > 0) {
                const docs = docNames.map((name, index) => ({
                    name: name,
                    numero: docNumeros[index] || '',
                    type: type
                }));
                addDocuments(docs);
                manualInput.value = '';
                manualNumeroInput.value = '';
                manualTypeInput.value = 'COFFRAGE';
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
        const patternTypeInput = document.getElementById('pattern-doc-type');
        const addPatternBtn = document.getElementById('add-pattern-docs-btn');

        // Update preview on input change
        [prefixInput, suffixInput, startInput, endInput, paddingSelect, patternTypeInput].forEach(el => {
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
            const type = patternTypeInput.value.trim();

            if (start > end) {
                alert('Erreur: "De" doit être inférieur ou égal à "À".');
                return;
            }

            const docs = generatePatternDocuments(prefix, suffix, start, end, padding, numeroStart, numeroStep, numeroPadding, type);
            addDocuments(docs);

            // Reset form but keep modal open for adding more
            prefixInput.value = '';
            suffixInput.value = '';
            startInput.value = '1';
            endInput.value = '5';
            paddingSelect.value = '0';
            numeroStartInput.value = '1';
            numeroStepInput.value = '1';
            numeroPaddingSelect.value = '0';
            patternTypeInput.value = 'COFFRAGE';
            updatePatternPreview();
        });

        // Initial preview
        updatePatternPreview();
    }

    function initDocumentsSection() {
        renderDocumentsSelection();
        setupDocsModal();
    }

    function renderDocumentsSelection() {
        const container = document.getElementById('documents-selection-container');
        container.innerHTML = '';
        container.style.display = 'block';
        refreshDocumentZoneSuggestionLists();

        if (customDocuments.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic;">Aucun document ajoute. Cliquez sur "+ Ajouter" pour commencer.</p>';
            return;
        }

        const duplicateCounts = {};
        customDocuments.forEach((doc) => {
            if (!normalizeText(doc.numero)) return;
            const duplicateKey = buildDocumentNumeroScopeKey(doc);
            duplicateCounts[duplicateKey] = (duplicateCounts[duplicateKey] || 0) + 1;
        });

        const groupedByType = new Map();
        customDocuments.forEach((doc, index) => {
            const typeKey = normalizeDocumentType(doc.type || 'COFFRAGE') || 'AUTRE';
            if (!groupedByType.has(typeKey)) {
                groupedByType.set(typeKey, []);
            }
            groupedByType.get(typeKey).push({ doc, index });
        });

        const sortedTypes = Array.from(groupedByType.keys()).sort((left, right) =>
            left.localeCompare(right, 'fr', { sensitivity: 'base', numeric: true })
        );

        sortedTypes.forEach((typeKey) => {
            const typeSection = document.createElement('div');
            typeSection.className = 'doc-group';
            typeSection.style.marginBottom = '15px';

            const typeHeader = document.createElement('h4');
            typeHeader.textContent = typeKey;
            typeHeader.style.marginTop = '0';
            typeHeader.style.marginBottom = '8px';
            typeHeader.style.borderBottom = '1px solid #ccc';
            typeHeader.style.color = '#004990';
            typeHeader.style.fontSize = '1em';
            typeSection.appendChild(typeHeader);

            const groupedByZone = new Map();
            groupedByType.get(typeKey).forEach((entry) => {
                const zoneKey = normalizeZoneValue(entry.doc.zone);
                if (!groupedByZone.has(zoneKey)) {
                    groupedByZone.set(zoneKey, []);
                }
                groupedByZone.get(zoneKey).push(entry);
            });

            const zoneKeys = Array.from(groupedByZone.keys()).sort((left, right) => {
                const leftBlank = normalizeZoneValue(left) ? 0 : 1;
                const rightBlank = normalizeZoneValue(right) ? 0 : 1;
                if (leftBlank !== rightBlank) {
                    return leftBlank - rightBlank;
                }
                return formatZoneLabel(left).localeCompare(formatZoneLabel(right), 'fr', {
                    sensitivity: 'base',
                    numeric: true
                });
            });

            zoneKeys.forEach((zoneKey) => {
                const zoneSection = document.createElement('div');
                zoneSection.className = 'doc-zone-group';

                const zoneTitle = document.createElement('h5');
                zoneTitle.className = 'doc-zone-title';
                zoneTitle.textContent = formatZoneLabel(zoneKey);
                zoneSection.appendChild(zoneTitle);

                const chipList = document.createElement('div');
                chipList.className = 'doc-chip-list';

                groupedByZone.get(zoneKey)
                    .sort((left, right) =>
                        normalizeText(left.doc.numero).localeCompare(normalizeText(right.doc.numero), 'fr', {
                            sensitivity: 'base',
                            numeric: true
                        }) ||
                        normalizeText(left.doc.name).localeCompare(normalizeText(right.doc.name), 'fr', {
                            sensitivity: 'base',
                            numeric: true
                        })
                    )
                    .forEach(({ doc, index }) => {
                        const chip = document.createElement('span');
                        chip.className = 'doc-chip';

                        const duplicateKey = buildDocumentNumeroScopeKey(doc);
                        const isDuplicate = normalizeText(doc.numero) && duplicateCounts[duplicateKey] > 1;
                        if (isDuplicate) {
                            chip.style.borderColor = 'red';
                            chip.title = `Numero de document duplique pour ${typeKey} - ${formatZoneLabel(doc.zone)}`;
                        }

                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.name = 'project-docs';
                        checkbox.value = String(index);
                        checkbox.checked = true;
                        checkbox.style.display = 'none';
                        chip.appendChild(checkbox);

                        const chipText = document.createElement('span');
                        chipText.className = 'doc-chip-text';
                        chipText.textContent = doc.name;
                        chip.appendChild(chipText);

                        if (normalizeText(doc.numero)) {
                            const numeroLabel = document.createElement('span');
                            numeroLabel.className = 'doc-chip-numero';
                            numeroLabel.textContent = `[${doc.numero}]`;
                            if (isDuplicate) {
                                numeroLabel.style.color = 'red';
                                numeroLabel.style.fontWeight = 'bold';
                            }
                            chip.appendChild(numeroLabel);
                        }

                        const deleteBtn = document.createElement('button');
                        deleteBtn.type = 'button';
                        deleteBtn.className = 'doc-chip-delete';
                        deleteBtn.dataset.index = String(index);
                        deleteBtn.title = 'Supprimer';
                        deleteBtn.textContent = '✖';
                        chip.appendChild(deleteBtn);

                        chipList.appendChild(chip);
                    });

                zoneSection.appendChild(chipList);
                typeSection.appendChild(zoneSection);
            });

            container.appendChild(typeSection);
        });

        container.querySelectorAll('.doc-chip-delete').forEach((btn) => {
            btn.addEventListener('click', (event) => {
                const index = parseInt(event.currentTarget.dataset.index, 10);
                customDocuments.splice(index, 1);
                renderDocumentsSelection();
            });
        });
    }

    function addDocuments(docs) {
        docs.forEach((doc) => {
            const name = normalizeText(typeof doc === 'string' ? doc : doc.name);
            const numero = normalizeText(typeof doc === 'string' ? '' : (doc.numero || ''));
            const type = normalizeDocumentType(typeof doc === 'string' ? '' : (doc.type || 'COFFRAGE'));
            const zone = normalizeZoneValue(typeof doc === 'string' ? '' : (doc.zone || ''));
            const nextDoc = { name, numero, type, zone };
            if (!name) return;
            if (customDocuments.some((existingDoc) => buildDocumentIdentityKey(existingDoc) === buildDocumentIdentityKey(nextDoc))) {
                return;
            }
            customDocuments.push(nextDoc);
        });
        renderDocumentsSelection();
    }

    function generatePatternDocuments(prefix, suffix, start, end, padding, numeroStart, numeroStep, numeroPadding, type, zone = '') {
        const docs = [];
        let currentNumero = numeroStart;
        for (let i = start; i <= end; i += 1) {
            let numStr = String(i);
            if (padding > 0) {
                numStr = numStr.padStart(padding, '0');
            }
            let numeroStr = String(currentNumero);
            if (numeroPadding > 0) {
                numeroStr = numeroStr.padStart(numeroPadding, '0');
            }
            docs.push({
                name: `${prefix}${numStr}${suffix}`,
                numero: numeroStr,
                type: normalizeDocumentType(type),
                zone: normalizeZoneValue(zone)
            });
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
        const type = document.getElementById('pattern-doc-type').value || '';
        const zone = normalizeZoneValue(document.getElementById('pattern-doc-zone')?.value || '');
        const previewBody = document.getElementById('pattern-preview-body');

        if (start > end) {
            previewBody.innerHTML = '<tr><td colspan="4" style="color: red;">(Erreur: "De" doit etre inferieur ou egal a "A".)</td></tr>';
            return;
        }

        const docs = generatePatternDocuments(
            prefix,
            suffix,
            start,
            Math.min(end, start + 9),
            padding,
            numeroStart,
            numeroStep,
            numeroPadding,
            type,
            zone
        );

        if (docs.length === 0) {
            previewBody.innerHTML = '<tr><td colspan="4">(Aucun apercu)</td></tr>';
            return;
        }

        let html = '';
        docs.forEach((doc) => {
            html += `<tr><td>${doc.numero}</td><td>${doc.name}</td><td>${doc.type}</td><td>${formatZoneLabel(doc.zone)}</td></tr>`;
        });
        if (end - start > 9) {
            html += '<tr><td>...</td><td>...</td><td>...</td><td>...</td></tr>';
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

        const manualInput = document.getElementById('manual-doc-name');
        const manualNumeroInput = document.getElementById('manual-doc-numero');
        const manualTypeInput = document.getElementById('manual-doc-type');
        const manualZoneInput = document.getElementById('manual-doc-zone');
        const addManualBtn = document.getElementById('add-manual-doc-btn');

        const prefixInput = document.getElementById('pattern-prefix');
        const suffixInput = document.getElementById('pattern-suffix');
        const startInput = document.getElementById('pattern-start');
        const endInput = document.getElementById('pattern-end');
        const paddingSelect = document.getElementById('pattern-padding');
        const patternTypeInput = document.getElementById('pattern-doc-type');
        const patternZoneInput = document.getElementById('pattern-doc-zone');
        const addPatternBtn = document.getElementById('add-pattern-docs-btn');
        const numeroStartInput = document.getElementById('numero-start');
        const numeroStepInput = document.getElementById('numero-step');
        const numeroPaddingSelect = document.getElementById('numero-padding');

        function closeModal() {
            modal.style.display = 'none';
        }

        openBtn.addEventListener('click', () => {
            refreshDocumentZoneSuggestionLists();
            modal.style.display = 'flex';
        });

        closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeModal();
            }
        });

        tabBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                tabBtns.forEach((tabBtn) => tabBtn.classList.remove('active'));
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

        addManualBtn.addEventListener('click', () => {
            const docNames = manualInput.value.split(',').map((value) => value.trim()).filter(Boolean);
            const docNumeros = manualNumeroInput.value.split(',').map((value) => value.trim());
            const type = normalizeDocumentType(manualTypeInput.value || 'COFFRAGE');
            const zone = normalizeZoneValue(manualZoneInput.value);

            if (!docNames.length) {
                return;
            }

            const docs = docNames.map((name, index) => ({
                name,
                numero: docNumeros[index] || '',
                type,
                zone
            }));

            addDocuments(docs);
            manualInput.value = '';
            manualNumeroInput.value = '';
            manualTypeInput.value = 'COFFRAGE';
            manualZoneInput.value = '';
            manualInput.focus();
        });

        manualZoneInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                manualInput.focus();
            }
        });

        manualInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                manualNumeroInput.focus();
            }
        });

        manualNumeroInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                addManualBtn.click();
            }
        });

        [prefixInput, suffixInput, startInput, endInput, paddingSelect, patternTypeInput, patternZoneInput].forEach((element) => {
            element.addEventListener('input', updatePatternPreview);
            element.addEventListener('change', updatePatternPreview);
        });

        [numeroStartInput, numeroStepInput, numeroPaddingSelect].forEach((element) => {
            element.addEventListener('input', updatePatternPreview);
            element.addEventListener('change', updatePatternPreview);
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
            const type = normalizeDocumentType(patternTypeInput.value || 'COFFRAGE');
            const zone = normalizeZoneValue(patternZoneInput.value);

            if (start > end) {
                alert('Erreur: "De" doit Ãªtre infÃ©rieur ou Ã©gal Ã  "Ã€".');
                return;
            }

            addDocuments(generatePatternDocuments(
                prefix,
                suffix,
                start,
                end,
                padding,
                numeroStart,
                numeroStep,
                numeroPadding,
                type,
                zone
            ));

            prefixInput.value = '';
            suffixInput.value = '';
            startInput.value = '1';
            endInput.value = '5';
            paddingSelect.value = '0';
            numeroStartInput.value = '1';
            numeroStepInput.value = '1';
            numeroPaddingSelect.value = '0';
            patternTypeInput.value = 'COFFRAGE';
            patternZoneInput.value = '';
            updatePatternPreview();
        });

        updatePatternPreview();
    }

    function initDocumentsSection() {
        renderDocumentsSelection();
        setupDocsModal();
        refreshDocumentZoneSuggestionLists();
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
            projectData.name = cleanProjectName(projectData.name);
            projectData.number = (projectData.number ?? "").toString().trim();
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
                        Type_document: doc.type || "COFFRAGE",
                        Zone: normalizeZoneValue(doc.zone),
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

            // 5. Add to ListePlan_NDC_COF
            const listePlanContext = await fetchFirstAvailableTable(LISTEPLAN_TABLE_CANDIDATES);
            const listePlanActions = projectData.documents.map((doc) => {
                const fields = {};
                setFieldIfPresent(listePlanContext.columns, fields, 'Nom_projet', projectData.name);
                setFieldIfPresent(listePlanContext.columns, fields, 'NomProjet', projectData.name);
                setFieldIfPresent(listePlanContext.columns, fields, 'Type_document', doc.type || 'COFFRAGE');
                setFieldIfPresent(listePlanContext.columns, fields, 'Type_doc', doc.type || 'COFFRAGE');
                setFieldIfPresent(listePlanContext.columns, fields, 'NumeroDocument', doc.numero || '');
                setFieldIfPresent(listePlanContext.columns, fields, 'Designation', doc.name);
                setFieldIfPresent(listePlanContext.columns, fields, 'NomDocument', doc.name);
                setFieldIfPresent(listePlanContext.columns, fields, 'Zone', normalizeZoneValue(doc.zone));
                setFieldIfPresent(listePlanContext.columns, fields, 'Indice', null);
                setFieldIfPresent(listePlanContext.columns, fields, 'DateDiffusion', null);
                return ["AddRecord", listePlanContext.tableName, null, fields];
            });

            if (listePlanActions.length > 0) {
                await grist.docApi.applyUserActions(listePlanActions);
            }

            const planningContext = await fetchFirstAvailableTable(PLANNING_TABLE_CANDIDATES);
            const planningActions = [];
            const uniqueZones = [...new Set(
                projectData.documents
                    .map((doc) => normalizeZoneValue(doc.zone))
                    .filter(Boolean)
            )].sort((left, right) => left.localeCompare(right, 'fr', {
                sensitivity: 'base',
                numeric: true
            }));

            uniqueZones.forEach((zoneName) => {
                if (!planningZoneExists(planningContext.data, projectData.name, zoneName)) {
                    planningActions.push([
                        "AddRecord",
                        planningContext.tableName,
                        null,
                        buildPlanningZoneAnchorFields(planningContext.columns, projectData.name, zoneName)
                    ]);
                }
            });

            projectData.documents.forEach((doc) => {
                const numeroText = String(doc.numero ?? '').trim();
                const fields = {};

                setFieldIfPresent(planningContext.columns, fields, 'NomProjet', projectData.name);
                setFieldIfPresent(planningContext.columns, fields, 'ID2', numeroText);
                setFieldIfPresent(planningContext.columns, fields, 'Taches', doc.name);
                setFieldIfPresent(planningContext.columns, fields, 'Tache', doc.name);
                setFieldIfPresent(planningContext.columns, fields, 'Type_doc', doc.type || 'COFFRAGE');
                setFieldIfPresent(planningContext.columns, fields, 'Indice', '');
                setFieldIfPresent(planningContext.columns, fields, 'Groupe', '');
                setFieldIfPresent(planningContext.columns, fields, 'Zone', normalizeZoneValue(doc.zone));

                planningActions.push(["AddRecord", planningContext.tableName, null, fields]);
            });

            if (planningActions.length > 0) {
                await grist.docApi.applyUserActions(planningActions);
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
