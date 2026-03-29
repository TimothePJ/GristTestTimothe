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
  deleteOption.addEventListener("click", () => {
    supprimerLigne(targetCell); // Pass the specific cell
    removeExistingContextMenu();
  });
  menu.appendChild(deleteOption);

  document.body.appendChild(menu);
});

document.addEventListener("click", removeExistingContextMenu);

function removeExistingContextMenu() {
  const existing = document.getElementById("customContextMenu");
  if (existing) existing.remove();
}

function supprimerLigne(cell) {
  const tr = cell.closest('tr');
  let recordIdsToDelete = [];

  // Case 1: A specific date cell (.indice) was clicked
  if (cell.classList.contains('indice') && cell.dataset.recordId) {
    recordIdsToDelete.push(parseInt(cell.dataset.recordId, 10));
  }
  // Case 2: The document or designation cell was clicked, delete all records for this document/designation
  else if (cell.cellIndex === 0 || cell.cellIndex === 1) {
    const numDocument = cell.dataset.numDocument;
    const designation = cell.dataset.designation;
    const recordsToFind = window.records.filter(r => r.NumeroDocument === numDocument && r.Designation === designation);
    recordIdsToDelete = recordsToFind.map(r => r.id);
  }

  const uniqueRecordIds = [...new Set(recordIdsToDelete)].filter(Boolean);

  if (uniqueRecordIds.length === 0) {
    // If it's the "add" row, just clear it visually.
    if (tr.querySelector('td.ajout')) {
      const cellsToClear = tr.querySelectorAll('td');
      cellsToClear.forEach(c => c.textContent = '');
    }
    return;
  }

  (async () => {
    try {
      const table = await grist.getTable();
      for (const id of uniqueRecordIds) {
        await table.destroy(id);
      }
      if (typeof syncPlanningProjetIndicesFromListeDePlan === "function") {
        await syncPlanningProjetIndicesFromListeDePlan();
      }
    } catch (err) {
      console.error("Suppression échouée", err);
      alert("La suppression a échoué. Vérifiez la console pour les erreurs.");
    }
  })();
  // Grist's onRecords will handle the UI update automatically.
}
