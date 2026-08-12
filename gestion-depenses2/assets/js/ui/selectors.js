function fillSelect(selectEl, options, { placeholder = "", selectedValue = "" } = {}) {
  selectEl.innerHTML = "";

  if (placeholder) {
    const firstOption = document.createElement("option");
    firstOption.value = "";
    firstOption.textContent = placeholder;
    selectEl.appendChild(firstOption);
  }

  options.forEach((optionConfig) => {
    const option = document.createElement("option");
    option.value = String(optionConfig.value);
    option.textContent = optionConfig.label;
    Object.entries(optionConfig.dataset || {}).forEach(([key, value]) => {
      if (value != null && String(value).trim()) option.dataset[key] = String(value);
    });
    selectEl.appendChild(option);
  });

  selectEl.value = String(selectedValue ?? "");
  if (selectEl.value !== String(selectedValue ?? "")) {
    selectEl.value = "";
  }
}

function normalizeRole(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getWorkerDisplayName(member) {
  return `${member?.firstName || ""} ${member?.lastName || ""}`.trim();
}

function getWorkerRoleGroup(role) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole.includes("projeteur")) {
    return "Projeteurs";
  }
  if (normalizedRole.includes("ingenieur")) {
    return "Ingenieurs";
  }
  return "Autres";
}

export function getAvailableTeamMembers(teamMembers, project = null) {
  const existingNames = new Set(
    (project?.workers || []).map((worker) => normalizeName(worker?.name))
  );
  const uniqueMembersByName = new Map();

  (teamMembers || []).forEach((member) => {
    const displayName = getWorkerDisplayName(member);
    const personKey = normalizeName(displayName);

    // Une personne peut avoir plusieurs lignes Team pour ses differentes
    // adresses mail. Pour l'affectation projet, son prenom + nom constituent une
    // seule identite et la premiere ligne conserve un id Grist valide a utiliser.
    if (
      !personKey ||
      existingNames.has(personKey) ||
      uniqueMembersByName.has(personKey)
    ) {
      return;
    }

    uniqueMembersByName.set(personKey, member);
  });

  return [...uniqueMembersByName.values()].sort((left, right) =>
    getWorkerDisplayName(left).localeCompare(getWorkerDisplayName(right), "fr", {
      sensitivity: "base",
    })
  );
}

export function renderProjectOptions(projectSelect, projects, selectedProjectId) {
  fillSelect(
    projectSelect,
    (projects || []).map((project) => ({
      value: project.id,
      label: `${project.projectNumber} - ${project.name}`,
      dataset: {
        projectId: project.id,
        projectNumber: project.projectNumber,
      },
    })),
    {
      placeholder: "Choisir un projet",
      selectedValue: selectedProjectId ?? "",
    }
  );
}

export function renderWorkerOptions(workerSelect, teamMembers, project = null) {
  workerSelect.innerHTML = "";

  const availableMembers = getAvailableTeamMembers(teamMembers, project);

  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = availableMembers.length
    ? "Choisir un collaborateur"
    : "Tous les collaborateurs sont deja ajoutes";
  workerSelect.appendChild(placeholderOption);

  const groupedMembers = new Map([
    ["Projeteurs", []],
    ["Ingenieurs", []],
    ["Autres", []],
  ]);

  availableMembers.forEach((member) => {
    groupedMembers.get(getWorkerRoleGroup(member?.role))?.push(member);
  });

  groupedMembers.forEach((members, groupLabel) => {
    if (!members.length) {
      return;
    }

    const group = document.createElement("optgroup");
    group.label = groupLabel;

    members.forEach((member) => {
      const option = document.createElement("option");
      option.value = String(member.id);
      option.textContent = getWorkerDisplayName(member);
      group.appendChild(option);
    });

    workerSelect.appendChild(group);
  });

  workerSelect.disabled = availableMembers.length === 0;
  workerSelect.value = "";
}
