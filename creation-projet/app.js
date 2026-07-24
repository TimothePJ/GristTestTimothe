document.addEventListener('DOMContentLoaded', () => {
    const steps = document.querySelectorAll('.wizard-step');
    const EMETTEURS_TABLE = 'Emetteurs';
    const DOP_REGISTRY_ROW_ID = 1;
    const DOP_COLUMN = 'DOP';
    const DEFAULT_DOP_VALUES = ['1', '2', '3', '4', '5'];
    const DOP_DATA_CHANGE_STORAGE_KEY = 'grist.dop-data-changed';
    let currentStep = 1;
    let teamMembers = [];
    let dopRegistryValues = [...DEFAULT_DOP_VALUES];
    let dopRegistryLoadPromise = null;
    let dopRegistryReloadTimer = 0;
    let emittersTableFetchPromise = null;
    const DEFAULT_BUDGET_CHAPTERS = [
        '01-Analyse Dossier-Organisation',
        '02-Réunions-Visite sur chantier',
        '03-Fond de plans',
        '04-Plan de coffrage',
        '05-Plan de démolition',
        "06-Plan d'armature",
        '07-Note de calcul',
        '08-Modélisation-Calcul',
        '09-Etude ouvrages provisoires',
        '10-DOE',
        '11-Sous-traitance-Calculs',
        '12-Sous-traitance-Armatures',
        '13-Base',
        '14-Travaux supplémentaires'
    ];
    function createDefaultBudgetLines() {
        return DEFAULT_BUDGET_CHAPTERS.map((chapter) => ({
            chapter,
            amount: 0
        }));
    }

    let projectData = {
        name: '',
        number: '',
        dop: '',
        budgetTotalIndicatif: null,
        budgetLines: createDefaultBudgetLines(),
        team: [],
        documents: [],
        emitters: []
    };
    let projectTypeDocSuggestions = [];

    function cleanProjectName(name) {
        return String(name ?? "").replace(/\s+$/g, "");
    }

    function normalizeDopValue(value) {
        return String(value ?? '').replace(/^dop\s*/i, '').trim();
    }

    function normalizeDopKey(value) {
        return normalizeDopValue(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('fr');
    }

    function parseDopRegistryValue(value) {
        let values = [];
        if (Array.isArray(value)) {
            values = value[0] === 'L' ? value.slice(1) : value;
        } else if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    values = Array.isArray(parsed) ? parsed : [trimmed];
                } catch (_error) {
                    values = trimmed.split(/[,;\n]+/);
                }
            } else {
                values = trimmed.split(/[,;\n]+/);
            }
        } else if (value != null) {
            values = [value];
        }

        const byKey = new Map();
        values.forEach((item) => {
            const dop = normalizeDopValue(item);
            const key = normalizeDopKey(dop);
            if (key && !byKey.has(key)) byKey.set(key, dop);
        });

        return [...byKey.values()].sort((left, right) =>
            left.localeCompare(right, 'fr', { numeric: true, sensitivity: 'base' })
        );
    }

    function serializeDopRegistryValue(values) {
        return parseDopRegistryValue(values).join(', ');
    }

    function formatDopLabel(value) {
        const dop = normalizeDopValue(value);
        return dop ? `DOP ${dop}` : 'Sans DOP';
    }

    function emitDopDataChange(reason) {
        try {
            localStorage.setItem(DOP_DATA_CHANGE_STORAGE_KEY, JSON.stringify({
                reason,
                timestamp: Date.now()
            }));
        } catch (_error) {}
    }

    function fetchEmittersTable() {
        if (!emittersTableFetchPromise) {
            emittersTableFetchPromise = grist.docApi.fetchTable(EMETTEURS_TABLE)
                .finally(() => {
                    emittersTableFetchPromise = null;
                });
        }
        return emittersTableFetchPromise;
    }

    function renderDopSelect() {
        const select = document.getElementById('project-dop');
        if (!(select instanceof HTMLSelectElement)) return;

        const selectedDop = normalizeDopValue(select.value || projectData.dop);
        select.innerHTML = '';

        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'Sans DOP';
        select.appendChild(emptyOption);

        dopRegistryValues.forEach((dop) => {
            const option = document.createElement('option');
            option.value = dop;
            option.textContent = formatDopLabel(dop);
            select.appendChild(option);
        });

        const selectedKey = normalizeDopKey(selectedDop);
        const resolvedDop = dopRegistryValues.find(
            (dop) => normalizeDopKey(dop) === selectedKey
        ) || '';
        select.value = resolvedDop;
        projectData.dop = resolvedDop;
    }

    async function loadDopRegistry() {
        if (dopRegistryLoadPromise) return dopRegistryLoadPromise;

        dopRegistryLoadPromise = (async () => {
            try {
                const table = await fetchEmittersTable();
                const ids = getTableColumnArray(table, 'id');
                const dopValues = getTableColumnArray(table, DOP_COLUMN);
                const registryIndex = ids.findIndex(
                    (id) => Number(id) === DOP_REGISTRY_ROW_ID
                );
                if (registryIndex === -1) {
                    throw new Error(`Ligne id ${DOP_REGISTRY_ROW_ID} introuvable dans ${EMETTEURS_TABLE}.`);
                }

                const configuredValues = parseDopRegistryValue(dopValues[registryIndex]);
                if (configuredValues.length) {
                    dopRegistryValues = configuredValues;
                } else {
                    dopRegistryValues = [...DEFAULT_DOP_VALUES];
                    await grist.docApi.applyUserActions([
                        ['UpdateRecord', EMETTEURS_TABLE, DOP_REGISTRY_ROW_ID, {
                            [DOP_COLUMN]: serializeDopRegistryValue(dopRegistryValues)
                        }]
                    ]);
                    emitDopDataChange('registry-initialized');
                }
            } catch (error) {
                dopRegistryValues = [...DEFAULT_DOP_VALUES];
                console.warn('Impossible de charger le referentiel DOP, valeurs par defaut utilisees.', error);
            }

            renderDopSelect();
            return dopRegistryValues;
        })();

        try {
            return await dopRegistryLoadPromise;
        } finally {
            dopRegistryLoadPromise = null;
        }
    }

    function scheduleDopRegistryReload() {
        if (dopRegistryReloadTimer) window.clearTimeout(dopRegistryReloadTimer);
        dopRegistryReloadTimer = window.setTimeout(() => {
            dopRegistryReloadTimer = 0;
            loadDopRegistry();
        }, 100);
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

    function parseBudgetNumberInput(value) {
        const text = String(value ?? '').trim().replace(',', '.');
        if (!text) {
            return null;
        }

        const numericValue = Number(text);
        return Number.isFinite(numericValue) ? numericValue : null;
    }

    function formatNumberForInput(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return '';
        }

        return String(Math.round(numericValue * 100) / 100);
    }

    function formatBudgetPercentage(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return '';
        }

        return new Intl.NumberFormat('fr-FR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        })
            .format(numericValue)
            .replace(/\u202f/g, ' ')
            .replace(/\u00a0/g, ' ');
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

    function normalizeTeamIdentityPart(value) {
        return normalizeText(value)
            .replace(/\s+/g, ' ')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('fr');
    }

    function getTeamMemberRole(member = {}) {
        return normalizeText(member.Role) || 'Non assigné';
    }

    function getTeamMemberDisplayName(member = {}) {
        return [
            normalizeText(member.Prenom),
            normalizeText(member.Nom)
        ].filter(Boolean).join(' ');
    }

    function buildTeamMemberIdentityKey(member = {}) {
        return [
            normalizeTeamIdentityPart(getTeamMemberRole(member)),
            normalizeTeamIdentityPart(member.Prenom),
            normalizeTeamIdentityPart(member.Nom)
        ].join('||');
    }

    function compareTeamMembers(left = {}, right = {}) {
        const options = { sensitivity: 'base', numeric: true };
        return getTeamMemberDisplayName(left).localeCompare(getTeamMemberDisplayName(right), 'fr', options) ||
            normalizeText(left.Nom).localeCompare(normalizeText(right.Nom), 'fr', options) ||
            normalizeText(left.Prenom).localeCompare(normalizeText(right.Prenom), 'fr', options) ||
            String(left.id ?? '').localeCompare(String(right.id ?? ''), 'fr', options);
    }

    function groupTeamMembersByRole(members = []) {
        const groupedByRole = new Map();
        const seen = new Set();

        (members || []).forEach((member) => {
            const role = getTeamMemberRole(member);
            const memberWithRole = { ...member, Role: role };
            const identityKey = buildTeamMemberIdentityKey(memberWithRole);
            if (!getTeamMemberDisplayName(memberWithRole) || seen.has(identityKey)) {
                return;
            }

            seen.add(identityKey);
            if (!groupedByRole.has(role)) {
                groupedByRole.set(role, []);
            }
            groupedByRole.get(role).push(memberWithRole);
        });

        groupedByRole.forEach((membersForRole) => {
            membersForRole.sort(compareTeamMembers);
        });

        return groupedByRole;
    }

    function getSelectedTeamMembers() {
        const selectedIds = new Set((projectData.team || []).map((id) => String(id)));
        const selectedMembers = (teamMembers || []).filter((member) => selectedIds.has(String(member.id)));
        return Array.from(groupTeamMembersByRole(selectedMembers).values()).flat();
    }

    const LISTEPLAN_TABLE_CANDIDATES = [
        'ListePlan_NDC_COF',
        'ListePlan NDC+COF',
        'ListePlan_NDC+COF'
    ];
    const PLANNING_TABLE_CANDIDATES = ['Planning_Projet', 'Planning_Project'];
    const DEFAULT_DOCUMENT_TYPES = [
        'COFFRAGE',
        'ARMATURES',
        'COUPES',
        'DÉMOLITION',
        'NDC'
    ];

    function normalizeText(value) {
        return String(value ?? '').trim();
    }

    function normalizeDocumentType(value) {
        return normalizeText(value).toLocaleUpperCase('fr');
    }

    function escapeReviewHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getDocumentTypeSortRank(type) {
        const normalizedType = normalizeDocumentType(type);
        const defaultTypeIndex = DEFAULT_DOCUMENT_TYPES.indexOf(normalizedType);
        return defaultTypeIndex === -1 ? DEFAULT_DOCUMENT_TYPES.length : defaultTypeIndex;
    }

    function compareProjectDocuments(left = {}, right = {}) {
        const leftType = normalizeDocumentType(left.type || 'COFFRAGE') || 'AUTRE';
        const rightType = normalizeDocumentType(right.type || 'COFFRAGE') || 'AUTRE';
        const typeRankDifference =
            getDocumentTypeSortRank(leftType) - getDocumentTypeSortRank(rightType);
        if (typeRankDifference !== 0) return typeRankDifference;

        const typeDifference = leftType.localeCompare(rightType, 'fr', {
            sensitivity: 'base',
            numeric: true
        });
        if (typeDifference !== 0) return typeDifference;

        const leftZone = normalizeZoneValue(left.zone);
        const rightZone = normalizeZoneValue(right.zone);
        const leftWithoutZone = leftZone ? 0 : 1;
        const rightWithoutZone = rightZone ? 0 : 1;
        if (leftWithoutZone !== rightWithoutZone) {
            return leftWithoutZone - rightWithoutZone;
        }

        const zoneDifference = formatZoneLabel(leftZone).localeCompare(
            formatZoneLabel(rightZone),
            'fr',
            { sensitivity: 'base', numeric: true }
        );
        if (zoneDifference !== 0) return zoneDifference;

        const numberDifference = normalizeText(left.numero).localeCompare(
            normalizeText(right.numero),
            'fr',
            { sensitivity: 'base', numeric: true }
        );
        if (numberDifference !== 0) return numberDifference;

        return normalizeText(left.name).localeCompare(normalizeText(right.name), 'fr', {
            sensitivity: 'base',
            numeric: true
        });
    }

    function buildReviewDocumentsHtml(documents = []) {
        const sortedDocuments = [...(Array.isArray(documents) ? documents : [])]
            .sort(compareProjectDocuments);
        if (!sortedDocuments.length) {
            return '<p>-</p>';
        }

        const rowsHtml = sortedDocuments.map((documentEntry) => {
            const type = normalizeDocumentType(documentEntry?.type || 'COFFRAGE') || 'AUTRE';
            const zone = formatZoneLabel(documentEntry?.zone);
            const numero = normalizeText(documentEntry?.numero) || '-';
            const name = normalizeText(documentEntry?.name) || '-';

            return `
                <tr>
                    <td class="review-documents-table__type">${escapeReviewHtml(type)}</td>
                    <td class="review-documents-table__zone">${escapeReviewHtml(zone)}</td>
                    <td class="review-documents-table__numero">${escapeReviewHtml(numero)}</td>
                    <td class="review-documents-table__name">${escapeReviewHtml(name)}</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="review-documents-table-scroll">
                <table class="review-documents-table">
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Zone</th>
                            <th>N&deg; document</th>
                            <th>Document</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        `;
    }

    function isCoffrageDocumentType(typeDoc) {
        const normalizedType = normalizeDocumentType(typeDoc);
        return normalizedType.includes('COFFRAGE') || normalizedType.includes('COF');
    }

    function getPlanningProjectColumnFromData(planningData = {}) {
        if (Array.isArray(planningData?.NomProjet)) return 'NomProjet';
        if (Array.isArray(planningData?.Nom_projet)) return 'Nom_projet';
        return 'NomProjet';
    }

    function collectProjectPlanningGroups(planningData, projectName, service) {
        const projectCol = getPlanningProjectColumnFromData(planningData);
        const projects = getTableColumnArray(planningData, projectCol);
        const groups = getTableColumnArray(planningData, 'Groupe');
        const services = getTableColumnArray(planningData, 'Service');
        const projectKey = normalizeText(projectName).toLowerCase();
        const serviceKey = normalizeText(service).toLowerCase();
        const usedGroups = new Set();

        for (let index = 0; index < Math.max(projects.length, groups.length, services.length); index += 1) {
            if (normalizeText(projects[index]).toLowerCase() !== projectKey) continue;
            if (normalizeText(services[index]).toLowerCase() !== serviceKey) continue;

            const group = normalizeText(groups[index]);
            if (group) usedGroups.add(group.toLowerCase());
        }

        return usedGroups;
    }

    function getNextAvailablePlanningGroupNumber(planningData, projectName, service, usedGroups = null) {
        const existingGroups = usedGroups || collectProjectPlanningGroups(planningData, projectName, service);
        let nextGroupNumber = 1;

        while (existingGroups.has(String(nextGroupNumber).toLowerCase())) {
            nextGroupNumber += 1;
        }

        const candidate = String(nextGroupNumber);
        existingGroups.add(candidate.toLowerCase());
        return candidate;
    }

    function getDefaultPlanningGroupForType(typeDoc, planningData = null, projectName = '', service = '', usedGroups = null) {
        return isCoffrageDocumentType(typeDoc)
            ? getNextAvailablePlanningGroupNumber(planningData, projectName, service, usedGroups)
            : '';
    }

    function normalizeDocumentNumberPadding(value) {
        const numericValue = Number.parseInt(value, 10);
        if (!Number.isFinite(numericValue)) {
            return 3;
        }

        return Math.max(3, numericValue);
    }

    function normalizeZoneValue(value) {
        const text = normalizeText(value);
        if (!text) return '';
        return text.toLowerCase() === 'sans zone' ? '' : text;
    }

    function normalizeZoneMatchKey(value) {
        return normalizeZoneValue(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('fr')
            .replace(/[^a-z0-9]/g, '');
    }

    function resolveCanonicalZoneValue(value, sourceZones = []) {
        const normalizedZone = normalizeZoneValue(value);
        const zoneKey = normalizeZoneMatchKey(normalizedZone);
        if (!zoneKey) return '';

        const matchingZone = (sourceZones || [])
            .map((zone) => normalizeZoneValue(zone))
            .find((zone) => normalizeZoneMatchKey(zone) === zoneKey);

        return matchingZone || normalizedZone;
    }

    function resolveProjectDocumentZone(value) {
        return resolveCanonicalZoneValue(value, customDocuments.map((doc) => doc?.zone));
    }

    function formatZoneLabel(value) {
        return normalizeZoneValue(value) || 'Sans zone';
    }

    function isDefaultDocumentType(value) {
        return DEFAULT_DOCUMENT_TYPES.includes(normalizeDocumentType(value));
    }

    function parseProjectTypeDocValue(value) {
        const seen = new Set();
        return String(value ?? '')
            .split(/[;,\r\n]+/)
            .map((entry) => normalizeDocumentType(entry))
            .filter((entry) => {
                if (!entry || isDefaultDocumentType(entry) || seen.has(entry)) return false;
                seen.add(entry);
                return true;
            });
    }

    function collectCustomDocumentTypes(entries = customDocuments) {
        const seen = new Set();
        return (entries || [])
            .map((entry) => normalizeDocumentType(typeof entry === 'string' ? entry : entry?.type))
            .filter((type) => {
                if (!type || isDefaultDocumentType(type) || seen.has(type)) return false;
                seen.add(type);
                return true;
            });
    }

    function serializeProjectTypeDocValue(entries = customDocuments) {
        return collectCustomDocumentTypes(entries).join('; ');
    }

    function collectAvailableDocumentTypes(extraTypes = []) {
        const seen = new Set();
        const orderedTypes = [];

        [...DEFAULT_DOCUMENT_TYPES, ...extraTypes].forEach((type) => {
            const normalized = normalizeDocumentType(type);
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            orderedTypes.push(normalized);
        });

        return orderedTypes;
    }

    function refreshDocumentTypeSuggestionLists() {
        const types = collectAvailableDocumentTypes([
            ...projectTypeDocSuggestions,
            ...customDocuments.map((doc) => doc?.type)
        ]);
        ['manual-doc-type-list', 'pattern-doc-type-list'].forEach((listId) => {
            const datalist = document.getElementById(listId);
            if (!(datalist instanceof HTMLDataListElement)) return;
            datalist.innerHTML = '';
            types.forEach((type) => {
                const option = document.createElement('option');
                option.value = type;
                datalist.appendChild(option);
            });
        });
    }

    async function refreshProjectTypeDocSuggestions() {
        try {
            const projetsTable = await grist.docApi.fetchTable('Projets2');
            const names = getTableColumnArray(projetsTable, 'Nom_de_projet');
            const numbers = getTableColumnArray(projetsTable, 'Numero_de_projet');
            const typeDocs = getTableColumnArray(projetsTable, 'TypeDoc');
            const projectName = normalizeText(projectData.name).toLocaleLowerCase('fr');
            const projectNumber = normalizeText(projectData.number).toLocaleLowerCase('fr');
            const seen = new Set();
            const nextTypes = [];

            for (let index = 0; index < Math.max(names.length, numbers.length, typeDocs.length); index += 1) {
                const nameMatches =
                    projectName &&
                    normalizeText(names[index]).toLocaleLowerCase('fr') === projectName;
                const numberMatches =
                    projectNumber &&
                    normalizeText(numbers[index]).toLocaleLowerCase('fr') === projectNumber;
                if (!nameMatches && !numberMatches) continue;

                parseProjectTypeDocValue(typeDocs[index]).forEach((type) => {
                    if (seen.has(type)) return;
                    seen.add(type);
                    nextTypes.push(type);
                });
            }

            projectTypeDocSuggestions = nextTypes;
        } catch (_error) {
            projectTypeDocSuggestions = [];
        }
        refreshDocumentTypeSuggestionLists();
    }

    function normalizeDocumentTypeInput(inputElement) {
        if (!(inputElement instanceof HTMLInputElement)) return;
        inputElement.value = normalizeDocumentType(inputElement.value);
    }

    function normalizeAlphabetLetter(value, fallbackValue) {
        const text = String(value ?? '').trim().toLocaleUpperCase('fr');
        const match = text.match(/[A-Z]/);
        return match ? match[0] : fallbackValue;
    }

    function getAlphabetRangeValues(startValue, endValue) {
        const startLetter = normalizeAlphabetLetter(startValue, 'A');
        const endLetter = normalizeAlphabetLetter(endValue, 'E');
        const startCode = startLetter.charCodeAt(0);
        const endCode = endLetter.charCodeAt(0);

        if (startCode > endCode) {
            return {
                error: 'Erreur: "De" doit etre inferieur ou egal a "A".',
                values: []
            };
        }

        const values = [];
        for (let code = startCode; code <= endCode; code += 1) {
            values.push(String.fromCharCode(code));
        }

        return { error: '', values };
    }

    function normalizeDocumentIdentityPart(value) {
        return normalizeText(value)
            .replace(/\s+/g, ' ')
            .toLocaleLowerCase('fr');
    }

    function buildDocumentIdentityKey(doc = {}) {
        return [
            normalizeDocumentIdentityPart(doc.numero),
            normalizeDocumentIdentityPart(normalizeDocumentType(doc.type))
        ].join('||');
    }

    function buildDocumentNumeroScopeKey(doc = {}) {
        return buildDocumentIdentityKey(doc);
    }

    function collectCustomDocumentZones() {
        const seen = new Set();
        return customDocuments
            .map((doc) => normalizeZoneValue(doc?.zone))
            .filter((zone) => {
                const zoneKey = normalizeZoneMatchKey(zone);
                if (!zoneKey || seen.has(zoneKey)) return false;
                seen.add(zoneKey);
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

    async function assertProjectCreationDocumentIdentitiesAvailable(projectName, documents = [], service = '') {
        const serviceKey = normalizeText(service).toLowerCase();
        if (!serviceKey) {
            throw new Error('Le service est obligatoire pour controler les documents existants.');
        }
        const requestedIdentities = new Map();
        for (const doc of documents) {
            const documentIdentity = {
                numero: normalizeText(doc?.numero),
                name: normalizeText(doc?.name),
                type: normalizeDocumentType(doc?.type),
            };
            if (!documentIdentity.numero || !documentIdentity.name || !documentIdentity.type) {
                throw new Error('Le numero, le nom et le type du document sont obligatoires.');
            }
            const identityKey = buildDocumentIdentityKey(documentIdentity);
            if (requestedIdentities.has(identityKey)) {
                throw new Error(
                    `Le numero de document "${documentIdentity.numero}" est saisi plusieurs fois pour le type "${documentIdentity.type}".`
                );
            }
            requestedIdentities.set(identityKey, documentIdentity);
        }

        const [listePlanContext, projects] = await Promise.all([
            fetchFirstAvailableTable(LISTEPLAN_TABLE_CANDIDATES),
            grist.docApi.fetchTable('Projets2')
        ]);
        const projectAliases = new Set([normalizeDocumentIdentityPart(projectName)]);
        const projectNames = projects.Nom_de_projet || [];
        const projectIds = projects.id || [];
        for (let index = 0; index < Math.max(projectNames.length, projectIds.length); index += 1) {
            if (
                normalizeDocumentIdentityPart(projectNames[index]) !==
                normalizeDocumentIdentityPart(projectName)
            ) continue;
            projectAliases.add(normalizeDocumentIdentityPart(projectIds[index]));
        }

        const rowProjects =
            listePlanContext.data.Nom_projet ||
            listePlanContext.data.NomProjet ||
            listePlanContext.data.NomProjetString ||
            [];
        const rowNumbers = listePlanContext.data.NumeroDocument || [];
        const rowTypes = listePlanContext.data.Type_document || listePlanContext.data.Type_doc || [];
        const rowServices = listePlanContext.data.Service || [];
        for (let index = 0; index < Math.max(rowProjects.length, rowNumbers.length, rowTypes.length, rowServices.length); index += 1) {
            const rowService = normalizeText(rowServices[index]);
            if (rowService.toLowerCase() !== serviceKey) continue;
            if (!projectAliases.has(normalizeDocumentIdentityPart(rowProjects[index]))) continue;
            if (
                !normalizeDocumentIdentityPart(rowNumbers[index]) ||
                !normalizeDocumentIdentityPart(rowTypes[index])
            ) continue;
            const rowIdentity = {
                numero: rowNumbers[index],
                type: rowTypes[index],
            };
            if (requestedIdentities.has(buildDocumentIdentityKey(rowIdentity))) {
                throw new Error(
                    `Le numero de document "${rowIdentity.numero}" existe deja pour le type "${rowIdentity.type}" dans ce projet.`
                );
            }
        }
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

    function planningZoneExists(planningData, projectName, zoneName, service) {
        const normalizedZone = normalizeZoneValue(zoneName);
        if (!normalizedZone) return true;

        const projects = getTableColumnArray(planningData, 'NomProjet');
        const zones = getTableColumnArray(planningData, 'Zone');
        const services = getTableColumnArray(planningData, 'Service');

        for (let index = 0; index < Math.max(projects.length, zones.length, services.length); index += 1) {
            if (
                normalizeText(projects[index]).toLowerCase() === normalizeText(projectName).toLowerCase() &&
                normalizeZoneMatchKey(zones[index]) === normalizeZoneMatchKey(normalizedZone) &&
                normalizeText(services[index]).toLowerCase() === normalizeText(service).toLowerCase()
            ) {
                return true;
            }
        }

        return false;
    }

    function buildPlanningZoneAnchorFields(columnNames, projectName, zoneName, service) {
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
        setFieldIfPresent(columnNames, fields, 'Service', service);

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
        projectData.dop = normalizeDopValue(document.getElementById('project-dop')?.value);

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
        if (hasInlineBudgetLineEdit()) {
            alert('Enregistrez ou annulez la ligne de budget en cours de modification.');
            return;
        }

        if (hasBudgetLineDraft() && !saveBudgetLineFromInputs()) {
            return;
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
            alert("Des numeros de document sont en doublon pour un meme type");
            return;
        }

        renderReview();
        showStep(5);
    });

    document.getElementById('prev-to-step-4').addEventListener('click', () => showStep(4));

    // Budget Lines
    const addBudgetLineBtn = document.getElementById('add-budget-line-btn');
    const budgetLinesContainer = document.getElementById('budget-lines-container');
    const budgetSummary = document.getElementById('budget-summary');
    const budgetTotalIndicatifInput = document.getElementById('budget-total-indicatif');
    const budgetChaptersList = document.getElementById('budget-chapters-list');
    const budgetChapterInput = document.getElementById('budget-chapter');
    const budgetPercentageInput = document.getElementById('budget-percentage');
    const budgetAmountInput = document.getElementById('budget-amount');
    let editingBudgetLineIndex = null;
    let budgetLineInputSource = 'amount';

    function normalizeBudgetChapterKey(chapter) {
        return String(chapter ?? '').trim().toLowerCase();
    }

    function isDefaultBudgetChapter(chapter) {
        const chapterKey = normalizeBudgetChapterKey(chapter);
        return DEFAULT_BUDGET_CHAPTERS.some((defaultChapter) => {
            return normalizeBudgetChapterKey(defaultChapter) === chapterKey;
        });
    }

    function renderBudgetChapterOptions() {
        if (!(budgetChaptersList instanceof HTMLDataListElement)) {
            return;
        }

        budgetChaptersList.innerHTML = '';
        const existingChapterKeys = new Set(
            (projectData.budgetLines || []).map((line) =>
                normalizeBudgetChapterKey(line?.chapter)
            )
        );

        DEFAULT_BUDGET_CHAPTERS
            .filter((chapter) => !existingChapterKeys.has(normalizeBudgetChapterKey(chapter)))
            .forEach((chapter) => {
                const option = document.createElement('option');
                option.value = chapter;
                budgetChaptersList.appendChild(option);
            });
    }

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

    function findDuplicateBudgetChapterIndex(chapter, ignoredIndex = null) {
        const chapterKey = normalizeBudgetChapterKey(chapter);
        if (!chapterKey) {
            return -1;
        }

        return projectData.budgetLines.findIndex((line, index) => {
            if (Number.isInteger(ignoredIndex) && index === ignoredIndex) {
                return false;
            }

            return normalizeBudgetChapterKey(line?.chapter) === chapterKey;
        });
    }

    function getBudgetTotalIndicatif() {
        const inputAmount = parseBudgetNumberInput(budgetTotalIndicatifInput?.value);
        const amount = inputAmount != null ? inputAmount : projectData.budgetTotalIndicatif;
        return Number.isFinite(amount) && amount > 0 ? amount : null;
    }

    function syncProjectBudgetTotalIndicatif() {
        const amount = parseBudgetNumberInput(budgetTotalIndicatifInput?.value);
        projectData.budgetTotalIndicatif =
            amount != null && amount > 0 ? Math.round(amount * 100) / 100 : null;
    }

    function getBudgetLinesTotal() {
        return (projectData.budgetLines || []).reduce((total, line) => {
            const amount = Number(line?.amount);
            return Number.isFinite(amount) ? total + amount : total;
        }, 0);
    }

    function getBudgetLinesForProjectCreation() {
        return (projectData.budgetLines || []).filter((line) => {
            return Number(line?.amount) > 0;
        });
    }

    function getBudgetPercentageFromAmount(amount) {
        const totalIndicatif = getBudgetTotalIndicatif();
        const numericAmount = Number(amount);
        if (!totalIndicatif || !Number.isFinite(numericAmount)) {
            return null;
        }

        return (numericAmount / totalIndicatif) * 100;
    }

    function getBudgetAmountFromPercentage(percentage) {
        const totalIndicatif = getBudgetTotalIndicatif();
        const numericPercentage = Number(percentage);
        if (!totalIndicatif || !Number.isFinite(numericPercentage)) {
            return null;
        }

        return (totalIndicatif * numericPercentage) / 100;
    }

    function getBudgetLineDisplayText(line) {
        const amountLabel = `${formatBudgetAmount(line?.amount)} \u20AC`;
        const percentage = getBudgetPercentageFromAmount(line?.amount);
        if (percentage == null) {
            return `${line.chapter}: ${amountLabel}`;
        }

        return `${line.chapter}: ${amountLabel} (${formatBudgetPercentage(percentage)}%)`;
    }

    function renderBudgetSummary() {
        if (!(budgetSummary instanceof HTMLElement)) {
            return;
        }

        budgetSummary.innerHTML = '';

        const totalIndicatif = getBudgetTotalIndicatif();
        const enteredBudget = getBudgetLinesTotal();
        const usagePercent = totalIndicatif ? (enteredBudget / totalIndicatif) * 100 : null;
        const delta = totalIndicatif != null ? totalIndicatif - enteredBudget : null;
        const balanceLabel =
            delta == null
                ? 'Reste indicatif'
                : delta >= 0
                    ? 'Reste indicatif'
                    : 'Dépassement';
        const balanceValue =
            delta == null ? '-' : `${formatBudgetAmount(Math.abs(delta))} \u20AC`;
        const items = [
            {
                label: 'Budget total indicatif',
                value: totalIndicatif == null ? 'Non renseigné' : `${formatBudgetAmount(totalIndicatif)} \u20AC`
            },
            {
                label: 'Budget saisi',
                value: `${formatBudgetAmount(enteredBudget)} \u20AC`
            },
            {
                label: balanceLabel,
                value: balanceValue,
                className: delta != null && delta < 0 ? 'is-over-budget' : ''
            },
            {
                label: '% utilisé',
                value: usagePercent == null ? '-' : `${formatBudgetPercentage(usagePercent)}%`,
                className: usagePercent != null && usagePercent > 100 ? 'is-over-budget' : ''
            }
        ];

        items.forEach((item) => {
            const card = document.createElement('div');
            card.className = 'budget-summary-item';
            if (item.className) {
                card.classList.add(item.className);
            }

            const label = document.createElement('span');
            label.className = 'budget-summary-label';
            label.textContent = item.label;

            const value = document.createElement('strong');
            value.textContent = item.value;

            card.appendChild(label);
            card.appendChild(value);
            budgetSummary.appendChild(card);
        });
    }

    function syncBudgetPercentageFromAmount() {
        if (!(budgetPercentageInput instanceof HTMLInputElement)) {
            return;
        }

        const amount = parseBudgetNumberInput(budgetAmountInput?.value);
        const percentage = amount != null && amount >= 0
            ? getBudgetPercentageFromAmount(amount)
            : null;
        budgetPercentageInput.value =
            percentage == null ? '' : formatNumberForInput(percentage);
    }

    function syncBudgetAmountFromPercentage() {
        if (!(budgetAmountInput instanceof HTMLInputElement)) {
            return;
        }

        const percentage = parseBudgetNumberInput(budgetPercentageInput?.value);
        const amount = percentage != null && percentage >= 0
            ? getBudgetAmountFromPercentage(percentage)
            : null;
        if (amount != null) {
            budgetAmountInput.value = formatNumberForInput(amount);
        }
    }

    function hasBudgetLineDraft() {
        return Boolean(
            budgetChapterInput.value.trim() ||
            budgetAmountInput.value.trim() ||
            budgetPercentageInput.value.trim()
        );
    }

    function hasInlineBudgetLineEdit() {
        return (
            Number.isInteger(editingBudgetLineIndex) &&
            editingBudgetLineIndex >= 0 &&
            editingBudgetLineIndex < projectData.budgetLines.length
        );
    }

    function resetBudgetLineForm() {
        budgetChapterInput.value = '';
        budgetPercentageInput.value = '';
        budgetAmountInput.value = '';
        budgetLineInputSource = 'amount';
        addBudgetLineBtn.textContent = 'Ajouter Ligne';
    }

    function buildBudgetLineFromValues({
        chapterValue,
        amountValue,
        percentageValue,
        ignoredIndex = null
    } = {}) {
        const chapter = String(chapterValue ?? '').trim();
        const amount = parseBudgetNumberInput(amountValue);
        const percentage = parseBudgetNumberInput(percentageValue);
        const totalIndicatif = getBudgetTotalIndicatif();

        if (amount != null && amount < 0) {
            alert('Le montant ne peut pas être négatif.');
            return false;
        }

        if (percentage != null && percentage < 0) {
            alert('Le pourcentage ne peut pas être négatif.');
            return false;
        }

        let resolvedAmount = amount;
        if (resolvedAmount == null && percentage != null && totalIndicatif) {
            resolvedAmount = getBudgetAmountFromPercentage(percentage);
        }

        if (!chapter || resolvedAmount == null || !Number.isFinite(resolvedAmount)) {
            if (chapter && percentage != null && !totalIndicatif) {
                alert('Renseignez un budget total indicatif ou saisissez un montant.');
            }
            return null;
        }

        const duplicateIndex = findDuplicateBudgetChapterIndex(
            chapter,
            ignoredIndex
        );
        if (duplicateIndex !== -1) {
            alert('Ce chapitre existe déjà. Utilisez Modifier sur la ligne existante.');
            return null;
        }

        return {
            chapter,
            amount: Math.round(resolvedAmount * 100) / 100
        };
    }

    function saveBudgetLineFromInputs() {
        if (hasInlineBudgetLineEdit()) {
            alert('Enregistrez ou annulez la ligne de budget en cours de modification.');
            return false;
        }

        const nextLine = buildBudgetLineFromValues({
            chapterValue: budgetChapterInput.value,
            amountValue: budgetAmountInput.value,
            percentageValue: budgetPercentageInput.value
        });

        if (!nextLine) {
            return false;
        }

        projectData.budgetLines.push(nextLine);
        sortBudgetLines();
        resetBudgetLineForm();
        renderBudgetLines();
        renderBudgetSummary();
        return true;
    }

    function saveInlineBudgetLine(index, rowEl) {
        const chapterInput = rowEl?.querySelector('.budget-line-chapter-input');
        const percentageInput = rowEl?.querySelector('.budget-line-percentage-input');
        const amountInput = rowEl?.querySelector('.budget-line-amount-input');
        const currentLine = projectData.budgetLines[index];

        const nextLine = buildBudgetLineFromValues({
            chapterValue: isDefaultBudgetChapter(currentLine?.chapter)
                ? currentLine?.chapter
                : chapterInput?.value,
            amountValue: amountInput?.value,
            percentageValue: percentageInput?.value,
            ignoredIndex: index
        });

        if (!nextLine) {
            return false;
        }

        projectData.budgetLines[index] = nextLine;
        editingBudgetLineIndex = null;
        sortBudgetLines();
        renderBudgetLines();
        renderBudgetSummary();
        return true;
    }

    if (budgetTotalIndicatifInput) {
        budgetTotalIndicatifInput.addEventListener('input', () => {
            syncProjectBudgetTotalIndicatif();

            if (budgetLineInputSource === 'percentage') {
                syncBudgetAmountFromPercentage();
            } else {
                syncBudgetPercentageFromAmount();
            }

            renderBudgetLines();
            renderBudgetSummary();
        });
    }

    if (budgetChapterInput && budgetAmountInput && budgetPercentageInput) {
        budgetChapterInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                // If chapter is blank, click Suivant to go to next step
                if (!budgetChapterInput.value.trim()) {
                    document.getElementById('next-to-step-3').click();
                } else {
                    budgetPercentageInput.focus();
                    budgetPercentageInput.select();
                }
            }
        });

        budgetPercentageInput.addEventListener('input', () => {
            budgetLineInputSource = 'percentage';
            syncBudgetAmountFromPercentage();
        });

        budgetPercentageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                budgetAmountInput.focus();
                budgetAmountInput.select();
            }
        });

        budgetAmountInput.addEventListener('input', () => {
            budgetLineInputSource = 'amount';
            syncBudgetPercentageFromAmount();
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
        renderBudgetChapterOptions();

        projectData.budgetLines.forEach((line, index) => {
            const row = document.createElement('div');
            row.className = 'budget-line';
            if (editingBudgetLineIndex === index) {
                row.classList.add('is-editing');
            }

            const actions = document.createElement('div');
            actions.className = 'budget-line-actions';

            const del = document.createElement('button');
            del.className = 'budget-line-delete';
            del.type = 'button';
            del.title = 'Supprimer cette ligne';
            del.textContent = '✖';

            del.addEventListener('click', () => {
                projectData.budgetLines.splice(index, 1);

                if (editingBudgetLineIndex === index) {
                    editingBudgetLineIndex = null;
                    resetBudgetLineForm();
                } else if (
                    Number.isInteger(editingBudgetLineIndex) &&
                    editingBudgetLineIndex > index
                ) {
                    editingBudgetLineIndex -= 1;
                }

                renderBudgetLines();
                renderBudgetSummary();
            });

            if (editingBudgetLineIndex === index) {
                const fields = document.createElement('div');
                fields.className = 'budget-line-edit-fields';

                const defaultChapterLocked = isDefaultBudgetChapter(line.chapter);
                let chapterInput = null;
                if (defaultChapterLocked) {
                    const lockedChapter = document.createElement('div');
                    lockedChapter.className = 'budget-line-chapter-locked';
                    lockedChapter.textContent = line.chapter || '';
                    lockedChapter.title = 'Chapitre par défaut non modifiable';
                    fields.appendChild(lockedChapter);
                } else {
                    chapterInput = document.createElement('input');
                    chapterInput.className = 'budget-line-chapter-input';
                    chapterInput.type = 'text';
                    chapterInput.setAttribute('list', 'budget-chapters-list');
                    chapterInput.value = line.chapter || '';
                    fields.appendChild(chapterInput);
                }

                const percentageField = document.createElement('div');
                percentageField.className = 'budget-percent-field';
                const percentageInput = document.createElement('input');
                percentageInput.className = 'budget-line-percentage-input';
                percentageInput.type = 'number';
                percentageInput.min = '0';
                percentageInput.step = '0.01';
                const percentage = getBudgetPercentageFromAmount(line.amount);
                percentageInput.value = percentage == null
                    ? ''
                    : formatNumberForInput(percentage);
                percentageField.appendChild(percentageInput);

                const amountField = document.createElement('div');
                amountField.className = 'budget-amount-field';
                const amountInput = document.createElement('input');
                amountInput.className = 'budget-line-amount-input';
                amountInput.type = 'number';
                amountInput.min = '0';
                amountInput.step = '0.01';
                amountInput.value = formatNumberForInput(line.amount);
                amountField.appendChild(amountInput);

                percentageInput.addEventListener('input', () => {
                    const nextPercentage = parseBudgetNumberInput(percentageInput.value);
                    const nextAmount = nextPercentage != null && nextPercentage >= 0
                        ? getBudgetAmountFromPercentage(nextPercentage)
                        : null;
                    if (nextAmount != null) {
                        amountInput.value = formatNumberForInput(nextAmount);
                    }
                });

                amountInput.addEventListener('input', () => {
                    const nextAmount = parseBudgetNumberInput(amountInput.value);
                    const nextPercentage = nextAmount != null && nextAmount >= 0
                        ? getBudgetPercentageFromAmount(nextAmount)
                        : null;
                    percentageInput.value = nextPercentage == null
                        ? ''
                        : formatNumberForInput(nextPercentage);
                });

                const save = document.createElement('button');
                save.className = 'budget-line-save';
                save.type = 'button';
                save.textContent = 'Enregistrer';
                save.addEventListener('click', () => {
                    saveInlineBudgetLine(index, row);
                });

                const cancel = document.createElement('button');
                cancel.className = 'budget-line-cancel';
                cancel.type = 'button';
                cancel.textContent = 'Annuler';
                cancel.addEventListener('click', () => {
                    editingBudgetLineIndex = null;
                    renderBudgetLines();
                });

                if (chapterInput) {
                    chapterInput.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            percentageInput.focus();
                            percentageInput.select();
                        }
                    });
                }
                percentageInput.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        amountInput.focus();
                        amountInput.select();
                    }
                });
                amountInput.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        save.click();
                    }
                });

                fields.appendChild(percentageField);
                fields.appendChild(amountField);
                actions.appendChild(save);
                actions.appendChild(cancel);
                actions.appendChild(del);
                row.appendChild(fields);
            } else {
                const text = document.createElement('span');
                text.className = 'budget-line-text';
                text.textContent = getBudgetLineDisplayText(line);

                const edit = document.createElement('button');
                edit.className = 'budget-line-edit';
                edit.type = 'button';
                edit.title = 'Modifier cette ligne';
                edit.textContent = 'Modifier';

                edit.addEventListener('click', () => {
                    if (hasInlineBudgetLineEdit() && editingBudgetLineIndex !== index) {
                        alert('Enregistrez ou annulez la ligne de budget en cours de modification.');
                        return;
                    }

                    editingBudgetLineIndex = index;
                    renderBudgetLines();
                    const editInput = budgetLinesContainer.querySelector(
                        '.budget-line.is-editing .budget-line-chapter-input, .budget-line.is-editing .budget-line-percentage-input'
                    );
                    if (editInput instanceof HTMLInputElement) {
                        editInput.focus();
                        editInput.select();
                    }
                });

                actions.appendChild(edit);
                actions.appendChild(del);
                row.appendChild(text);
            }

            row.appendChild(actions);
            budgetLinesContainer.appendChild(row);
        });

        renderBudgetSummary();
    }

    renderBudgetLines();

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

        const groupedByRole = groupTeamMembersByRole(teamMembers);

        const teamSelectionContainer = document.getElementById('team-selection-container');
        teamSelectionContainer.innerHTML = '';

        for (const [role, membersForRole] of groupedByRole) {
            const roleTitle = document.createElement('h3');
            roleTitle.textContent = role;
            teamSelectionContainer.appendChild(roleTitle);

            const roleContainer = document.createElement('div');
            roleContainer.classList.add('role-group');
            membersForRole.forEach(member => {
                const label = document.createElement('label');
                label.classList.add('team-member');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = String(member.id);

                const name = document.createElement('span');
                name.className = 'team-member-name';
                name.textContent = getTeamMemberDisplayName(member);

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
        const teamTable = await grist.docApi.fetchTable('Team');
        let rows = [];

        if (Array.isArray(teamTable)) {
            rows = teamTable;
        } else if (Array.isArray(teamTable?.records)) {
            rows = teamTable.records.map((record) => record?.fields ? { id: record.id, ...record.fields } : record);
        } else if (teamTable && typeof teamTable === 'object') {
            const columns = Object.entries(teamTable).filter(([, values]) => Array.isArray(values));
            const rowCount = columns.reduce((count, [, values]) => Math.max(count, values.length), 0);
            rows = Array.from({ length: rowCount }, (_, index) =>
                Object.fromEntries(columns.map(([column, values]) => [column, values[index]]))
            );
        }

        const readableRows = rows.filter((row) => {
            const value = row?.Moi;
            if (value === null || value === undefined || value === '') return false;
            const normalized = String(value).trim().toUpperCase();
            return normalized !== 'C' && normalized !== 'CENSORED';
        });
        if (readableRows.length !== 1) {
            throw new Error(
                readableRows.length === 0
                    ? 'Utilisateur non reconnu dans Team : aucune ligne Moi lisible.'
                    : 'Utilisateur ambigu dans Team : plusieurs lignes Moi sont lisibles.'
            );
        }

        const service = String(readableRows[0]?.Service ?? '').trim();
        if (!service || service.toUpperCase() === 'C' || service.toUpperCase() === 'CENSORED') {
            throw new Error('Le service de l utilisateur connecte est vide ou illisible dans Team.');
        }
        return service;
    }

    function renderReview() {
        const reviewContainer = document.getElementById('review-container');
        sortBudgetLines();

        const docsHtml = buildReviewDocumentsHtml(projectData.documents);

        const emittersHtml = (projectData.emitters && projectData.emitters.length)
            ? projectData.emitters.join(', ')
            : '-';

        // Budget
        syncProjectBudgetTotalIndicatif();
        const budgetTotalIndicatif = getBudgetTotalIndicatif();
        const budgetTotalSaisi = getBudgetLinesTotal();
        const budgetUsage = budgetTotalIndicatif
            ? `${formatBudgetPercentage((budgetTotalSaisi / budgetTotalIndicatif) * 100)}%`
            : '-';
        const budgetDelta = budgetTotalIndicatif == null
            ? null
            : budgetTotalIndicatif - budgetTotalSaisi;
        const budgetDeltaLabel = budgetDelta != null && budgetDelta < 0
            ? 'Dépassement'
            : 'Reste indicatif';
        const budgetDeltaValue = budgetDelta == null
            ? '-'
            : `${formatBudgetAmount(Math.abs(budgetDelta))} €`;
        const savedBudgetLines = getBudgetLinesForProjectCreation();
        const budgetLinesHtml = savedBudgetLines
            .map(line => `<p>${getBudgetLineDisplayText(line)}</p>`)
            .join('');

        // Team
        const groupedByRole = groupTeamMembersByRole(getSelectedTeamMembers());

        let teamHtml = '';
        for (const [role, membersForRole] of groupedByRole) {
            teamHtml += `<h4>${escapeReviewHtml(role)}</h4><ul>`;
            membersForRole.forEach(member => {
                teamHtml += `<li>${escapeReviewHtml(getTeamMemberDisplayName(member))}</li>`;
            });
            teamHtml += `</ul>`;
        }

        reviewContainer.innerHTML = `
            <h3>Détails du Projet</h3>
            <p><strong>Nom:</strong> ${projectData.name}</p>
            <p><strong>Numéro:</strong> ${projectData.number}</p>
            <p><strong>DOP:</strong> ${formatDopLabel(projectData.dop)}</p>

            <h3>Lignes Budgétaires</h3>
            <p><strong>Budget total indicatif:</strong> ${budgetTotalIndicatif == null ? 'Non renseigné' : `${formatBudgetAmount(budgetTotalIndicatif)} €`}</p>
            <p><strong>Budget saisi:</strong> ${formatBudgetAmount(budgetTotalSaisi)} € (${budgetUsage})</p>
            <p><strong>${budgetDeltaLabel}:</strong> ${budgetDeltaValue}</p>
            <p><em>Les lignes à 0 € ne seront pas créées dans le budget du projet.</em></p>
            ${budgetLinesHtml || '<p>-</p>'}

            <h3>Équipe</h3>
            ${teamHtml || '<p>-</p>'}

            <h3>Documents</h3>
            ${docsHtml}

            <h3>Données d'entrée</h3>
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
                            chip.title = `Numero de document duplique pour le type ${type}`;
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
            const zone = resolveProjectDocumentZone(typeof doc === 'string' ? '' : (doc.zone || ''));
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
        const effectiveNumeroPadding = normalizeDocumentNumberPadding(numeroPadding);
        for (let i = start; i <= end; i++) {
            let numStr = String(i);
            if (padding > 0) {
                numStr = numStr.padStart(padding, '0');
            }
            let numeroStr = String(currentNumero);
            if (effectiveNumeroPadding > 0) {
                numeroStr = numeroStr.padStart(effectiveNumeroPadding, '0');
            }
            docs.push({
                name: `${prefix}${numStr}${suffix}`,
                numero: numeroStr,
                type: normalizeDocumentType(type),
                zone: resolveProjectDocumentZone(zone)
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
        const numeroPadding = normalizeDocumentNumberPadding(document.getElementById('numero-padding').value);
        const type = normalizeDocumentType(document.getElementById('pattern-doc-type').value || '');
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
            const numeroPadding = normalizeDocumentNumberPadding(numeroPaddingSelect.value);
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
            numeroPaddingSelect.value = '3';
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
        refreshDocumentTypeSuggestionLists();

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
                            chip.title = `Numero de document duplique pour le type ${typeKey}`;
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
            const zone = resolveProjectDocumentZone(typeof doc === 'string' ? '' : (doc.zone || ''));
            const nextDoc = { name, numero, type, zone };
            if (!name || !type) return;
            if (customDocuments.some((existingDoc) => buildDocumentIdentityKey(existingDoc) === buildDocumentIdentityKey(nextDoc))) {
                return;
            }
            customDocuments.push(nextDoc);
        });
        renderDocumentsSelection();
    }

    function getPatternNameValues() {
        const alphaEnabled = document.getElementById('pattern-alpha-enabled')?.checked;
        if (alphaEnabled) {
            return getAlphabetRangeValues(
                document.getElementById('pattern-alpha-start')?.value,
                document.getElementById('pattern-alpha-end')?.value
            );
        }

        const start = parseInt(document.getElementById('pattern-start').value, 10) || 0;
        const end = parseInt(document.getElementById('pattern-end').value, 10) || 0;
        const padding = parseInt(document.getElementById('pattern-padding').value, 10) || 0;

        if (start > end) {
            return {
                error: 'Erreur: "De" doit etre inferieur ou egal a "A".',
                values: []
            };
        }

        const values = [];
        for (let index = start; index <= end; index += 1) {
            values.push(padding > 0 ? String(index).padStart(padding, '0') : String(index));
        }

        return { error: '', values };
    }

    function generatePatternDocuments(prefix, suffix, nameValues, numeroStart, numeroStep, numeroPadding, type, zone = '') {
        const docs = [];
        let currentNumero = numeroStart;
        const effectiveNumeroPadding = normalizeDocumentNumberPadding(numeroPadding);
        nameValues.forEach((nameValue) => {
            let numeroStr = String(currentNumero);
            if (effectiveNumeroPadding > 0) {
                numeroStr = numeroStr.padStart(effectiveNumeroPadding, '0');
            }
            docs.push({
                name: `${prefix}${nameValue}${suffix}`,
                numero: numeroStr,
                type: normalizeDocumentType(type),
                zone: resolveProjectDocumentZone(zone)
            });
            currentNumero += numeroStep;
        });
        return docs;
    }

    function updatePatternPreview() {
        const prefix = document.getElementById('pattern-prefix').value || '';
        const suffix = document.getElementById('pattern-suffix').value || '';
        const numeroStart = parseInt(document.getElementById('numero-start').value, 10) || 0;
        const numeroStep = parseInt(document.getElementById('numero-step').value, 10) || 1;
        const numeroPadding = normalizeDocumentNumberPadding(document.getElementById('numero-padding').value);
        const type = normalizeDocumentType(document.getElementById('pattern-doc-type').value || '');
        const zone = normalizeZoneValue(document.getElementById('pattern-doc-zone')?.value || '');
        const previewBody = document.getElementById('pattern-preview-body');
        const patternValues = getPatternNameValues();

        if (patternValues.error) {
            previewBody.innerHTML = `<tr><td colspan="4" style="color: red;">(${patternValues.error})</td></tr>`;
            return;
        }

        const docs = generatePatternDocuments(
            prefix,
            suffix,
            patternValues.values.slice(0, 10),
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
        if (patternValues.values.length > 10) {
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
        const alphaEnabledInput = document.getElementById('pattern-alpha-enabled');
        const alphaStartInput = document.getElementById('pattern-alpha-start');
        const alphaEndInput = document.getElementById('pattern-alpha-end');
        const numberRangeFields = document.getElementById('pattern-number-range-fields');
        const alphaRangeFields = document.getElementById('pattern-alpha-range-fields');
        const patternTypeInput = document.getElementById('pattern-doc-type');
        const patternZoneInput = document.getElementById('pattern-doc-zone');
        const addPatternBtn = document.getElementById('add-pattern-docs-btn');
        const numeroStartInput = document.getElementById('numero-start');
        const numeroStepInput = document.getElementById('numero-step');
        const numeroPaddingSelect = document.getElementById('numero-padding');

        [manualTypeInput, patternTypeInput].forEach((inputElement) => {
            if (!inputElement) return;
            inputElement.addEventListener('click', () => {
                try {
                    inputElement.showPicker?.();
                } catch (_error) {
                    // Le navigateur affichera naturellement la datalist.
                }
            });
            ['change', 'blur'].forEach((eventName) => {
                inputElement.addEventListener(eventName, () => {
                    normalizeDocumentTypeInput(inputElement);
                    if (inputElement === patternTypeInput) {
                        updatePatternPreview();
                    }
                });
            });
        });

        function closeModal() {
            modal.style.display = 'none';
        }

        openBtn.addEventListener('click', () => {
            manualTypeInput.value = '';
            patternTypeInput.value = '';
            refreshDocumentZoneSuggestionLists();
            refreshDocumentTypeSuggestionLists();
            void refreshProjectTypeDocSuggestions();
            modal.style.display = 'flex';
        });

        closeBtn.addEventListener('click', closeModal);

        function updatePatternRangeMode() {
            const isAlphabetMode = Boolean(alphaEnabledInput?.checked);
            if (numberRangeFields) numberRangeFields.hidden = isAlphabetMode;
            if (alphaRangeFields) alphaRangeFields.hidden = !isAlphabetMode;
            updatePatternPreview();
        }

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
            const type = normalizeDocumentType(manualTypeInput.value);
            const zone = normalizeZoneValue(manualZoneInput.value);

            if (!docNames.length) {
                return;
            }

            if (!type) {
                alert('Veuillez renseigner un type de document.');
                manualTypeInput.focus();
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
            manualTypeInput.value = '';
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

        [prefixInput, suffixInput, startInput, endInput, paddingSelect, patternTypeInput, patternZoneInput, alphaStartInput, alphaEndInput].forEach((element) => {
            if (!element) return;
            element.addEventListener('input', updatePatternPreview);
            element.addEventListener('change', updatePatternPreview);
        });

        if (alphaEnabledInput) {
            alphaEnabledInput.addEventListener('change', updatePatternRangeMode);
        }

        [numeroStartInput, numeroStepInput, numeroPaddingSelect].forEach((element) => {
            if (!element) return;
            element.addEventListener('input', updatePatternPreview);
            element.addEventListener('change', updatePatternPreview);
        });

        addPatternBtn.addEventListener('click', () => {
            const prefix = prefixInput.value || '';
            const suffix = suffixInput.value || '';
            const patternValues = getPatternNameValues();
            const numeroStart = parseInt(numeroStartInput.value, 10) || 0;
            const numeroStep = parseInt(numeroStepInput.value, 10) || 1;
            const numeroPadding = normalizeDocumentNumberPadding(numeroPaddingSelect.value);
            const type = normalizeDocumentType(patternTypeInput.value);
            const zone = normalizeZoneValue(patternZoneInput.value);

            if (!type) {
                alert('Veuillez renseigner un type de document.');
                patternTypeInput.focus();
                return;
            }

            if (patternValues.error) {
                alert('Erreur: "De" doit Ãªtre infÃ©rieur ou Ã©gal Ã  "Ã€".');
                return;
            }

            addDocuments(generatePatternDocuments(
                prefix,
                suffix,
                patternValues.values,
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
            if (alphaEnabledInput) alphaEnabledInput.checked = false;
            if (alphaStartInput) alphaStartInput.value = 'A';
            if (alphaEndInput) alphaEndInput.value = 'E';
            numeroStartInput.value = '1';
            numeroStepInput.value = '1';
            numeroPaddingSelect.value = '3';
            patternTypeInput.value = '';
            patternZoneInput.value = '';
            updatePatternRangeMode();
        });

        updatePatternRangeMode();
    }

    function initDocumentsSection() {
        renderDocumentsSelection();
        setupDocsModal();
        refreshDocumentZoneSuggestionLists();
        refreshDocumentTypeSuggestionLists();
    }

    async function populateEmittersSelection() {
        const container = document.getElementById('emitters-selection-container');
        container.innerHTML = '';

        const emitterTable = await fetchEmittersTable();

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
            const serviceValue = await getTeamService();
            await assertProjectCreationDocumentIdentitiesAvailable(
                projectData.name,
                projectData.documents,
                serviceValue
            );
            const [refTable, listePlanContext, planningContext] = await Promise.all([
                grist.docApi.fetchTable("References2"),
                fetchFirstAvailableTable(LISTEPLAN_TABLE_CANDIDATES),
                fetchFirstAvailableTable(PLANNING_TABLE_CANDIDATES)
            ]);
            const refCols = new Set(Object.keys(refTable));
            if (!refCols.has('Service')) {
                throw new Error('La colonne Service est absente de References2.');
            }
            if (!listePlanContext.columns.has('Service')) {
                throw new Error('La colonne Service est absente de ListePlan_NDC_COF.');
            }
            if (!planningContext.columns.has('Service')) {
                throw new Error('La colonne Service est absente de Planning_Projet.');
            }
            const projetsTable = await grist.docApi.fetchTable("Projets2");
            const projetsColumns = getTableColumnNames(projetsTable);
            const projectFields = {
                Nom_de_projet: projectData.name,
                Numero_de_projet: projectData.number
            };
            setFieldIfPresent(projetsColumns, projectFields, 'DOP', normalizeDopValue(projectData.dop));
            setFieldIfPresent(projetsColumns, projectFields, 'TypeDoc', serializeProjectTypeDocValue(projectData.documents));
            // 1. Create Project
            const projectActions = [
                ["AddRecord", "Projets2", null, projectFields]
            ];
            await grist.docApi.applyUserActions(projectActions);

            // 2. Add Budget Lines
            const budgetActions = getBudgetLinesForProjectCreation().map(line =>
                ["AddRecord", "Budget", null, { NumeroProjet: projectData.number, Chapter: line.chapter, Amount: line.amount }]
            );
            if (budgetActions.length > 0) {
                await grist.docApi.applyUserActions(budgetActions);
            }

            // 3. Add Team Members
            const selectedTeamMembers = getSelectedTeamMembers();
            const teamActions = selectedTeamMembers.map(member => {
                const name = getTeamMemberDisplayName(member);
                const role = getTeamMemberRole(member);
                return ["AddRecord", "ProjectTeam", null, { NumeroProjet: projectData.number, Role: role, Name: name, Daily_Rate: 0 }];
            });
            if (teamActions.length > 0) {
                await grist.docApi.applyUserActions(teamActions);
            }

            // 4. Create References (documents x emitters)
            const descCol =
                refCols.has("DescriptionObservations") ? "DescriptionObservations" :
                    (refCols.has("DescriptionObservation") ? "DescriptionObservation" : null);

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

                    referencesActions.push(["AddRecord", "References2", null, row]);
                }
            }

            if (referencesActions.length > 0) {
                await grist.docApi.applyUserActions(referencesActions);
            }

            // 5. Add to ListePlan_NDC_COF
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
                setFieldIfPresent(listePlanContext.columns, fields, 'Service', serviceValue);
                return ["AddRecord", listePlanContext.tableName, null, fields];
            });

            if (listePlanActions.length > 0) {
                await grist.docApi.applyUserActions(listePlanActions);
            }

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
                if (!planningZoneExists(planningContext.data, projectData.name, zoneName, serviceValue)) {
                    planningActions.push([
                        "AddRecord",
                        planningContext.tableName,
                        null,
                        buildPlanningZoneAnchorFields(planningContext.columns, projectData.name, zoneName, serviceValue)
                    ]);
                }
            });

            const usedPlanningGroups = collectProjectPlanningGroups(planningContext.data, projectData.name, serviceValue);

            projectData.documents.forEach((doc) => {
                const numeroText = String(doc.numero ?? '').trim();
                const fields = {};

                setFieldIfPresent(planningContext.columns, fields, 'NomProjet', projectData.name);
                setFieldIfPresent(planningContext.columns, fields, 'ID2', numeroText);
                setFieldIfPresent(planningContext.columns, fields, 'Taches', doc.name);
                setFieldIfPresent(planningContext.columns, fields, 'Tache', doc.name);
                setFieldIfPresent(planningContext.columns, fields, 'Type_doc', doc.type || 'COFFRAGE');
                setFieldIfPresent(planningContext.columns, fields, 'Indice', '');
                setFieldIfPresent(
                    planningContext.columns,
                    fields,
                    'Groupe',
                    getDefaultPlanningGroupForType(
                        doc.type || 'COFFRAGE',
                        planningContext.data,
                        projectData.name,
                        serviceValue,
                        usedPlanningGroups
                    )
                );
                setFieldIfPresent(planningContext.columns, fields, 'Zone', normalizeZoneValue(doc.zone));
                setFieldIfPresent(planningContext.columns, fields, 'Service', serviceValue);

                planningActions.push(["AddRecord", planningContext.tableName, null, fields]);
            });

            if (planningActions.length > 0) {
                await grist.docApi.applyUserActions(planningActions);
            }

            emitDopDataChange('project-created');
            alert('Projet créé avec succès !');
            // Optionally, redirect or clear the form
            window.location.reload();
        } catch (error) {
            console.error('Error creating project:', error);
            alert(error?.message || 'Erreur lors de la création du projet.');
        }
    });

    grist.ready();
    renderDopSelect();
    loadDopRegistry();
    window.addEventListener('storage', (event) => {
        if (event.key === DOP_DATA_CHANGE_STORAGE_KEY) scheduleDopRegistryReload();
    });
    window.addEventListener('focus', scheduleDopRegistryReload);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') scheduleDopRegistryReload();
    });
    populateTeamSelection();
    initDocumentsSection();
    populateEmittersSelection();
    showStep(1);
});
