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
  const normalizedValue = normalizeContextMenuText(value);
  const normalizedProjectName = normalizeContextMenuText(projectName);
  const normalizedProjectId = projectId == null ? "" : normalizeContextMenuText(projectId);

  return (
    normalizedValue === normalizedProjectName ||
    (normalizedProjectId !== "" && normalizedValue === normalizedProjectId)
  );
}

async function getContextMenuProjectId(projectName) {
  try {
    if (typeof chargerProjetsMap === "function") {
      const projetsMap = await chargerProjetsMap();
      return projetsMap?.[normalizeContextMenuText(projectName)] ?? null;
    }
  } catch (err) {
    console.error("Impossible de charger la map projets pour la suppression :", err);
  }
  return null;
}

function rowMatchesDocumentContext(row, {
  projectColumn,
  typeColumn,
  zoneColumn,
  designationColumns,
  numeroField,
  numDocument,
  designation,
  typeDocument,
  nomProjet,
  zone,
  projectId
}) {
  if (row?.id == null) return false;
  if (normalizeContextMenuText(row[numeroField]) !== normalizeContextMenuText(numDocument)) return false;

  if (projectColumn && !matchesContextMenuProject(row[projectColumn], nomProjet, projectId)) {
    return false;
  }

  if (typeColumn && normalizeContextMenuText(typeDocument)) {
    if (normalizeContextMenuText(row[typeColumn]) !== normalizeContextMenuText(typeDocument)) {
      return false;
    }
  }

  if (zoneColumn && normalizeContextMenuText(row[zoneColumn]) !== normalizeContextMenuText(zone)) {
    return false;
  }

  if (designationColumns.length > 0) {
    const matchesDesignation = designationColumns.some(
      (columnName) => normalizeContextMenuText(row[columnName]) === normalizeContextMenuText(designation)
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
  nomProjet,
  zone
}) {
  const actions = [];
  const projectId = await getContextMenuProjectId(nomProjet);

  try {
    const referencesRaw = await grist.docApi.fetchTable("References");
    const referenceRows = normalizeContextMenuRows(referencesRaw);
    const referenceColumns = getContextMenuColumnNames(referencesRaw, referenceRows);

    if (referenceColumns.has("NumeroDocument")) {
      const projectColumn = findContextMenuColumn(referenceColumns, ["NomProjet", "Nom_projet"]);
      const typeColumn = findContextMenuColumn(referenceColumns, ["Type_document", "TypeDocument"]);
      const zoneColumn = findContextMenuColumn(referenceColumns, ["Zone"]);
      const designationColumns = ["NomDocument", "Designation"].filter((name) => referenceColumns.has(name));

      for (const row of referenceRows) {
        if (rowMatchesDocumentContext(row, {
          projectColumn,
          typeColumn,
          zoneColumn,
          designationColumns,
          numeroField: "NumeroDocument",
          numDocument,
          designation,
          typeDocument,
          nomProjet,
          zone,
          projectId
        })) {
          actions.push(["RemoveRecord", "References", row.id]);
        }
      }
    }
  } catch (err) {
    console.error("Erreur lors de la préparation de suppression dans References :", err);
  }

  try {
    const planningRaw = await grist.docApi.fetchTable("Planning_Projet");
    const planningRows = normalizeContextMenuRows(planningRaw);
    const planningColumns = getContextMenuColumnNames(planningRaw, planningRows);
    const numeroField = findContextMenuColumn(planningColumns, ["ID2", "NumeroDocument"]);

    if (numeroField) {
      const projectColumn = findContextMenuColumn(planningColumns, ["NomProjet", "Nom_projet"]);
      const typeColumn = findContextMenuColumn(planningColumns, ["Type_doc", "Type_document", "TypeDoc"]);
      const zoneColumn = findContextMenuColumn(planningColumns, ["Zone"]);
      const designationColumns = ["Taches", "Tache", "Designation"].filter((name) => planningColumns.has(name));

      const exactPlanningMatches = planningRows.filter((row) =>
        rowMatchesDocumentContext(row, {
          projectColumn,
          typeColumn,
          zoneColumn,
          designationColumns,
          numeroField,
          numDocument,
          designation,
          typeDocument,
          nomProjet,
          zone,
          projectId
        })
      );

      const planningRowsToDelete = exactPlanningMatches.length
        ? exactPlanningMatches
        : planningRows.filter((row) =>
            rowMatchesDocumentContext(row, {
              projectColumn,
              typeColumn,
              zoneColumn: null,
              designationColumns,
              numeroField,
              numDocument,
              designation,
              typeDocument,
              nomProjet,
              zone,
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
    const zone = normalizeContextMenuText(cell.dataset.zone);

    const recordsToDelete = (window.records || [])
      .filter((r) =>
        normalizeContextMenuText(r.NumeroDocument) === numDocument &&
        normalizeContextMenuText(r.Designation) === designation &&
        normalizeContextMenuText(r.Type_document) === typeDocument &&
        normalizeContextMenuText(r.Zone) === zone &&
        normalizeContextMenuText(r.Nom_projet) === nomProjet
      )
      .map((r) => r.id)
      .filter(Boolean);

    if (recordsToDelete.length === 0) return;

    const actions = recordsToDelete.map((id) => ["RemoveRecord", "ListePlan_NDC_COF", id]);

    try {
      const linkedActions = await buildLinkedDeletionActions({
        numDocument,
        designation,
        typeDocument,
        nomProjet,
        zone
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
