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

export function renderProjectOptions(projectSelect, projects, selectedProjectId) {
  fillSelect(
    projectSelect,
    (projects || []).map((project) => ({
      value: project.id,
      label: `${project.projectNumber} - ${project.name}`.trim(),
    })),
    {
      placeholder: "Choisir un projet",
      selectedValue: selectedProjectId ?? "",
    }
  );
}

export function renderWorkerOptions(workerSelect, teamMembers, project = null) {
  workerSelect.innerHTML = "";

  const existingNames = new Set(
    (project?.workers || []).map((worker) => normalizeName(worker?.name))
  );

  const availableMembers = (teamMembers || [])
    .filter((member) => !existingNames.has(normalizeName(getWorkerDisplayName(member))))
    .sort((left, right) =>
      getWorkerDisplayName(left).localeCompare(getWorkerDisplayName(right), "fr", {
        sensitivity: "base",
      })
    );

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
