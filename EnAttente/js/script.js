let selectedProject = "";

const firstDropdown = document.getElementById("firstColumnDropdown");
const secondDropdown = document.getElementById("secondColumnListbox");

// 2e dropdown fixe : Tous
secondDropdown.innerHTML = `<option value="ALL">Tous</option>`;
secondDropdown.disabled = true;

function populateFirstColumnDropdown(values) {
  const current = firstDropdown.value;

  firstDropdown.innerHTML = '<option value="">Selectionner un projet</option>';
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    firstDropdown.appendChild(opt);
  });

  firstDropdown.value = current || "";
}

function computeCountsForProject(project) {
  let countNotBlocking = 0;
  let countBlocking = 0;

  (App.records || []).forEach(rec => {
    if (!rec) return;
    if (String(rec.NomProjet || "").trim() !== project) return;

    if (!isEnAttente(rec)) return;

    if (getBloquant(rec)) countBlocking++;
    else countNotBlocking++;
  });

  return { countNotBlocking, countBlocking };
}

function refresh() {
  const projects = uniqProjects(App.records);
  populateFirstColumnDropdown(projects);

  if (!selectedProject) {
    renderPieChart({ project: "", countNotBlocking: 0, countBlocking: 0 });
    return;
  }

  const { countNotBlocking, countBlocking } = computeCountsForProject(selectedProject);
  renderPieChart({ project: selectedProject, countNotBlocking, countBlocking });
}

firstDropdown.addEventListener("change", () => {
  selectedProject = firstDropdown.value.trim();
  refresh();
});

// Démarrage (reçoit les records)
initGrist(() => {
  // si l’utilisateur avait déjà un projet sélectionné, on le garde
  selectedProject = firstDropdown.value.trim();
  refresh();
});
