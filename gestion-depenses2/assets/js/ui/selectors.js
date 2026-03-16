import { APP_CONFIG } from "../config.js";

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

export function renderWorkerOptions(workerSelect, teamMembers) {
  fillSelect(
    workerSelect,
    (teamMembers || []).map((member) => ({
      value: member.id,
      label: `${member.firstName} ${member.lastName}`.trim(),
    })),
    {
      placeholder: "Choisir un collaborateur",
      selectedValue: "",
    }
  );
}

export function populateYearOptions(yearSelect, selectedYear) {
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - APP_CONFIG.yearWindow.before;
  const endYear = currentYear + APP_CONFIG.yearWindow.after;

  const options = [];
  for (let year = startYear; year <= endYear; year += 1) {
    options.push({ value: year, label: String(year) });
  }

  fillSelect(yearSelect, options, { selectedValue: selectedYear });
}

export function renderCurrentMonthYear(targetEl, selectedMonth, selectedYear) {
  targetEl.innerHTML = `${APP_CONFIG.months[selectedMonth] || ""}<br>${selectedYear}`;
}
