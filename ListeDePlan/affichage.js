const INDICES = ["0", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
let projetsDictGlobal = null;

(async () => {
  await chargerProjetsMap();
})();

async function chargerProjetsMap() {
  if (projetsDictGlobal) return projetsDictGlobal;

  const data = await grist.docApi.fetchTable("Projets");
  projetsDictGlobal = {};

  if (data && data.id && data.Nom_de_projet) {
    for (let i = 0; i < data.id.length; i++) {
      const nom = data.Nom_de_projet[i];
      const id = data.id[i];
      if (typeof nom === "string" && nom.trim()) {
        projetsDictGlobal[nom.trim()] = id;
      }
    }
  } else {
    console.error("Structure inattendue de la table Projet :", data);
  }
  return projetsDictGlobal;
}

function normalizeText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if (typeof value.details === "string") return value.details.trim();
    if (typeof value.display === "string") return value.display.trim();
    if (typeof value.label === "string") return value.label.trim();
    if (typeof value.name === "string") return value.name.trim();
  }
  return String(value).trim();
}

function normalizeZoneText(value) {
  return normalizeText(value);
}

function compareNormalizedText(left, right, { blankLast = false } = {}) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);

  if (blankLast && !normalizedLeft && normalizedRight) return 1;
  if (blankLast && normalizedLeft && !normalizedRight) return -1;

  return normalizedLeft.localeCompare(normalizedRight, "fr", {
    sensitivity: "base",
    numeric: true
  });
}

function getRecordProjectName(record) {
  const rawValue = typeof record?.Nom_projet === "object" ? record?.Nom_projet?.details : record?.Nom_projet;
  const normalizedValue = normalizeText(rawValue);
  if (!normalizedValue || !projetsDictGlobal) return normalizedValue;

  const matchedProject = Object.entries(projetsDictGlobal).find(
    ([, projectId]) => normalizeText(projectId) === normalizedValue
  );
  return matchedProject ? matchedProject[0] : normalizedValue;
}

function getRecordTypeDocument(record) {
  return normalizeText(record?.Type_document);
}

function getRecordZone(record) {
  return normalizeZoneText(record?.Zone);
}

function formatZoneSectionTitle(zoneValue) {
  return normalizeZoneText(zoneValue) || "Sans zone";
}

function isAllTypesSelection(typeDocument) {
  return normalizeText(typeDocument) === normalizeText(window.LISTE_DE_PLAN_ALL_TYPES_VALUE || "__ALL_TYPES__");
}

function isAllZonesSelection(zoneValue) {
  return normalizeText(zoneValue) === normalizeText(window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__");
}

function matchesZoneSelection(record, zoneValue) {
  if (isAllZonesSelection(zoneValue)) return true;

  const selectedZone = normalizeText(zoneValue);
  const noZoneValue = normalizeText(window.LISTE_DE_PLAN_NO_ZONE_VALUE || "__NO_ZONE__");
  const recordZone = normalizeZoneText(getRecordZone(record));

  if (selectedZone === noZoneValue) {
    return !recordZone;
  }

  return recordZone === selectedZone;
}

function normalizeRows(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.records)) return raw.records;
  if (typeof raw === "object") {
    const keys = Object.keys(raw);
    if (!keys.length) return [];
    const maxLen = Math.max(...keys.map((k) => (Array.isArray(raw[k]) ? raw[k].length : 0)));
    if (maxLen <= 0) return [];
    const rows = [];
    for (let i = 0; i < maxLen; i++) {
      const row = {};
      for (const key of keys) {
        row[key] = Array.isArray(raw[key]) ? raw[key][i] : undefined;
      }
      rows.push(row);
    }
    return rows;
  }
  return [];
}

function hasValidDate(value) {
  if (value == null || value === "") return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function normalizeIndice(value) {
  return normalizeText(value).toUpperCase();
}

function buildPlanningLinkKey(project, numeroDocument, typeDocument, designation, zone = "") {
  return [
    normalizeText(project).toLowerCase(),
    normalizeText(numeroDocument).toLowerCase(),
    normalizeText(typeDocument).toLowerCase(),
    normalizeText(designation).toLowerCase(),
    normalizeZoneText(zone).toLowerCase(),
  ].join("||");
}

function buildPlanningLinkKeyWithoutDesignation(project, numeroDocument, typeDocument, zone = "") {
  return [
    normalizeText(project).toLowerCase(),
    normalizeText(numeroDocument).toLowerCase(),
    normalizeText(typeDocument).toLowerCase(),
    normalizeZoneText(zone).toLowerCase(),
  ].join("||");
}

function getColumnNames(raw, rows = []) {
  const names = new Set(Object.keys(raw || {}));
  for (const row of rows) {
    Object.keys(row || {}).forEach((key) => names.add(key));
  }
  return names;
}

function findFirstExistingColumn(columnNames, candidates) {
  return candidates.find((name) => columnNames.has(name)) || null;
}

function matchesProjectValue(value, projectName, projectId = null) {
  const normalizedValue = normalizeText(value);
  const normalizedProjectName = normalizeText(projectName);
  const normalizedProjectId = projectId == null ? "" : normalizeText(projectId);

  return (
    normalizedValue === normalizedProjectName ||
    (normalizedProjectId !== "" && normalizedValue === normalizedProjectId)
  );
}

function updateRowCellDatasets(tr, updates = {}) {
  if (!tr) return;

  for (const cell of Array.from(tr.cells || [])) {
    if (!cell?.dataset) continue;
    if (Object.prototype.hasOwnProperty.call(updates, "numDocument")) {
      cell.dataset.numDocument = updates.numDocument;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "designation")) {
      cell.dataset.designation = updates.designation;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "zone")) {
      cell.dataset.zone = updates.zone;
    }
  }
}

async function buildReferencesTextUpdateActions({
  cellIndex,
  texte,
  numDocument,
  designation,
  typeDocument,
  nomProjet,
  zone
}) {
  try {
    const referencesRaw = await grist.docApi.fetchTable("References");
    const referenceRows = normalizeRows(referencesRaw);
    const referenceColumns = getColumnNames(referencesRaw, referenceRows);

    const projectColumn = findFirstExistingColumn(referenceColumns, ["NomProjet", "Nom_projet"]);
    const typeColumn = findFirstExistingColumn(referenceColumns, ["Type_document", "TypeDocument"]);
    const zoneColumn = findFirstExistingColumn(referenceColumns, ["Zone"]);
    const designationColumns = ["NomDocument", "Designation"].filter((name) => referenceColumns.has(name));

    const updateFields = {};
    if (cellIndex === 0 && referenceColumns.has("NumeroDocument")) {
      updateFields.NumeroDocument = texte;
    }
    if (cellIndex === 1) {
      if (referenceColumns.has("NomDocument")) {
        updateFields.NomDocument = texte;
      }
      if (referenceColumns.has("Designation")) {
        updateFields.Designation = texte;
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return [];
    }

    const projetsMap = await chargerProjetsMap();
    const projectId = projetsMap?.[normalizeText(nomProjet)] ?? null;

    return referenceRows
      .filter((row) => {
        if (row?.id == null) return false;
        if (normalizeText(row.NumeroDocument) !== normalizeText(numDocument)) return false;
        if (projectColumn && !matchesProjectValue(row[projectColumn], nomProjet, projectId)) {
          return false;
        }
        if (typeColumn && normalizeText(typeDocument) && normalizeText(row[typeColumn]) !== normalizeText(typeDocument)) {
          return false;
        }
        if (zoneColumn && normalizeZoneText(row[zoneColumn]) !== normalizeZoneText(zone)) {
          return false;
        }
        if (designationColumns.length > 0) {
          const matchesDesignation = designationColumns.some(
            (columnName) => normalizeText(row[columnName]) === normalizeText(designation)
          );
          if (!matchesDesignation) {
            return false;
          }
        }
        return true;
      })
      .map((row) => ["UpdateRecord", "References", row.id, updateFields]);
  } catch (err) {
    console.error("Erreur lors de la préparation de la synchro vers References :", err);
    return [];
  }
}

async function buildPlanningProjetTextUpdateActions({
  cellIndex,
  texte,
  numDocument,
  designation,
  typeDocument,
  nomProjet,
  zone
}) {
  try {
    const planningRaw = await grist.docApi.fetchTable("Planning_Projet");
    const planningRows = normalizeRows(planningRaw);
    const planningColumns = getColumnNames(planningRaw, planningRows);

    const projectColumn = findFirstExistingColumn(planningColumns, ["NomProjet", "Nom_projet"]);
    const typeColumn = findFirstExistingColumn(planningColumns, ["Type_doc", "Type_document", "TypeDoc"]);
    const zoneColumn = findFirstExistingColumn(planningColumns, ["Zone"]);
    const numeroColumn = findFirstExistingColumn(planningColumns, ["ID2", "NumeroDocument"]);
    const designationColumns = ["Taches", "Tache", "Designation"].filter((name) => planningColumns.has(name));

    if (!numeroColumn) {
      return [];
    }

    const updateFields = {};
    if (cellIndex === 0) {
      updateFields[numeroColumn] = texte;
    }
    if (cellIndex === 1) {
      if (planningColumns.has("Taches")) {
        updateFields.Taches = texte;
      }
      if (planningColumns.has("Tache")) {
        updateFields.Tache = texte;
      }
      if (planningColumns.has("Designation")) {
        updateFields.Designation = texte;
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return [];
    }

    const projetsMap = await chargerProjetsMap();
    const projectId = projetsMap?.[normalizeText(nomProjet)] ?? null;

    const matchesPlanningRow = (row, { ignoreZone = false } = {}) => {
      if (row?.id == null) return false;
      if (normalizeText(row[numeroColumn]) !== normalizeText(numDocument)) return false;
      if (projectColumn && !matchesProjectValue(row[projectColumn], nomProjet, projectId)) {
        return false;
      }
      if (typeColumn && normalizeText(typeDocument) && normalizeText(row[typeColumn]) !== normalizeText(typeDocument)) {
        return false;
      }
      if (!ignoreZone && zoneColumn && normalizeZoneText(row[zoneColumn]) !== normalizeZoneText(zone)) {
        return false;
      }
      if (designationColumns.length > 0) {
        const matchesDesignation = designationColumns.some(
          (columnName) => normalizeText(row[columnName]) === normalizeText(designation)
        );
        if (!matchesDesignation) {
          return false;
        }
      }
      return true;
    };

    const exactMatches = planningRows.filter((row) => matchesPlanningRow(row));
    const fallbackMatches = exactMatches.length
      ? exactMatches
      : planningRows.filter((row) => matchesPlanningRow(row, { ignoreZone: true }));

    return fallbackMatches.map((row) => ["UpdateRecord", "Planning_Projet", row.id, updateFields]);
  } catch (err) {
    console.error("Erreur lors de la préparation de la synchro vers Planning_Projet :", err);
    return [];
  }
}

async function syncPlanningProjetIndicesFromListeDePlan() {
  try {
    const projetsMap = await chargerProjetsMap();
    const projectIdToName = new Map(
      Object.entries(projetsMap || {}).map(([name, id]) => [String(id), name])
    );

    const normalizeProject = (value) => {
      if (value != null && typeof value === "object") {
        if (typeof value.details === "string") return value.details.trim();
        if (typeof value.display === "string") return value.display.trim();
      }
      const raw = normalizeText(value);
      return projectIdToName.get(raw) || raw;
    };

    const listeRaw = await grist.docApi.fetchTable("ListePlan_NDC_COF");
    const planningRaw = await grist.docApi.fetchTable("Planning_Projet");

    const listeRows = normalizeRows(listeRaw);
    const planningRows = normalizeRows(planningRaw);

    const indiceOrder = new Map(INDICES.map((ind, idx) => [ind, idx]));
    const latestByKeyStrict = new Map();
    const latestByKeyNoDesignation = new Map();
    const latestByKeyStrictLegacy = new Map();
    const latestByKeyNoDesignationLegacy = new Map();

    for (const r of listeRows) {
      const indice = normalizeIndice(r.Indice);
      const order = indiceOrder.has(indice) ? indiceOrder.get(indice) : -1;
      if (order < 0) continue;
      if (!hasValidDate(r.DateDiffusion)) continue;

      const strictKey = buildPlanningLinkKey(
        normalizeProject(r.Nom_projet),
        r.NumeroDocument,
        r.Type_document,
        r.Designation,
        r.Zone
      );
      const noDesignationKey = buildPlanningLinkKeyWithoutDesignation(
        normalizeProject(r.Nom_projet),
        r.NumeroDocument,
        r.Type_document,
        r.Zone
      );
      const strictLegacyKey = buildPlanningLinkKey(
        normalizeProject(r.Nom_projet),
        r.NumeroDocument,
        r.Type_document,
        r.Designation
      );
      const noDesignationLegacyKey = buildPlanningLinkKeyWithoutDesignation(
        normalizeProject(r.Nom_projet),
        r.NumeroDocument,
        r.Type_document
      );

      const strictCurrent = latestByKeyStrict.get(strictKey);
      const shouldReplaceStrict = !strictCurrent || order > strictCurrent.order;
      if (shouldReplaceStrict) {
        latestByKeyStrict.set(strictKey, { indice, order });
      }

      const looseCurrent = latestByKeyNoDesignation.get(noDesignationKey);
      const shouldReplaceLoose = !looseCurrent || order > looseCurrent.order;
      if (shouldReplaceLoose) {
        latestByKeyNoDesignation.set(noDesignationKey, { indice, order });
      }

      const strictLegacyCurrent = latestByKeyStrictLegacy.get(strictLegacyKey);
      const shouldReplaceStrictLegacy = !strictLegacyCurrent || order > strictLegacyCurrent.order;
      if (shouldReplaceStrictLegacy) {
        latestByKeyStrictLegacy.set(strictLegacyKey, { indice, order });
      }

      const looseLegacyCurrent = latestByKeyNoDesignationLegacy.get(noDesignationLegacyKey);
      const shouldReplaceLooseLegacy = !looseLegacyCurrent || order > looseLegacyCurrent.order;
      if (shouldReplaceLooseLegacy) {
        latestByKeyNoDesignationLegacy.set(noDesignationLegacyKey, { indice, order });
      }
    }

    const actions = [];
    for (const p of planningRows) {
      const planningId = p.id;
      if (planningId == null) continue;

      const strictKey = buildPlanningLinkKey(
        normalizeProject(p.NomProjet),
        p.ID2,
        p.Type_doc,
        p.Taches ?? p.Tache,
        p.Zone
      );
      const noDesignationKey = buildPlanningLinkKeyWithoutDesignation(
        normalizeProject(p.NomProjet),
        p.ID2,
        p.Type_doc,
        p.Zone
      );
      const strictLegacyKey = buildPlanningLinkKey(
        normalizeProject(p.NomProjet),
        p.ID2,
        p.Type_doc,
        p.Taches ?? p.Tache
      );
      const noDesignationLegacyKey = buildPlanningLinkKeyWithoutDesignation(
        normalizeProject(p.NomProjet),
        p.ID2,
        p.Type_doc
      );

      const targetIndice =
        latestByKeyStrict.get(strictKey)?.indice ??
        latestByKeyNoDesignation.get(noDesignationKey)?.indice ??
        latestByKeyStrictLegacy.get(strictLegacyKey)?.indice ??
        latestByKeyNoDesignationLegacy.get(noDesignationLegacyKey)?.indice ??
        "";
      const currentIndice = normalizeText(p.Indice);
      if (currentIndice !== targetIndice) {
        actions.push(["UpdateRecord", "Planning_Projet", planningId, { Indice: targetIndice }]);
      }
    }

    for (let i = 0; i < actions.length; i += 200) {
      await grist.docApi.applyUserActions(actions.slice(i, i + 200));
    }
  } catch (err) {
    console.error("Erreur sync ListeDePlan -> Planning_Projet (Indice) :", err);
  }
}

function renderPlanTableSection(container, filtres, projet) {
  if (!container || filtres.length === 0) return;
  /*
    zone.innerHTML = "<p>Aucun plan trouvé pour cette sélection.</p>";
    return;
  }

  */
  const plansMap = new Map();
  for (const r of filtres) {
    const zoneValue = getRecordZone(r);
    const key = `${normalizeText(r.NumeroDocument)}___${normalizeText(r.Designation)}___${zoneValue}`;
    if (!plansMap.has(key)) {
      plansMap.set(key, {
        Num_Document: r.NumeroDocument,
        Designation: r.Designation,
        Type_document: r.Type_document,
        Nom_projet: getRecordProjectName(r),
        Zone: zoneValue,
        lignes: {}
      });
    }
    if (!plansMap.get(key).lignes[r.Indice]) {
      plansMap.get(key).lignes[r.Indice] = [];
    }
    plansMap.get(key).lignes[r.Indice].push(r);
  }

  const warningDiv = document.createElement('div');
  warningDiv.className = 'warnings';

  // Designation conflict warnings
  const docToDesignations = new Map();
  for (const r of filtres) {
    if (!r.NumeroDocument) continue;
    const docKey = `${normalizeText(r.NumeroDocument)}___${getRecordZone(r)}`;
    if (!docToDesignations.has(docKey)) {
      docToDesignations.set(docKey, {
        numDocument: r.NumeroDocument,
        zone: getRecordZone(r),
        designations: new Set()
      });
    }
    if (r.Designation) {
      docToDesignations.get(docKey).designations.add(r.Designation);
    }
  }

  for (const { numDocument: doc, zone, designations } of docToDesignations.values()) {
    if (designations.size > 1) {
      const form = document.createElement('div');
      form.className = 'warning-form';
      form.innerHTML = `<p><strong>Attention :</strong> Le document <strong>${doc}</strong> a plusieurs désignations :</p>`;
      const details = document.createElement('p');
      details.textContent = `Désignations trouvées : ${[...designations].join(' / ')}. Corrigez-les manuellement.`;
      form.appendChild(details);
      warningDiv.appendChild(form);
    }
  }

  // Multi-date conflict warning
  let hasMultiDateError = false;
  for (const plan of plansMap.values()) {
    for (const indice in plan.lignes) {
      if (plan.lignes[indice].length > 1) {
        hasMultiDateError = true;
        break;
      }
    }
    if (hasMultiDateError) break;
  }

  if (hasMultiDateError) {
    const p = document.createElement('p');
    p.className = 'warning-message';
    p.textContent = "Des dates multiples sont trouvées pour certains documents pour la même indice, veuillez corriger en cliquant dessus.";
    warningDiv.appendChild(p);
  }

  // Missing date warnings
  let hasMissingDateError = false;
  for (const plan of plansMap.values()) {
    const datedIndices = Object.keys(plan.lignes)
      .filter(indice => plan.lignes[indice] && plan.lignes[indice].length > 0 && !plan.lignes[indice].isMissing)
      .map(indice => INDICES.indexOf(indice))
      .filter(index => index !== -1)
      .sort((a, b) => a - b);

    if (datedIndices.length > 0) {
      const last = datedIndices[datedIndices.length - 1];
      // Check all cells from the beginning up to the last valid date
      for (let i = 0; i < last; i++) {
        const currentIndice = INDICES[i];
        if (!plan.lignes[currentIndice] || plan.lignes[currentIndice].length === 0) {
          hasMissingDateError = true;
          // Mark this cell for highlighting
          if (!plan.lignes[currentIndice]) {
            plan.lignes[currentIndice] = { isMissing: true };
          } else {
            plan.lignes[currentIndice].isMissing = true;
          }
        }
      }
    }
  }

  if (hasMissingDateError) {
    const p = document.createElement('p');
    p.className = 'warning-message';
    p.textContent = "Des dates sont manquantes, veuillez les remplir.";
    warningDiv.appendChild(p);
  }

  // Document number/type consistency warnings (for the current project)
  const projectDocMap = container.id === "plans-output" ? window.projectDocNumberToTypeMap.get(projet) : null;
  if (projectDocMap) {
    for (const [doc, types] of projectDocMap.entries()) {
      if (types.size > 1) {
        const p = document.createElement('p');
        p.className = 'warning-message';
        p.innerHTML = `<strong>Attention :</strong> Le N° Document <strong>${doc}</strong> est utilisé avec plusieurs types de documents dans ce projet : ${[...types].join(', ')}.`;
        warningDiv.appendChild(p);
      }
    }
  }

  const allIndicesUsed = new Set();
  for (const plan of plansMap.values()) {
    for (const ind in plan.lignes) {
      allIndicesUsed.add(ind);
    }
  }
  let lastUsedIndex = Math.max(-1, ...[...allIndicesUsed].map(i => INDICES.indexOf(i)).filter(i => i >= 0));
  const indicesToShow = INDICES.slice(0, lastUsedIndex + 2);

  const table = document.createElement("table");
  table.className = "plan-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["N° Document", "Désignation", ...indicesToShow].forEach(title => {
    const th = document.createElement("th");
    th.textContent = title;
    if (title === "Désignation") th.classList.add("nomplan");
    if (!["N° Document", "Désignation"].includes(title)) {
      th.classList.add("indice");
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const sortedPlans = [...plansMap.values()].sort((left, right) =>
    compareNormalizedText(left.Num_Document, right.Num_Document) ||
    compareNormalizedText(left.Designation, right.Designation) ||
    compareNormalizedText(left.Zone, right.Zone, { blankLast: true })
  );
  for (const plan of sortedPlans) {
    const tr = document.createElement("tr");
    const duplicateKey = `${normalizeText(plan.Num_Document)}___${normalizeZoneText(plan.Zone)}`;
    if ((docToDesignations.get(duplicateKey)?.designations?.size || 0) > 1) {
      tr.classList.add("duplicate-doc");
    }

    const tdNum = document.createElement("td");
    tdNum.textContent = plan.Num_Document;
    tdNum.dataset.numDocument = plan.Num_Document;
    tdNum.dataset.designation = plan.Designation;
    tdNum.dataset.zone = plan.Zone;
    tdNum.contentEditable = true;
    tdNum.classList.add("editable");
    tdNum.dataset.typeDocument = plan.Type_document;
    tdNum.dataset.nomProjet = plan.Nom_projet;
    tr.appendChild(tdNum);

    const tdNom = document.createElement("td");
    tdNom.textContent = plan.Designation;
    tdNom.dataset.numDocument = plan.Num_Document;
    tdNom.dataset.designation = plan.Designation;
    tdNom.dataset.zone = plan.Zone;
    tdNom.contentEditable = true;
    tdNom.classList.add("editable", "nomplan");
    tdNom.dataset.typeDocument = plan.Type_document;
    tdNom.dataset.nomProjet = plan.Nom_projet;
    tr.appendChild(tdNom);

    for (const indice of indicesToShow) {
      const td = document.createElement("td");
      td.classList.add("editable", "indice");
      td.dataset.typeDocument = plan.Type_document;
      td.dataset.nomProjet = plan.Nom_projet;
      td.dataset.numDocument = plan.Num_Document;
      td.dataset.designation = plan.Designation;
      td.dataset.zone = plan.Zone;
      td.dataset.indice = indice;

      const recs = plan.lignes[indice];
      if (recs) {
        if (recs.isMissing) {
          td.classList.add('missing-date-error');
        } else if (recs.length > 1) {
          td.classList.add('multi-date-error');
          td.innerHTML = recs.map(r => formatDate(r.DateDiffusion)).join('<br>');
          td.dataset.conflicts = JSON.stringify(recs.map(r => ({ id: r.id, date: r.DateDiffusion })));
        } else if (recs.length === 1) {
          const rec = recs[0];
          if (rec.DateDiffusion) td.textContent = formatDate(rec.DateDiffusion);
          td.dataset.recordId = rec.id;
        }
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  if (warningDiv.childElementCount > 0) {
    container.appendChild(warningDiv);
  }
  container.appendChild(table);
}

function renderZoneSections(container, rows, projet) {
  const rowsByZone = new Map();
  for (const record of rows) {
    const zoneKey = getRecordZone(record);
    if (!rowsByZone.has(zoneKey)) {
      rowsByZone.set(zoneKey, []);
    }
    rowsByZone.get(zoneKey).push(record);
  }

  const zoneKeys = [...rowsByZone.keys()].sort((left, right) => compareNormalizedText(left, right, { blankLast: true }));
  for (const zoneKey of zoneKeys) {
    const zoneSection = document.createElement("section");
    zoneSection.className = "plan-zone-section";

    const title = document.createElement("h3");
    title.className = "plan-zone-title";
    title.textContent = formatZoneSectionTitle(zoneKey);
    zoneSection.appendChild(title);

    renderPlanTableSection(zoneSection, rowsByZone.get(zoneKey), projet);
    container.appendChild(zoneSection);
  }
}

function hasNamedZone(rows) {
  return rows.some((record) => normalizeZoneText(getRecordZone(record)));
}

function renderRowsForSelectedType(container, rows, projet) {
  if (hasNamedZone(rows)) {
    renderZoneSections(container, rows, projet);
    return;
  }

  renderPlanTableSection(container, rows, projet);
}

function afficherPlansFiltres(projet, typeDocument, records, zoneSelection = window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__") {
  const output = document.getElementById("plans-output");
  output.innerHTML = "";

  const normalizedProject = normalizeText(projet);
  const projectRows = records.filter((record) =>
    getRecordProjectName(record) === normalizedProject &&
    getRecordTypeDocument(record) &&
    matchesZoneSelection(record, zoneSelection)
  );

  if (projectRows.length === 0) {
    output.innerHTML = "<p>Aucun plan trouve pour cette selection.</p>";
    return;
  }

  if (!isAllTypesSelection(typeDocument)) {
    const filteredRows = projectRows.filter((record) => getRecordTypeDocument(record) === normalizeText(typeDocument));
    if (filteredRows.length === 0) {
      output.innerHTML = "<p>Aucun plan trouve pour cette selection.</p>";
      return;
    }

    renderRowsForSelectedType(output, filteredRows, normalizedProject);
    return;
  }

  const rowsByType = new Map();
  for (const record of projectRows) {
    const typeKey = getRecordTypeDocument(record);
    if (!rowsByType.has(typeKey)) {
      rowsByType.set(typeKey, []);
    }
    rowsByType.get(typeKey).push(record);
  }

  const typeKeys = [...rowsByType.keys()].sort((left, right) => compareNormalizedText(left, right));
  if (typeKeys.length === 0) {
    output.innerHTML = "<p>Aucun plan trouve pour cette selection.</p>";
    return;
  }

  for (const typeKey of typeKeys) {
    const typeSection = document.createElement("section");
    typeSection.className = "plan-type-section";

    const title = document.createElement("h2");
    title.className = "plan-type-title";
    title.textContent = typeKey;
    typeSection.appendChild(title);

    renderZoneSections(typeSection, rowsByType.get(typeKey), normalizedProject);
    output.appendChild(typeSection);
  }
}

document.addEventListener("click", async (e) => {
  const target = e.target;

  if (target.matches('th.indice')) {
    ouvrirPickerRemplirColonne(target);
    return;
  }

  if (target.matches('td.multi-date-error')) {
    const td = target;
    const conflicts = JSON.parse(td.dataset.conflicts);
    const existingPopup = document.getElementById('date-fix-popup');
    if (existingPopup) existingPopup.remove();
    const popup = document.createElement('div');
    popup.id = 'date-fix-popup';
    popup.style.position = 'absolute';
    popup.style.left = `${td.offsetLeft + td.offsetWidth}px`;
    popup.style.top = `${td.offsetTop}px`;
    popup.innerHTML = `<p>Choisir la date correcte:</p>`;
    const fieldset = document.createElement('fieldset');
    conflicts.forEach((conflict, index) => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'date-fix';
      radio.value = conflict.id;
      if (index === 0) radio.checked = true;
      label.appendChild(radio);
      label.append(` ${formatDate(conflict.date)}`);
      fieldset.appendChild(label);
    });
    popup.appendChild(fieldset);
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Confirmer';
    confirmBtn.onclick = async () => {
      const selectedRadio = popup.querySelector('input[name="date-fix"]:checked');
      if (selectedRadio) {
        const correctRecordId = parseInt(selectedRadio.value, 10);
        const recordsToDelete = conflicts.filter(c => c.id !== correctRecordId);
        try {
          const table = await grist.getTable();
          for (const record of recordsToDelete) {
            await table.destroy(record.id);
          }
          await syncPlanningProjetIndicesFromListeDePlan();
          popup.remove();
        } catch (err) {
          console.error("Erreur lors de la suppression des dates en double :", err);
          alert("Une erreur est survenue lors de la suppression.");
        }
      }
    };
    popup.appendChild(confirmBtn);
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Annuler';
    cancelBtn.onclick = () => popup.remove();
    popup.appendChild(cancelBtn);
    td.closest('#plans-output').appendChild(popup);
    return;
  }

  if (target.matches('td.indice.editable')) {
    const td = target;
    if (document.getElementById('date-fix-popup')) return;
    const { recordId, indice, typeDocument, nomProjet, zone } = td.dataset;
    const tr = td.parentElement;
    const Num_Document = tr.cells[0]?.textContent.trim();
    const Designation = tr.cells[1]?.textContent.trim();
    const fp = flatpickr(td, {
      "locale": "fr",
      defaultDate: td.textContent ? convertFrToDate(td.textContent) : undefined,
      dateFormat: "d/m/Y",
        onClose: async (selectedDates, dateStr, instance) => {
        const isoDate = selectedDates.length > 0 ? convertToISO(dateStr) : null;
        const recordIdInt = recordId ? parseInt(recordId, 10) : null;

        // === CAS: cellule déjà existante (recordId) -> UPDATE, jamais AddRecord ===
        if (recordIdInt) {
          try {
            if (!isoDate) {
              // Suppression de date (ta logique existante)
              const otherDates = tr.querySelectorAll('td.indice');
              const datedCells = Array.from(otherDates).filter(cell => cell.textContent.trim() !== '' && cell !== td);

              const fieldsToUpdate = { DateDiffusion: null };
              if (datedCells.length === 0) {
                fieldsToUpdate.Indice = null;
              }

              await grist.docApi.applyUserActions([
                ["UpdateRecord", "ListePlan_NDC_COF", recordIdInt, fieldsToUpdate],

                // (je conserve ton AddRecord dans References, mais sans rowData)
                // ["AddRecord", "References", null, {
                //   NomProjet: nomProjet,
                //   NomDocument: Designation,
                //   NumeroDocument: (() => {
                //     const s = String(Num_Document ?? '').trim();
                //     return (/^\d+$/.test(s) ? parseInt(s, 10) : null);
                //   })()
                // }]
              ]);
              await syncPlanningProjetIndicesFromListeDePlan();

              td.textContent = "";
            } else {
              // Modification de date
              await grist.docApi.applyUserActions([
                ["UpdateRecord", "ListePlan_NDC_COF", recordIdInt, { DateDiffusion: isoDate }],

                // (je conserve ton AddRecord dans References, mais sans rowData)
                // ["AddRecord", "References", null, {
                //   NomProjet: nomProjet,
                //   NomDocument: Designation,
                //   NumeroDocument: (() => {
                //     const s = String(Num_Document ?? '').trim();
                //     return (/^\d+$/.test(s) ? parseInt(s, 10) : null);
                //   })()
                // }]
              ]);
              await syncPlanningProjetIndicesFromListeDePlan();

              td.textContent = dateStr;
            }
          } catch (err) {
            console.error("Erreur lors de la mise à jour de la date :", err);
          }
          return;
        }

        // === CAS: cellule vide (pas de recordId) -> ADD ===
        if (!isoDate) return;

        if (!Num_Document || !Designation || !nomProjet || !typeDocument) {
          console.warn("Champs obligatoires manquants pour l'ajout :", { Num_Document, Designation, nomProjet, typeDocument, zone });
          return;
        }

        // Project-specific validation logic (tu gardes tel quel)
        const projectDocMap = window.projectDocNumberToTypeMap.get(nomProjet);
        if (projectDocMap) {
          const existingTypes = projectDocMap.get(Num_Document);
          if (existingTypes && !existingTypes.has(typeDocument)) {
            alert(`Erreur : Le N° Document ${Num_Document} est déjà utilisé pour un autre type de document dans ce projet (${[...existingTypes].join(', ')}).`);
            td.textContent = '';
            return;
          }
        }

        const projetsDict = await chargerProjetsMap();
        if (!projetsDict[nomProjet.trim()]) {
          console.error("Projet non trouvé :", nomProjet);
          return;
        }

        const rowData = {
          NumeroDocument: Num_Document,
          Type_document: typeDocument,
          Designation: Designation,
          Nom_projet: nomProjet,
          Zone: zone || "",
          Indice: indice,
          DateDiffusion: isoDate
        };

        try {
          await grist.docApi.applyUserActions([
            ["AddRecord", "ListePlan_NDC_COF", null, rowData],
            // ["AddRecord", "References", null, {
            //   NomProjet: rowData.Nom_projet,
            //   NomDocument: rowData.Designation,
            //   NumeroDocument: (() => {
            //     const s = String(rowData.NumeroDocument ?? '').trim();
            //     return (/^\d+$/.test(s) ? parseInt(s, 10) : null);
            //   })()
            // }]
          ]);
          await syncPlanningProjetIndicesFromListeDePlan();
          td.textContent = dateStr;
        } catch (err) {
          console.error("Erreur lors de l'ajout du record :", err);
        }
      }
    });
    fp.open();
  }
});

document.addEventListener("focusout", async (e) => {
  const td = e.target;
  if (!td.matches("td.editable:not(.indice)")) return;

  td.style.backgroundColor = "";
  td.style.color = "";
  const texte = td.textContent.trim();
  const { numDocument, designation, typeDocument, nomProjet, zone } = td.dataset;
  const currentValue = td.cellIndex === 0 ? normalizeText(numDocument) : normalizeText(designation);
  if (normalizeText(texte) === currentValue) return;

  const projetsMap = await chargerProjetsMap();
  const projectId = projetsMap?.[normalizeText(nomProjet)] ?? null;
  const recordsToUpdate = window.records.filter((r) =>
    normalizeText(r.NumeroDocument) === normalizeText(numDocument) &&
    normalizeText(r.Designation) === normalizeText(designation) &&
    normalizeText(r.Type_document) === normalizeText(typeDocument) &&
    normalizeZoneText(r.Zone) === normalizeZoneText(zone) &&
    matchesProjectValue(r.Nom_projet, nomProjet, projectId)
  );
  if (recordsToUpdate.length === 0) return;
  const champs = {};
  if (td.cellIndex === 0) {
    champs.NumeroDocument = texte;
  } else if (td.cellIndex === 1) {
    champs.Designation = texte;
  }
  if (Object.keys(champs).length > 0) {
    const actions = recordsToUpdate.map(r => ["UpdateRecord", "ListePlan_NDC_COF", r.id, champs]);
    try {
      const referenceActions = await buildReferencesTextUpdateActions({
        cellIndex: td.cellIndex,
        texte,
        numDocument,
        designation,
        typeDocument,
        nomProjet,
        zone
      });
      const planningActions = await buildPlanningProjetTextUpdateActions({
        cellIndex: td.cellIndex,
        texte,
        numDocument,
        designation,
        typeDocument,
        nomProjet,
        zone
      });
      await grist.docApi.applyUserActions(actions.concat(referenceActions, planningActions));
      recordsToUpdate.forEach((record) => {
        if (td.cellIndex === 0) {
          record.NumeroDocument = texte;
        } else if (td.cellIndex === 1) {
          record.Designation = texte;
        }
      });
      updateRowCellDatasets(td.parentElement, {
        numDocument: td.cellIndex === 0 ? texte : numDocument,
        designation: td.cellIndex === 1 ? texte : designation
      });
      await syncPlanningProjetIndicesFromListeDePlan();
    } catch (err) {
      console.error("Erreur lors de la mise à jour du texte :", err);
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
    }
  }
});

function convertFrToDate(dateStr) {
  const [day, month, year] = dateStr.split("/");
  return new Date(year, month - 1, day);
}

function convertToISO(dateStr) {
  const [day, month, year] = dateStr.split("/");
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function dateObjToISO(d) {
  // on garde la date "locale" choisie par l'utilisateur
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

function ouvrirPickerRemplirColonne(th) {
  const indice = th.textContent.trim();

  // Popup léger
  const old = document.getElementById("column-fill-popup");
  if (old) old.remove();

  const popup = document.createElement("div");
  popup.id = "column-fill-popup";
  popup.style.position = "absolute";
  popup.style.zIndex = "9999";
  popup.style.background = "#fff";
  popup.style.border = "1px solid #ed1b2d";
  popup.style.borderRadius = "8px";
  popup.style.padding = "10px";
  popup.style.boxShadow = "0 8px 20px rgba(0,0,0,0.15)";
  popup.innerHTML = `
    <div style="margin-bottom:8px; color:#004990;">
      Remplir toute la colonne <strong>${indice}</strong>
    </div>
    <input id="column-fill-date" type="text" placeholder="Choisir une date" style="width:100%; padding:6px;" />
    <div style="display:flex; justify-content:flex-end; margin-top:10px;">
      <button id="column-fill-cancel" type="button">Annuler</button>
    </div>
  `;

  const rect = th.getBoundingClientRect();
  popup.style.left = `${rect.left + window.scrollX}px`;
  popup.style.top = `${rect.bottom + window.scrollY + 6}px`;
  document.body.appendChild(popup);

  const input = popup.querySelector("#column-fill-date");
  const cancelBtn = popup.querySelector("#column-fill-cancel");

  const fp = flatpickr(input, {
    locale: "fr",
    dateFormat: "d/m/Y",
    closeOnSelect: true,   // important
    onChange: async (selectedDates, dateStr, instance) => {
      if (!selectedDates || selectedDates.length === 0) return;

      // on ferme tout de suite le calendrier (UX)
      instance.close();

      try {
        const iso = convertToISO(dateStr);

        const indice = th.textContent.trim();
        const ok = confirm(`Appliquer ${formatDate(iso)} à toute la colonne ${indice} ?`);
        if (!ok) return;

        await appliquerDateSurTouteLaColonne(th, iso);
      } finally {
        instance.destroy();
        popup.remove();
      }
    }
  });

  fp.open();

  cancelBtn.onclick = () => { fp.destroy(); popup.remove(); };
}

async function appliquerDateSurTouteLaColonne(th, isoDate) {
  const table = th.closest("table");
  if (!table) return;

  const colIndex = th.cellIndex;
  const indice = th.textContent.trim();
  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  const rows = Array.from(tbody.querySelectorAll("tr"))
    .filter(tr => !tr.querySelector("td.ajout")); // ignore la ligne d'ajout

  const actionsUpsert = []; // Update + Add
  const actionsDelete = []; // Remove (multi-date)

  // Petite aide pour comparer sans bug number/string
  const same = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();

  for (const tr of rows) {
    const td = tr.cells[colIndex];
    if (!td) continue;

    const typeDocument = td.dataset.typeDocument;
    const nomProjet = td.dataset.nomProjet;
    const numDocument = td.dataset.numDocument;
    const designation = td.dataset.designation;
    const zone = td.dataset.zone;

    if (!typeDocument || !nomProjet || !numDocument || !designation) continue;

    // 1) Multi-date (conflits) : on garde le 1er, on supprime les autres
    if (td.dataset.conflicts) {
      const conflicts = JSON.parse(td.dataset.conflicts); // [{id,date},...]
      const keepId = conflicts[0]?.id;
      if (keepId) actionsUpsert.push(["UpdateRecord", "ListePlan_NDC_COF", keepId, { DateDiffusion: isoDate }]);
      for (const c of conflicts.slice(1)) {
        actionsDelete.push(["RemoveRecord", "ListePlan_NDC_COF", c.id]);
      }
      continue;
    }

    // 2) Record existe déjà pour cette cellule
    if (td.dataset.recordId) {
      const rid = parseInt(td.dataset.recordId, 10);
      actionsUpsert.push(["UpdateRecord", "ListePlan_NDC_COF", rid, { DateDiffusion: isoDate }]);
      continue;
    }

    // 3) Cellule vide : essayer de réutiliser un "placeholder" (Indice null) sinon AddRecord
    const placeholder = window.records.find(r =>
      same(r.Type_document, typeDocument) &&
      same(typeof r.Nom_projet === "object" ? r.Nom_projet.details : r.Nom_projet, nomProjet) &&
      same(r.NumeroDocument, numDocument) &&
      same(r.Designation, designation) &&
      same(r.Zone, zone) &&
      (r.Indice == null || r.Indice === "") &&
      (r.DateDiffusion == null || r.DateDiffusion === "")
    );

    if (placeholder?.id) {
      actionsUpsert.push(["UpdateRecord", "ListePlan_NDC_COF", placeholder.id, { Indice: indice, DateDiffusion: isoDate }]);
    } else {
      actionsUpsert.push(["AddRecord", "ListePlan_NDC_COF", null, {
        NumeroDocument: numDocument,
        Type_document: typeDocument,
        Designation: designation,
        Nom_projet: nomProjet,
        Zone: zone || "",
        Indice: indice,
        DateDiffusion: isoDate
      }]);
    }

    // ✅ Mise à jour visuelle immédiate (même si Grist met 0.5s à refresh)
    td.classList.remove("missing-date-error", "multi-date-error");
    td.textContent = formatDate(isoDate);
  }

  // Appliquer en batches (évite les gros payloads si beaucoup de lignes)
  const applyBatches = async (actions, batchSize = 200) => {
    for (let i = 0; i < actions.length; i += batchSize) {
      await grist.docApi.applyUserActions(actions.slice(i, i + batchSize));
    }
  };

  try {
    if (actionsUpsert.length) await applyBatches(actionsUpsert, 200);
    if (actionsDelete.length) await applyBatches(actionsDelete, 200);
    await syncPlanningProjetIndicesFromListeDePlan();
  } catch (err) {
    console.error("Erreur remplissage colonne :", err);
    alert("Erreur lors du remplissage de la colonne (regarde la console).");
  }
}
