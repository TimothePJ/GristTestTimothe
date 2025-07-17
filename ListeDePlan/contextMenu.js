document.addEventListener("contextmenu", function (e) {
  const tr = e.target.closest("tr");
  if (!tr || !tr.querySelector("[data-record-id]")) return;

  e.preventDefault();
  removeExistingContextMenu();

  const menu = document.createElement("div");
  menu.id = "customContextMenu";
  menu.className = "context-menu";
  menu.style.top = `${e.pageY}px`;
  menu.style.left = `${e.pageX}px`;

  const deleteOption = document.createElement("div");
  deleteOption.className = "context-menu-item";
  deleteOption.textContent = "Supprimer";
  deleteOption.addEventListener("click", () => {
    supprimerLigne(tr);
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

function supprimerLigne(tr) {
  const tds = Array.from(tr.querySelectorAll("[data-record-id]"));
  const recordIds = tds.map(td => parseInt(td.dataset.recordId)).filter(Boolean);
  
  if (recordIds.length === 0) return;

  const actions = recordIds.map(id => ["RemoveRecord", "ListePlan_NDC_COF", id]);

  grist.docApi.applyUserActions(actions).then(() => {
    tr.remove();
  }).catch(err => {
    console.error("Suppression échouée", err);
  });
}
