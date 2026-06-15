const CONTEXT_MENU_DEFAULT_DOCUMENT_TYPES = [
  "COFFRAGE",
  "ARMATURES",
  "COUPES",
  "DÉMOLITION",
  "NDC"
];
const CONTEXT_MENU_LISTEPLAN_TABLE_CANDIDATES = [
  "ListePlan_NDC_COF",
  "ListePlan NDC+COF",
  "ListePlan_NDC+COF"
];
const CONTEXT_MENU_PLANNING_TABLE_CANDIDATES = [
  "Planning_Projet",
  "Planning_Project"
];

document.addEventListener("contextmenu", function (e) {
  const targetCell = e.target.closest("td");
  if (!targetCell) return;

  const tr = targetCell.closest("tr");
  if (!tr) return;

  // Only show context menu for rows that represent a document (even if dateless) or the add row.
  const isDataRow = tr.querySelector("[data-num-document]");
  const isAjoutRow = tr.querySelector("td.ajout");
  if (!isDataRow && !isAjoutRow) return;

  e.preventDefault();
  removeExistingContextMenu();

  const menu = document.createElement("div");
  menu.id = "customContextMenu";
  menu.className = "context-menu";
  menu.style.top = `${e.pageY}px`;
  menu.style.left = `${e.pageX}px`;

  // Evite que le clic à l'intérieur du menu se propage et ferme aussitôt le menu
  menu.addEventListener("click", (ev) => ev.stopPropagation());

  if (isDataRow && (targetCell.cellIndex === 0 || targetCell.cellIndex === 1)) {
    const modifyTypeOption = document.createElement("div");
    modifyTypeOption.className = "context-menu-item";
    modifyTypeOption.textContent = "Modifier Type Document";
    modifyTypeOption.addEventListener("click", async () => {
      removeExistingContextMenu();
      await showModifyDocumentTypeDialog(targetCell);
    });
    menu.appendChild(modifyTypeOption);
  }

  // Option: Supprimer
  const deleteOption = document.createElement("div");
  deleteOption.className = "context-menu-item";
  deleteOption.textContent = "Supprimer";
  deleteOption.addEventListener("click", async () => {
    removeExistingContextMenu();
    await supprimerLigne(targetCell);
  });
  menu.appendChild(deleteOption);

  document.body.appendChild(menu);
});

document.addEventListener("click", removeExistingContextMenu);

function removeExistingContextMenu() {
  const existing = document.getElementById("customContextMenu");
  if (existing) existing.remove();
}

function normalizeContextMenuText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if (typeof value.details === "string") return value.details.trim();
    if (typeof value.display === "string") return value.display.trim();
    if (typeof value.label === "string") return value.label.trim();
    if (typeof value.name === "string") return value.name.trim();
  }
  return String(value).trim();
}

function normalizeContextMenuIdentityText(value) {
  return normalizeContextMenuText(value)
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("fr");
}

function normalizeContextMenuRows(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.records)) return raw.records;
  if (typeof raw === "object") {
    const keys = Object.keys(raw);
    if (!keys.length) return [];
    const maxLen = Math.max(...keys.map((key) => (Array.isArray(raw[key]) ? raw[key].length : 0)));
    if (maxLen <= 0) return [];

    const rows = [];
    for (let index = 0; index < maxLen; index += 1) {
      const row = {};
      for (const key of keys) {
        row[key] = Array.isArray(raw[key]) ? raw[key][index] : undefined;
      }
      rows.push(row);
    }
    return rows;
  }
  return [];
}

function getContextMenuColumnNames(raw, rows = []) {
  const names = new Set(Object.keys(raw || {}));
  for (const row of rows) {
    Object.keys(row || {}).forEach((key) => names.add(key));
  }
  return names;
}

function findContextMenuColumn(columnNames, candidates) {
  return candidates.find((name) => columnNames.has(name)) || null;
}

function matchesContextMenuProject(value, projectName, projectId = null) {
  const normalizedValue = normalizeContextMenuIdentityText(value);
  const normalizedProjectName = normalizeContextMenuIdentityText(projectName);
  const normalizedProjectId = projectId == null ? "" : normalizeContextMenuIdentityText(projectId);

  return (
    normalizedValue === normalizedProjectName ||
    (normalizedProjectId !== "" && normalizedValue === normalizedProjectId)
  );
}

function normalizeContextMenuType(value) {
  return normalizeContextMenuText(value).toLocaleUpperCase("fr");
}

function normalizeContextMenuProjectKey(value) {
  return normalizeContextMenuText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr");
}

function normalizeContextMenuTypeKey(value) {
  return normalizeContextMenuType(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "");
}

function isDefaultContextMenuDocumentType(value) {
  const key = normalizeContextMenuTypeKey(value);
  return CONTEXT_MENU_DEFAULT_DOCUMENT_TYPES.some(
    (type) => normalizeContextMenuTypeKey(type) === key
  );
}

function parseContextMenuProjectTypes(value) {
  return String(value ?? "")
    .split(/[;,\r\n]+/)
    .map(normalizeContextMenuType)
    .filter(Boolean);
}

function serializeContextMenuProjectTypes(types) {
  const seen = new Set();
  return (types || [])
    .map(normalizeContextMenuType)
    .filter((type) => {
      const key = normalizeContextMenuTypeKey(type);
      if (!key || isDefaultContextMenuDocumentType(type) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("; ");
}

// ── Helpers de réorganisation des dates Planning_Projet ──────────────────────

function contextMenuParseCalendarDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }
  if (typeof value === "number") {
    const abs = Math.abs(value);
    // Grist stocke les dates en secondes depuis epoch (1e8 < abs < 1e11).
    if (abs > 1e8 && abs < 1e11) {
      const d = new Date(value * 1000);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    // Certaines variantes stockent en jours depuis epoch.
    if (abs > 0 && abs < 1e6) {
      const d = new Date(value * 86400 * 1000);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    return null;
  }
  const str = String(value).trim();
  if (!str) return null;
  const fr = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (fr) return new Date(+fr[3], +fr[2] - 1, +fr[1]);
  const iso = new Date(str);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function contextMenuFormatIsoDate(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function contextMenuSubtractWeeks(date, weeks) {
  if (!date) return null;
  const d = new Date(date);
  d.setDate(d.getDate() - weeks * 7);
  return d;
}

function contextMenuToInteger(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function isContextMenuArmaturesType(value) {
  return String(value ?? "").toUpperCase().includes("ARMATURE");
}

function isContextMenuCoffrageType(value) {
  return String(value ?? "").toUpperCase().includes("COFFRAGE");
}

/**
 * Renvoie les champs à mettre à jour dans Planning_Projet lors d'un
 * changement de type, afin de conserver le même segment chronologique.
 *
 * ARMATURES → autre  : Diff_coffrage → Date_limite, Diff_armature → Diff_coffrage
 * autre → ARMATURES  : Date_limite effective → Diff_coffrage, Diff_coffrage → Diff_armature
 * Tout changement vers non-COFFRAGE/non-ARMATURES : vide le Groupe.
 */
function buildPlanningDateReorganizationFields(planningRow, oldTypeDoc, newTypeDoc) {
  const fields = {};
  const oldIsArmatures = isContextMenuArmaturesType(oldTypeDoc);
  const newIsArmatures = isContextMenuArmaturesType(newTypeDoc);
  const newIsCoffrage  = isContextMenuCoffrageType(newTypeDoc);

  if (!newIsCoffrage && !newIsArmatures) {
    fields["Groupe"] = "";
  }

  if (oldIsArmatures && !newIsArmatures) {
    // ARMATURES → autre
    const startDate = contextMenuParseCalendarDate(planningRow["Diff_coffrage"]);
    const endDate   = contextMenuParseCalendarDate(planningRow["Diff_armature"]);
    const duree2    = contextMenuToInteger(planningRow["Duree_2"]);

    const dateLimiteIso   = contextMenuFormatIsoDate(startDate);
    const diffCoffrageIso = contextMenuFormatIsoDate(endDate);

    if (dateLimiteIso)   fields["Date_limite"]   = dateLimiteIso;
    if (diffCoffrageIso) fields["Diff_coffrage"]  = diffCoffrageIso;
    fields["Duree_1"]      = duree2 ?? null;
    fields["Diff_armature"] = null;
    fields["Duree_2"]       = null;

  } else if (!oldIsArmatures && newIsArmatures) {
    // autre → ARMATURES
    const dateLimiteDate  = contextMenuParseCalendarDate(planningRow["Date_limite"]);
    const diffCoffrageDate = contextMenuParseCalendarDate(planningRow["Diff_coffrage"]);
    const duree1           = contextMenuToInteger(planningRow["Duree_1"]);

    // Date_limite effective = Diff_coffrage − Duree_1 semaines (préserve le segment affiché).
    const effectiveStart =
      diffCoffrageDate && duree1 != null && duree1 >= 0
        ? contextMenuSubtractWeeks(diffCoffrageDate, duree1)
        : dateLimiteDate;

    const newDiffCoffrageIso  = contextMenuFormatIsoDate(effectiveStart);
    const newDiffArmatureIso  = contextMenuFormatIsoDate(diffCoffrageDate);

    if (newDiffCoffrageIso)  fields["Diff_coffrage"]  = newDiffCoffrageIso;
    if (newDiffArmatureIso)  fields["Diff_armature"]  = newDiffArmatureIso;
    fields["Duree_2"]     = duree1 ?? null;
    fields["Date_limite"] = null;
    fields["Duree_1"]     = null;
  }

  return fields;
}

// ─────────────────────────────────────────────────────────────────────────────

function setDocumentTypeUpdateStatus(message, isError = false) {
  const status = document.getElementById("document-type-update-status");
  if (!status) return;
  status.textContent = String(message || "");
  status.classList.toggle("is-error", Boolean(isError));
}

async function collectContextMenuKnownTypes(projectName) {
  const types = new Map();
  const addType = (value) => {
    const type = normalizeContextMenuType(value);
    const key = normalizeContextMenuTypeKey(type);
    if (type && key && !types.has(key)) {
      types.set(key, type);
    }
  };

  CONTEXT_MENU_DEFAULT_DOCUMENT_TYPES.forEach(addType);
  (window.records || []).forEach((row) => {
    const rowProject = row?.Nom_projet ?? row?.NomProjet ?? row?.NomProjetString;
    if (normalizeContextMenuProjectKey(rowProject) === normalizeContextMenuProjectKey(projectName)) {
      addType(row?.Type_document ?? row?.Type_doc ?? row?.TypeDoc);
    }
  });

  const projectsRaw = await grist.docApi.fetchTable("Projets2");
  normalizeContextMenuRows(projectsRaw).forEach((row) => {
    const rowProject = row?.Nom_de_projet ?? row?.NomProjet ?? row?.NomProjetString;
    if (normalizeContextMenuProjectKey(rowProject) !== normalizeContextMenuProjectKey(projectName)) {
      return;
    }
    parseContextMenuProjectTypes(row?.TypeDoc).forEach(addType);
  });

  return [...types.values()].sort((left, right) =>
    left.localeCompare(right, "fr", { sensitivity: "base", numeric: true })
  );
}

async function showModifyDocumentTypeDialog(cell) {
  const dialog = document.getElementById("dlg-modify-document-type");
  const documentLabel = document.getElementById("modify-document-type-document");
  const currentTypeLabel = document.getElementById("modify-document-type-current");
  const input = document.getElementById("modify-document-type-input");
  const datalist = document.getElementById("modify-document-type-list");
  const status = document.getElementById("modify-document-type-status");
  const cancelButton = document.getElementById("modify-document-type-cancel");
  const applyButton = document.getElementById("modify-document-type-apply");
  const currentType = normalizeContextMenuType(cell?.dataset?.typeDocument);
  const projectName = normalizeContextMenuText(cell?.dataset?.nomProjet);
  const documentDescription = [
    normalizeContextMenuText(cell?.dataset?.numDocument),
    normalizeContextMenuText(cell?.dataset?.designation)
  ].filter(Boolean).join(" - ");

  if (
    !dialog ||
    !documentLabel ||
    !currentTypeLabel ||
    !input ||
    !datalist ||
    !status ||
    !cancelButton ||
    !applyButton ||
    typeof dialog.showModal !== "function"
  ) {
    const promptedType = window.prompt("Nouveau type de document :", currentType);
    if (promptedType == null) return;
    try {
      await modifierTypeDocument(cell, promptedType);
    } catch (error) {
      console.error("Modification du type de document échouée :", error);
      setDocumentTypeUpdateStatus(error?.message || "La modification a échoué.", true);
      alert(error?.message || "La modification du type de document a échoué.");
    }
    return;
  }

  documentLabel.textContent = documentDescription || "Document sélectionné";
  currentTypeLabel.textContent = currentType || "Non renseigné";
  input.value = currentType;
  status.textContent = "Chargement des types disponibles...";
  status.classList.remove("is-error");
  cancelButton.disabled = false;
  applyButton.disabled = true;

  try {
    const knownTypes = await collectContextMenuKnownTypes(projectName);
    datalist.replaceChildren(
      ...knownTypes.map((type) => {
        const option = document.createElement("option");
        option.value = type;
        return option;
      })
    );
    status.textContent = "";
    applyButton.disabled = false;
  } catch (error) {
    console.error("Chargement des types de document impossible :", error);
    status.textContent = "Impossible de charger les types de document.";
    status.classList.add("is-error");
  }

  let applying = false;
  const cleanup = () => {
    cancelButton.removeEventListener("click", onCancel);
    applyButton.removeEventListener("click", onApply);
    input.removeEventListener("keydown", onKeyDown);
    dialog.removeEventListener("cancel", onCancel);
    dialog.removeEventListener("close", cleanup);
  };
  const closeDialog = () => {
    if (dialog.open) dialog.close();
  };
  const onCancel = (event) => {
    if (event) event.preventDefault();
    if (!applying) closeDialog();
  };
  const onKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void onApply(event);
    }
  };
  const onApply = async (event) => {
    if (event) event.preventDefault();
    if (applying) return;

    applying = true;
    applyButton.disabled = true;
    cancelButton.disabled = true;
    status.textContent = "Modification en cours...";
    status.classList.remove("is-error");

    try {
      input.value = normalizeContextMenuType(input.value);
      await modifierTypeDocument(cell, input.value);
      closeDialog();
    } catch (error) {
      console.error("Modification du type de document échouée :", error);
      status.textContent = error?.message || "La modification a échoué.";
      status.classList.add("is-error");
      applying = false;
      applyButton.disabled = false;
      cancelButton.disabled = false;
    }
  };

  cancelButton.addEventListener("click", onCancel);
  applyButton.addEventListener("click", onApply);
  input.addEventListener("keydown", onKeyDown);
  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("close", cleanup);
  dialog.showModal();
  input.focus();
  input.select();
}

async function fetchFirstContextMenuTable(candidates, label) {
  let lastError = null;
  for (const tableName of candidates) {
    try {
      const raw = await grist.docApi.fetchTable(tableName);
      const rows = normalizeContextMenuRows(raw);
      return {
        tableName,
        rows,
        columns: getContextMenuColumnNames(raw, rows)
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`${label} introuvable.`);
}

async function fetchExistingContextMenuTable(
  candidates,
  label,
  schemaByName,
  { required = false } = {}
) {
  const existingCandidates = candidates.filter((tableName) => schemaByName.has(tableName));
  if (!existingCandidates.length) {
    if (required) {
      throw new Error(`${label} introuvable.`);
    }
    return null;
  }
  return fetchFirstContextMenuTable(existingCandidates, label);
}

async function loadContextMenuSchema() {
  const [tablesRaw, columnsRaw] = await Promise.all([
    grist.docApi.fetchTable("_grist_Tables"),
    grist.docApi.fetchTable("_grist_Tables_column")
  ]);
  const tables = normalizeContextMenuRows(tablesRaw);
  const columns = normalizeContextMenuRows(columnsRaw);
  const byName = new Map();
  const byId = new Map();

  tables.forEach((row) => {
    const tableName = normalizeContextMenuText(row?.tableId);
    const tableId = Number(row?.id);
    if (!tableName || !Number.isInteger(tableId)) return;
    const table = { id: tableId, columns: new Map() };
    byName.set(tableName, table);
    byId.set(tableId, table);
  });
  columns.forEach((row) => {
    const parentId = Number(row?.parentId);
    const columnId = normalizeContextMenuText(row?.colId);
    if (!Number.isInteger(parentId) || !columnId) return;
    byId.get(parentId)?.columns.set(columnId, row);
  });

  return byName;
}

function isContextMenuFormulaColumn(columnMetadata) {
  const isFormula = columnMetadata?.isFormula;
  return (
    isFormula === true ||
    isFormula === 1 ||
    String(isFormula ?? "").toLocaleLowerCase("fr") === "true" ||
    Boolean(normalizeContextMenuText(columnMetadata?.formula))
  );
}

function getWritableContextMenuTypeColumns(context, schemaByName) {
  const candidates = ["Type_document", "Type_doc", "TypeDocument", "TypeDoc"]
    .filter((columnName) => context.columns.has(columnName));
  if (!candidates.length) {
    throw new Error(`Aucune colonne de type de document trouvée dans ${context.tableName}.`);
  }

  const tableSchema = schemaByName.get(context.tableName);
  if (!tableSchema) {
    throw new Error(`Métadonnées introuvables pour ${context.tableName}.`);
  }

  return candidates.filter((columnName) => {
    const metadata = tableSchema.columns.get(columnName);
    if (!metadata) {
      throw new Error(`Métadonnées introuvables pour ${context.tableName}.${columnName}.`);
    }
    return !isContextMenuFormulaColumn(metadata);
  });
}

function getContextMenuDocumentColumns(context) {
  const projectColumn = findContextMenuColumn(context.columns, [
    "Nom_projet",
    "NomProjet",
    "NomProjetString"
  ]);
  const numeroColumn = findContextMenuColumn(context.columns, ["NumeroDocument", "ID2"]);
  const typeColumn = findContextMenuColumn(context.columns, [
    "Type_document",
    "Type_doc",
    "TypeDocument",
    "TypeDoc"
  ]);
  const zoneColumn = findContextMenuColumn(context.columns, ["Zone"]);
  const designationColumns = [
    "Designation",
    "NomDocument",
    "Taches",
    "Tache"
  ].filter((name) => context.columns.has(name));

  if (!projectColumn || !numeroColumn || !typeColumn || !designationColumns.length) {
    throw new Error(
      `La structure de ${context.tableName} ne permet pas d'identifier strictement le document.`
    );
  }

  return {
    projectColumn,
    numeroColumn,
    typeColumn,
    zoneColumn,
    designationColumns
  };
}

function buildContextMenuProjectAliases(projectName, projectRows) {
  const requestedKey = normalizeContextMenuProjectKey(projectName);
  const aliases = new Set([requestedKey].filter(Boolean));
  const matchingRows = projectRows.filter((row) => {
    return [
      row?.id,
      row?.Nom_de_projet,
      row?.NomProjet,
      row?.NomProjetString,
      row?.Numero_de_projet,
      row?.NumeroProjet
    ].some((value) => normalizeContextMenuProjectKey(value) === requestedKey);
  });

  matchingRows.forEach((row) => {
    [
      row?.id,
      row?.Nom_de_projet,
      row?.NomProjet,
      row?.NomProjetString,
      row?.Numero_de_projet,
      row?.NumeroProjet
    ].forEach((value) => {
      const key = normalizeContextMenuProjectKey(value);
      if (key) aliases.add(key);
    });
  });

  return { aliases, matchingRows };
}

function rowMatchesStrictContextMenuDocument(row, columns, documentContext, projectAliases) {
  if (row?.id == null) return false;
  if (!projectAliases.has(normalizeContextMenuProjectKey(row?.[columns.projectColumn]))) return false;
  if (
    normalizeContextMenuIdentityText(row?.[columns.numeroColumn]) !==
    normalizeContextMenuIdentityText(documentContext.numDocument)
  ) return false;
  if (
    normalizeContextMenuIdentityText(row?.[columns.typeColumn]) !==
    normalizeContextMenuIdentityText(documentContext.typeDocument)
  ) return false;

  return columns.designationColumns.some(
    (columnName) =>
      normalizeContextMenuIdentityText(row?.[columnName]) ===
      normalizeContextMenuIdentityText(documentContext.designation)
  );
}

function mergeContextMenuUpdateAction(actionsByRow, tableName, rowId, fields) {
  const key = `${tableName}:${rowId}`;
  const existing = actionsByRow.get(key);
  if (existing) {
    Object.assign(existing[3], fields);
    return;
  }
  actionsByRow.set(key, ["UpdateRecord", tableName, rowId, { ...fields }]);
}

async function buildDocumentTypeUpdateActions(documentContext, newType) {
  const schemaByName = await loadContextMenuSchema();
  const [listePlan, references, planning, projects] = await Promise.all([
    fetchExistingContextMenuTable(
      CONTEXT_MENU_LISTEPLAN_TABLE_CANDIDATES,
      "Table ListePlan",
      schemaByName,
      { required: true }
    ),
    fetchExistingContextMenuTable(["References2"], "Table References2", schemaByName),
    fetchExistingContextMenuTable(
      CONTEXT_MENU_PLANNING_TABLE_CANDIDATES,
      "Table Planning",
      schemaByName
    ),
    fetchExistingContextMenuTable(["Projets2"], "Table Projets2", schemaByName, {
      required: true
    })
  ]);

  const { aliases: projectAliases, matchingRows: projectRows } =
    buildContextMenuProjectAliases(documentContext.nomProjet, projects.rows);
  if (!projectRows.length) {
    throw new Error(`Projet "${documentContext.nomProjet}" introuvable dans Projets2.`);
  }

  const sourceColumns = getContextMenuDocumentColumns(listePlan);
  const sourceRows = listePlan.rows.filter((row) =>
    rowMatchesStrictContextMenuDocument(row, sourceColumns, documentContext, projectAliases)
  );
  if (!sourceRows.length) {
    throw new Error("Le document a changé depuis l'ouverture du menu. Recharge la Liste de Plan.");
  }

  const targetIdentityExists = listePlan.rows.some((row) => {
    if (row?.id == null) return false;
    if (!projectAliases.has(normalizeContextMenuProjectKey(row?.[sourceColumns.projectColumn]))) {
      return false;
    }
    if (
      normalizeContextMenuIdentityText(row?.[sourceColumns.numeroColumn]) !==
      normalizeContextMenuIdentityText(documentContext.numDocument)
    ) return false;
    if (
      normalizeContextMenuIdentityText(row?.[sourceColumns.typeColumn]) !==
      normalizeContextMenuIdentityText(newType)
    ) return false;
    return sourceColumns.designationColumns.some(
      (columnName) =>
        normalizeContextMenuIdentityText(row?.[columnName]) ===
        normalizeContextMenuIdentityText(documentContext.designation)
    );
  });
  if (targetIdentityExists) {
    throw new Error(
      `Le document "${documentContext.numDocument} - ${documentContext.designation}" existe deja avec le type "${newType}".`
    );
  }

  const actionsByRow = new Map();
  const sourceRowIds = new Set(sourceRows.map((row) => Number(row.id)));
  for (const context of [listePlan, references, planning].filter(Boolean)) {
    const columns = getContextMenuDocumentColumns(context);
    const writableTypeColumns = getWritableContextMenuTypeColumns(context, schemaByName);
    if (context === listePlan && !writableTypeColumns.length) {
      throw new Error(`La colonne de type de document de ${context.tableName} n'est pas modifiable.`);
    }
    const matchingRows = context.rows.filter((row) =>
      rowMatchesStrictContextMenuDocument(row, columns, documentContext, projectAliases)
    );

    matchingRows.forEach((row) => {
      const fields = Object.fromEntries(
        writableTypeColumns.map((columnName) => [columnName, newType])
      );
      if (Object.keys(fields).length) {
        mergeContextMenuUpdateAction(actionsByRow, context.tableName, row.id, fields);
      }
    });
  }

  if (!projects.columns.has("TypeDoc")) {
    throw new Error("La colonne Projets2.TypeDoc est introuvable.");
  }
  const projectTypeDocMetadata = schemaByName.get("Projets2")?.columns?.get("TypeDoc");
  if (!projectTypeDocMetadata || isContextMenuFormulaColumn(projectTypeDocMetadata)) {
    throw new Error("La colonne Projets2.TypeDoc n'est pas modifiable.");
  }

  const resultingProjectTypes = listePlan.rows
    .filter((row) =>
      projectAliases.has(normalizeContextMenuProjectKey(row?.[sourceColumns.projectColumn]))
    )
    .map((row) =>
      sourceRowIds.has(Number(row.id)) ? newType : row?.[sourceColumns.typeColumn]
    );
  const serializedTypes = serializeContextMenuProjectTypes(resultingProjectTypes);
  projectRows.forEach((row) => {
    if (normalizeContextMenuText(row?.TypeDoc) === serializedTypes) return;
    mergeContextMenuUpdateAction(actionsByRow, "Projets2", row.id, {
      TypeDoc: serializedTypes
    });
  });

  // Réorganisation des dates/durées dans Planning_Projet lors du changement de type.
  if (planning) {
    const planningDocColumns = getContextMenuDocumentColumns(planning);
    const matchingPlanningRows = planning.rows.filter((row) =>
      rowMatchesStrictContextMenuDocument(row, planningDocColumns, documentContext, projectAliases)
    );
    for (const row of matchingPlanningRows) {
      const extraFields = buildPlanningDateReorganizationFields(
        row,
        documentContext.typeDocument,
        newType
      );
      if (Object.keys(extraFields).length > 0) {
        mergeContextMenuUpdateAction(actionsByRow, planning.tableName, row.id, extraFields);
      }
    }
  }

  return [...actionsByRow.values()];
}

async function modifierTypeDocument(cell, requestedType) {
  const documentContext = {
    numDocument: normalizeContextMenuText(cell?.dataset?.numDocument),
    designation: normalizeContextMenuText(cell?.dataset?.designation),
    typeDocument: normalizeContextMenuType(cell?.dataset?.typeDocument),
    nomProjet: normalizeContextMenuText(cell?.dataset?.nomProjet),
    zone: normalizeContextMenuText(cell?.dataset?.zone)
  };
  const newType = normalizeContextMenuType(requestedType);

  if (!newType) {
    throw new Error("Le type de document est obligatoire.");
  }
  if (newType === documentContext.typeDocument) {
    throw new Error("Le nouveau type est identique au type actuel.");
  }
  if (
    !documentContext.numDocument ||
    !documentContext.designation ||
    !documentContext.typeDocument ||
    !documentContext.nomProjet
  ) {
    throw new Error("Le document sélectionné ne contient pas toutes les informations requises.");
  }

  const actions = await buildDocumentTypeUpdateActions(documentContext, newType);
  if (!actions.length) {
    throw new Error("Aucune ligne à mettre à jour.");
  }
  if (!grist?.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions indisponible.");
  }

  await grist.docApi.applyUserActions(actions);
  return { updatedCount: actions.length };
}

async function getContextMenuProjectId(projectName) {
  try {
    if (typeof chargerProjetsMap === "function") {
      const projetsMap = await chargerProjetsMap();
      const requestedKey = normalizeContextMenuProjectKey(projectName);
      const matchingEntry = Object.entries(projetsMap || {}).find(
        ([candidateName]) => normalizeContextMenuProjectKey(candidateName) === requestedKey
      );
      return matchingEntry?.[1] ?? null;
    }
  } catch (err) {
    console.error("Impossible de charger la map projets pour la suppression :", err);
  }
  return null;
}

function rowMatchesDocumentContext(row, {
  projectColumn,
  typeColumn,
  designationColumns,
  numeroField,
  numDocument,
  designation,
  typeDocument,
  nomProjet,
  projectId
}) {
  if (row?.id == null) return false;
  if (!projectColumn || !typeColumn || !designationColumns.length) return false;
  if (
    normalizeContextMenuIdentityText(row[numeroField]) !==
    normalizeContextMenuIdentityText(numDocument)
  ) return false;

  if (projectColumn && !matchesContextMenuProject(row[projectColumn], nomProjet, projectId)) {
    return false;
  }

  if (typeColumn && normalizeContextMenuText(typeDocument)) {
    if (
      normalizeContextMenuIdentityText(row[typeColumn]) !==
      normalizeContextMenuIdentityText(typeDocument)
    ) {
      return false;
    }
  }

  if (designationColumns.length > 0) {
    const matchesDesignation = designationColumns.some(
      (columnName) =>
        normalizeContextMenuIdentityText(row[columnName]) ===
        normalizeContextMenuIdentityText(designation)
    );
    if (!matchesDesignation) {
      return false;
    }
  }

  return true;
}

async function buildLinkedDeletionActions({
  numDocument,
  designation,
  typeDocument,
  nomProjet
}) {
  const actions = [];
  const projectId = await getContextMenuProjectId(nomProjet);

  try {
    const referencesRaw = await grist.docApi.fetchTable("References2");
    const referenceRows = normalizeContextMenuRows(referencesRaw);
    const referenceColumns = getContextMenuColumnNames(referencesRaw, referenceRows);

    if (referenceColumns.has("NumeroDocument")) {
      const projectColumn = findContextMenuColumn(referenceColumns, ["NomProjetString", "NomProjet", "Nom_projet"]);
      const typeColumn = findContextMenuColumn(referenceColumns, ["Type_document", "TypeDocument"]);
      const designationColumns = ["NomDocument", "Designation"].filter((name) => referenceColumns.has(name));

      for (const row of referenceRows) {
        if (rowMatchesDocumentContext(row, {
          projectColumn,
          typeColumn,
          designationColumns,
          numeroField: "NumeroDocument",
          numDocument,
          designation,
          typeDocument,
          nomProjet,
          projectId
        })) {
          actions.push(["RemoveRecord", "References2", row.id]);
        }
      }
    }
  } catch (err) {
    console.error("Erreur lors de la préparation de suppression dans References2 :", err);
  }

  try {
    const planningRaw = await grist.docApi.fetchTable("Planning_Projet");
    const planningRows = normalizeContextMenuRows(planningRaw);
    const planningColumns = getContextMenuColumnNames(planningRaw, planningRows);
    const numeroField = findContextMenuColumn(planningColumns, ["ID2", "NumeroDocument"]);

    if (numeroField) {
      const projectColumn = findContextMenuColumn(planningColumns, ["NomProjetString", "NomProjet", "Nom_projet"]);
      const typeColumn = findContextMenuColumn(planningColumns, ["Type_doc", "Type_document", "TypeDoc"]);
      const designationColumns = ["Taches", "Tache", "Designation"].filter((name) => planningColumns.has(name));

      const planningRowsToDelete = planningRows.filter((row) =>
        rowMatchesDocumentContext(row, {
          projectColumn,
          typeColumn,
          designationColumns,
          numeroField,
          numDocument,
          designation,
          typeDocument,
          nomProjet,
          projectId
        })
      );

      for (const row of planningRowsToDelete) {
        if (row?.id != null) {
          actions.push(["RemoveRecord", "Planning_Projet", row.id]);
        }
      }
    }
  } catch (err) {
    console.error("Erreur lors de la préparation de suppression dans Planning_Projet :", err);
  }

  return actions;
}

function showDeleteDocumentConfirm(cell) {
  return new Promise((resolve) => {
    const dialog = document.getElementById("dlg-confirm-delete-document");
    const message = document.getElementById("confirm-delete-document-message");
    const cancelBtn = document.getElementById("confirm-delete-document-cancel");
    const confirmBtn = document.getElementById("confirm-delete-document-confirm");

    if (!dialog || !message || !cancelBtn || !confirmBtn || typeof dialog.showModal !== "function") {
      resolve(window.confirm("Es-tu sûr de vouloir supprimer ce document ?"));
      return;
    }

    const numDocument = normalizeContextMenuText(cell?.dataset?.numDocument);
    const designation = normalizeContextMenuText(cell?.dataset?.designation);
    const detail = [numDocument, designation].filter(Boolean).join(" - ");
    message.textContent = detail
      ? `Es-tu sûr de vouloir supprimer le document ${detail} ?`
      : "Es-tu sûr de vouloir supprimer ce document ?";

    let settled = false;
    const cleanup = () => {
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (dialog.open) {
        dialog.close();
      }
      resolve(value);
    };

    const onCancel = (event) => {
      if (event) event.preventDefault();
      finish(false);
    };

    const onConfirm = (event) => {
      if (event) event.preventDefault();
      finish(true);
    };

    const onClose = () => finish(dialog.returnValue === "confirm");

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);

    dialog.showModal();
  });
}

async function supprimerLigne(cell) {
  const tr = cell.closest("tr");
  if (!tr) return;

  const cellIndex = cell.cellIndex;
  const isDocumentCell = cellIndex === 0 || cellIndex === 1;
  const isDateCell = cell.classList.contains("indice");

  if (isDocumentCell) {
    const confirmed = await showDeleteDocumentConfirm(cell);
    if (!confirmed) return;

    const numDocument = normalizeContextMenuText(cell.dataset.numDocument);
    const designation = normalizeContextMenuText(cell.dataset.designation);
    const typeDocument = normalizeContextMenuText(cell.dataset.typeDocument);
    const nomProjet = normalizeContextMenuText(cell.dataset.nomProjet);
    const projectId = await getContextMenuProjectId(nomProjet);
    const recordsToDelete = (window.records || [])
      .filter((r) =>
        normalizeContextMenuIdentityText(r.NumeroDocument) ===
          normalizeContextMenuIdentityText(numDocument) &&
        normalizeContextMenuIdentityText(r.Designation) ===
          normalizeContextMenuIdentityText(designation) &&
        normalizeContextMenuIdentityText(r.Type_document) ===
          normalizeContextMenuIdentityText(typeDocument) &&
        matchesContextMenuProject(r.Nom_projet, nomProjet, projectId)
      )
      .map((r) => r.id)
      .filter(Boolean);

    if (recordsToDelete.length === 0) return;

    const listePlanTableName = typeof window.getActiveListePlanTableName === "function"
      ? await window.getActiveListePlanTableName()
      : "ListePlan_NDC_COF";
    const actions = recordsToDelete.map((id) => ["RemoveRecord", listePlanTableName, id]);

    try {
      const linkedActions = await buildLinkedDeletionActions({
        numDocument,
        designation,
        typeDocument,
        nomProjet
      });
      await grist.docApi.applyUserActions(actions.concat(linkedActions));
      if (typeof syncPlanningProjetIndicesFromListeDePlan === "function") {
        await syncPlanningProjetIndicesFromListeDePlan();
      }
    } catch (err) {
      console.error("Suppression du document échouée", err);
      alert("La suppression du document a échoué. Vérifie la console pour les erreurs.");
    }
    return;
  }

  if (isDateCell) {
    const actions = [];

    if (cell.dataset.recordId) {
      const recordId = parseInt(cell.dataset.recordId, 10);
      if (Number.isFinite(recordId)) {
        actions.push(["RemoveRecord", "ListePlan_NDC_COF", recordId]);
      }
    } else if (cell.dataset.conflicts) {
      try {
        const conflicts = JSON.parse(cell.dataset.conflicts);
        const keepId = parseInt(conflicts?.[0]?.id, 10);
        if (Number.isFinite(keepId)) {
          actions.push(["RemoveRecord", "ListePlan_NDC_COF", keepId]);
        }
        for (const conflict of (conflicts || []).slice(1)) {
          const id = parseInt(conflict?.id, 10);
          if (Number.isFinite(id)) {
            actions.push(["RemoveRecord", "ListePlan_NDC_COF", id]);
          }
        }
      } catch (err) {
        console.error("Impossible de lire les conflits de dates :", err);
      }
    }

    if (actions.length === 0) {
      if (tr.querySelector("td.ajout")) {
        const cellsToClear = tr.querySelectorAll("td");
        cellsToClear.forEach((c) => { c.textContent = ""; });
      }
      return;
    }

    try {
      await grist.docApi.applyUserActions(actions);
      if (typeof syncPlanningProjetIndicesFromListeDePlan === "function") {
        await syncPlanningProjetIndicesFromListeDePlan();
      }
    } catch (err) {
      console.error("Suppression de la date échouée", err);
      alert("La suppression de la date a échoué. Vérifie la console pour les erreurs.");
    }
    return;
  }

  if (tr.querySelector("td.ajout")) {
    const cellsToClear = tr.querySelectorAll("td");
    cellsToClear.forEach((c) => { c.textContent = ""; });
  }
}
