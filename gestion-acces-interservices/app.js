(function initProjectAccessAdministration(window) {
  "use strict";

  const core = window.GristServiceContextCore;
  const state = {
    teamRows: [],
    projectTeamRows: [],
    projects: [],
    currentAdmin: null,
    selectedProjectNumber: "",
    busy: false,
    initialized: false,
    renderedSignature: "",
  };

  const dom = {
    adminStatus: document.getElementById("admin-status"),
    workspace: document.getElementById("workspace"),
    fatalPanel: document.getElementById("fatal-panel"),
    fatalMessage: document.getElementById("fatal-message"),
    projectCount: document.getElementById("project-count"),
    projectSearch: document.getElementById("project-search"),
    projectSelect: document.getElementById("project-select"),
    projectNumber: document.getElementById("project-number"),
    projectName: document.getElementById("project-name"),
    projectAliases: document.getElementById("project-aliases"),
    assigneesSummary: document.getElementById("assignees-summary"),
    assigneesCount: document.getElementById("assignees-count"),
    assigneesList: document.getElementById("assignees-list"),
    unresolvedPanel: document.getElementById("unresolved-panel"),
    unresolvedSummary: document.getElementById("unresolved-summary"),
    unresolvedList: document.getElementById("unresolved-list"),
    personSearch: document.getElementById("person-search"),
    personSelect: document.getElementById("person-select"),
    selectionHelp: document.getElementById("selection-help"),
    addButton: document.getElementById("add-button"),
    formMessage: document.getElementById("form-message"),
  };
  const frenchCollator = new Intl.Collator("fr", {
    numeric: true,
    sensitivity: "base",
  });

  function setStatus(message, type = "") {
    dom.adminStatus.textContent = message;
    dom.adminStatus.className = `status${type ? ` is-${type}` : ""}`;
  }

  function setMessage(message, type = "") {
    dom.formMessage.textContent = message || "";
    dom.formMessage.className = `message${type ? ` is-${type}` : ""}`;
  }

  function fail(message) {
    setStatus("Bloqué", "error");
    dom.workspace.hidden = true;
    dom.fatalPanel.hidden = false;
    dom.fatalMessage.textContent = message;
  }

  function setBusy(busy, busyLabel = "Action en cours…") {
    state.busy = busy;
    dom.workspace.setAttribute("aria-busy", String(busy));
    dom.addButton.textContent = busy ? busyLabel : "Ajouter au projet";
    dom.addButton.setAttribute("aria-busy", String(busy));
    dom.addButton.disabled = busy || !dom.personSelect.selectedOptions.length;
    dom.projectSelect.disabled = busy || !dom.projectSelect.options.length;
    dom.projectSearch.disabled = busy;
    dom.personSearch.disabled = busy || !selectedProject();
    dom.personSelect.disabled = busy || !dom.personSelect.options.length;
    dom.assigneesList.querySelectorAll("button").forEach((button) => {
      button.disabled = busy;
    });
  }

  function selectedProject() {
    return state.projects.find(
      (project) => project.number === state.selectedProjectNumber
    ) || null;
  }

  function normalizedSearch(value) {
    return core.normalizePersonName(value);
  }

  function matchesSearch(values, query) {
    if (!query) return true;
    return normalizedSearch(values.filter(Boolean).join(" ")).includes(query);
  }

  function uniqueSortedLabels(values) {
    const labelsByKey = new Map();
    (Array.isArray(values) ? values : []).forEach((value) => {
      const label = core.toText(value);
      const key = normalizedSearch(label);
      if (key && !labelsByKey.has(key)) labelsByKey.set(key, label);
    });
    const labels = [...labelsByKey.values()];
    return labels.sort((left, right) => frenchCollator.compare(left, right));
  }

  function getPersonServices(person) {
    return uniqueSortedLabels(person?.homeServices?.length
      ? person.homeServices
      : person?.services);
  }

  function getPersonRoles(person) {
    const projectRoles = uniqueSortedLabels(person?.roles);
    if (projectRoles.length) return projectRoles;
    return uniqueSortedLabels(
      (Array.isArray(person?.teamRows) ? person.teamRows : [])
        .map((teamRow) => teamRow?.Role)
    );
  }

  function getBusinessPersonName(personOrLabel) {
    const rawLabel = typeof personOrLabel === "object"
      ? personOrLabel?.personName ?? personOrLabel?.name
      : personOrLabel;
    const label = core.toText(rawLabel);
    return /^Ligne Team \d+$/i.test(label) ? "Profil sans nom" : (label || "Profil sans nom");
  }

  function compareOptionalLabelLists(leftValues, rightValues) {
    const left = uniqueSortedLabels(leftValues).join(" · ");
    const right = uniqueSortedLabels(rightValues).join(" · ");
    if (!left && right) return 1;
    if (left && !right) return -1;
    return frenchCollator.compare(left, right);
  }

  function comparePeopleByServiceRoleName(left, right) {
    return compareOptionalLabelLists(getPersonServices(left), getPersonServices(right)) ||
      compareOptionalLabelLists(getPersonRoles(left), getPersonRoles(right)) ||
      frenchCollator.compare(getBusinessPersonName(left), getBusinessPersonName(right)) ||
      frenchCollator.compare(core.toText(left?.personKey), core.toText(right?.personKey));
  }

  function signalAssignmentsChanged(teamIds, operation) {
    try {
      localStorage.setItem(core.ACCESS_CHANGED_STORAGE_KEY, JSON.stringify({
        version: core.ACCESS_SIGNAL_VERSION,
        at: Date.now(),
        source: "gestion-acces-interservices",
        operation,
        teamIds,
        projectNumber: state.selectedProjectNumber,
      }));
    } catch (_error) {
      // Le rafraîchissement au focus reste disponible si localStorage est bloqué.
    }
  }

  // Empreinte des données affichées : ce widget n'a pas de runtime partagé pour
  // filtrer les livraisons inutiles, il compare donc lui-même avant de re-rendre.
  function computeDataSignature() {
    try {
      return JSON.stringify([state.teamRows, state.projectTeamRows, state.projects]);
    } catch (_error) {
      return `illisible-${Date.now()}`;
    }
  }

  // Un re-rendu reconstruit les listes : sans reprise, le navigateur ramène le
  // défilement en haut de page et remonte la liste des personnes disponibles.
  function captureWorkspaceScroll() {
    const scroller = document.scrollingElement || document.documentElement;
    const documentTop = scroller ? scroller.scrollTop : 0;
    const peopleTop = dom.personSelect.scrollTop;

    return () => {
      const restore = () => {
        if (scroller) scroller.scrollTop = documentTop;
        dom.personSelect.scrollTop = peopleTop;
      };
      // Une fois tout de suite, une fois après la mise en page : la hauteur des
      // lignes d'affectation n'est pas figée au premier passage.
      restore();
      requestAnimationFrame(restore);
    };
  }

  function createBadge(label, className = "") {
    const badge = document.createElement("span");
    badge.className = `badge${className ? ` ${className}` : ""}`;
    badge.textContent = label;
    return badge;
  }

  function populateProjects() {
    const query = normalizedSearch(dom.projectSearch.value);
    const visibleProjects = state.projects.filter((project) => matchesSearch([
      project.number,
      project.name,
      ...(project.names || []),
    ], query));
    dom.projectSelect.replaceChildren();
    visibleProjects.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.number;
      option.textContent = `${project.number} — ${project.name || "Projet sans nom"}`;
      dom.projectSelect.appendChild(option);
    });
    dom.projectCount.textContent = query
      ? `${visibleProjects.length}/${state.projects.length}`
      : String(state.projects.length);
    dom.projectSelect.disabled = state.busy || !visibleProjects.length;

    if (!visibleProjects.some((project) => project.number === state.selectedProjectNumber)) {
      state.selectedProjectNumber = visibleProjects[0]?.number || "";
    }
    dom.projectSelect.value = state.selectedProjectNumber;
    renderSelectedProject();
  }

  function renderSelectedProject() {
    const project = selectedProject();
    dom.projectNumber.textContent = project?.number || "—";
    dom.projectName.textContent = project?.name || "Aucun projet sélectionné";
    const aliases = (project?.names || []).filter((name) => name !== project.name);
    dom.projectAliases.textContent = aliases.length
      ? `Autres libellés : ${aliases.join(" · ")}`
      : "";
    renderAssignments();
  }

  function renderAssignmentRow(assignee, project) {
    const row = document.createElement("article");
    row.className = "assignee-row";
    row.setAttribute("role", "listitem");

    const identity = document.createElement("div");
    identity.className = "assignee-identity";
    identity.dataset.label = "Personne";
    const name = document.createElement("strong");
    name.textContent = getBusinessPersonName(assignee);
    const email = document.createElement("small");
    email.textContent = assignee.emails.length
      ? assignee.emails.join(" · ")
      : "Adresse e-mail non renseignée";
    identity.append(name, email);

    const service = document.createElement("div");
    service.className = "assignee-service badges";
    service.dataset.label = "Service";
    const services = getPersonServices(assignee);
    if (services.length) {
      services.forEach((homeService) => {
        service.appendChild(createBadge(homeService, "service"));
      });
    } else {
      service.appendChild(createBadge("Service non renseigné"));
    }

    const details = document.createElement("div");
    details.className = "assignee-details";
    details.dataset.label = "Rattachement et rôle";
    const sources = document.createElement("div");
    sources.className = "badges";
    if (assignee.sources.includes("project-team")) {
      sources.appendChild(createBadge("Gestion du projet", "project-team"));
    }
    if (assignee.sources.includes("manual")) {
      sources.appendChild(createBadge("Ajout manuel", "manual"));
    }
    const roles = document.createElement("small");
    roles.className = "roles";
    const roleLabels = getPersonRoles(assignee);
    roles.textContent = roleLabels.length ? roleLabels.join(" · ") : "Rôle non renseigné";
    details.append(sources, roles);

    const action = document.createElement("div");
    action.className = "assignee-action";
    action.dataset.label = "Gestion";
    if (assignee.sources.includes("manual")) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = assignee.sources.includes("project-team")
        ? "Retirer l’ajout manuel"
        : "Retirer";
      remove.title = assignee.sources.includes("project-team")
        ? "La personne restera rattachée depuis la gestion du projet."
        : `Retirer ${getBusinessPersonName(assignee)} du projet ${project.number}`;
      remove.setAttribute(
        "aria-label",
        assignee.sources.includes("project-team")
          ? `Retirer uniquement l’ajout manuel de ${getBusinessPersonName(assignee)}`
          : `Retirer ${getBusinessPersonName(assignee)} du projet ${project.number}`
      );
      remove.disabled = state.busy;
      remove.addEventListener("click", () => removeManualAssignment(assignee, project));
      action.appendChild(remove);
    } else {
      action.appendChild(createBadge(
        "Géré dans la gestion du projet",
        "project-team management-status"
      ));
    }

    row.append(identity, service, details, action);
    return row;
  }

  function renderUnresolved(unresolved) {
    dom.unresolvedList.replaceChildren();
    dom.unresolvedPanel.hidden = !unresolved.length;
    if (!unresolved.length) return;
    dom.unresolvedSummary.textContent = `${unresolved.length} affectation(s) à vérifier dans la gestion du projet`;
    unresolved.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "unresolved-item";
      const name = document.createElement("strong");
      name.textContent = getBusinessPersonName(entry.personName);
      const details = document.createElement("small");
      if (entry.resolutionStatus === "ambiguous") {
        details.textContent = `Nom ambigu — candidats : ${entry.candidates.map(
          (candidate) => getBusinessPersonName(candidate.name)
        ).join(", ")}`;
      } else {
        details.textContent = "Aucun profil utilisateur correspondant.";
      }
      item.append(name, details);
      dom.unresolvedList.appendChild(item);
    });
  }

  function renderAssignments() {
    const project = selectedProject();
    dom.assigneesList.replaceChildren();
    if (!project) {
      dom.assigneesCount.textContent = "0";
      dom.assigneesSummary.textContent = "Sélectionne un projet pour afficher ses affectations.";
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Aucun projet sélectionné.";
      dom.assigneesList.appendChild(empty);
      renderUnresolved([]);
      populatePeople([]);
      return;
    }

    const result = core.getProjectAssignees(
      state.teamRows,
      state.projectTeamRows,
      project.number
    );
    dom.assigneesCount.textContent = String(result.assignees.length);
    dom.assigneesSummary.textContent = `${result.assignees.length} personne(s) reconnue(s) pour ${project.number}.`;
    if (!result.assignees.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Aucune personne reconnue n’est encore affectée à ce projet.";
      dom.assigneesList.appendChild(empty);
    } else {
      [...result.assignees].sort(comparePeopleByServiceRoleName).forEach((assignee) => {
        dom.assigneesList.appendChild(renderAssignmentRow(assignee, project));
      });
    }
    renderUnresolved(result.unresolved);
    populatePeople(result.assignees);
  }

  function populatePeople(assignees) {
    const assignedPersonKeys = new Set(assignees.map((assignee) => assignee.personKey));
    const query = normalizedSearch(dom.personSearch.value);
    const visiblePeople = core.groupTeamPeople(state.teamRows)
      .filter((person) => !assignedPersonKeys.has(person.personKey))
      .filter((person) => {
        const services = getPersonServices(person);
        const roles = getPersonRoles(person);
        return matchesSearch([
          person.personName,
          ...person.emails,
          ...services,
          ...roles,
        ], query);
      })
      .sort(comparePeopleByServiceRoleName);
    const available = visiblePeople.filter((person) => getPersonServices(person).length);
    const withoutService = visiblePeople.filter((person) => !getPersonServices(person).length);

    const previousSelection = new Set(
      [...dom.personSelect.selectedOptions].map((option) => option.value)
    );
    dom.personSelect.replaceChildren();
    visiblePeople.forEach((person) => {
      const option = document.createElement("option");
      option.value = person.personKey;
      const services = getPersonServices(person);
      const roles = getPersonRoles(person);
      const accountLabel = person.emails.length > 1 ? ` — ${person.emails.length} emails` : "";
      option.textContent = `${services.join(" / ") || "Service non renseigné"} · ${roles.join(" / ") || "Rôle non renseigné"} — ${getBusinessPersonName(person)}${accountLabel}`;
      option.title = [
        getBusinessPersonName(person),
        person.emails.join(" · "),
      ].filter(Boolean).join(" — ");
      option.disabled = !services.length;
      option.selected = !option.disabled && previousSelection.has(option.value);
      dom.personSelect.appendChild(option);
    });
    const selectedCount = dom.personSelect.selectedOptions.length;
    dom.selectionHelp.textContent = [
      `${available.length} personne(s) disponible(s)`,
      selectedCount ? `${selectedCount} sélectionnée(s)` : "",
      withoutService.length ? `${withoutService.length} visible(s) mais non sélectionnable(s) sans service` : "",
    ].filter(Boolean).join(" · ");
    dom.addButton.disabled = state.busy || !available.length || !selectedCount;
    dom.personSelect.disabled = state.busy || !visiblePeople.length;
  }

  async function addSelectedPeople() {
    if (state.busy) return;
    const project = selectedProject();
    const personKeys = [...dom.personSelect.selectedOptions]
      .map((option) => option.value)
      .filter(Boolean);
    if (!project || !personKeys.length) {
      setMessage("Sélectionne au moins une personne.", "error");
      return;
    }

    const actions = [];
    const updates = [];
    const peopleByKey = new Map(
      core.groupTeamPeople(state.teamRows).map((person) => [person.personKey, person])
    );
    const selectedPeople = personKeys.map((personKey) => peopleByKey.get(personKey)).filter(Boolean);
    selectedPeople.forEach((person) => {
      person.teamRows.forEach((teamRow) => {
        const existing = core.parseProjectAccess(teamRow?.[core.ACCESS_COLUMN]);
        if (existing.some((grant) => grant.projectNumber === project.number)) return;
        const next = [
          ...existing,
          ...(project.names.length ? project.names : [project.name || ""])
            .map((projectName) => ({ projectNumber: project.number, projectName })),
        ];
        const serialized = core.serializeProjectAccess(next);
        actions.push([
          "UpdateRecord",
          "Team",
          Number(teamRow.id),
          { [core.ACCESS_COLUMN]: serialized },
        ]);
        updates.push({ teamRow, serialized });
      });
    });
    if (!actions.length) {
      setMessage("Ces personnes sont déjà affectées.", "error");
      return;
    }

    setBusy(true, "Ajout en cours…");
    setMessage("Enregistrement…");
    try {
      await window.grist.docApi.applyUserActions(actions);
      updates.forEach(({ teamRow, serialized }) => {
        teamRow[core.ACCESS_COLUMN] = serialized;
      });
      signalAssignmentsChanged(
        selectedPeople.flatMap((person) => person.teamIds),
        "add"
      );
      setMessage(`${selectedPeople.length} personne(s) ajoutée(s).`, "success");
    } catch (error) {
      console.error("Ajout des affectations impossible :", error);
      setMessage("L’ajout a échoué. Réessaie ou contacte un administrateur.", "error");
    } finally {
      setBusy(false);
      renderAssignments();
    }
  }

  async function removeManualAssignment(assignee, project) {
    if (state.busy) return;
    const remainsViaProjectTeam = assignee.sources.includes("project-team");
    const confirmation = remainsViaProjectTeam
      ? `${getBusinessPersonName(assignee)} restera rattaché(e) depuis la gestion du projet. Retirer seulement l’ajout manuel ?`
      : `Retirer ${getBusinessPersonName(assignee)} du projet ${project.number} ?`;
    if (!window.confirm(confirmation)) return;

    const updates = assignee.teamRows.map((teamRow) => ({
      teamRow,
      serialized: core.serializeProjectAccess(
        core.parseProjectAccess(teamRow?.[core.ACCESS_COLUMN])
          .filter((grant) => grant.projectNumber !== project.number)
      ),
    }));
    const actions = updates.map(({ teamRow, serialized }) => [
      "UpdateRecord",
      "Team",
      Number(teamRow.id),
      { [core.ACCESS_COLUMN]: serialized },
    ]);
    if (!actions.length) return;
    setBusy(true, "Action en cours…");
    setMessage("Révocation…");
    try {
      await window.grist.docApi.applyUserActions(actions);
      updates.forEach(({ teamRow, serialized }) => {
        teamRow[core.ACCESS_COLUMN] = serialized;
      });
      signalAssignmentsChanged(assignee.teamIds, "remove");
      setMessage(
        remainsViaProjectTeam
          ? "Ajout manuel retiré. Le rattachement depuis la gestion du projet reste actif."
          : "Affectation retirée.",
        "success"
      );
    } catch (error) {
      console.error("Révocation impossible :", error);
      setMessage("Le retrait a échoué. Réessaie ou contacte un administrateur.", "error");
    } finally {
      setBusy(false);
      renderAssignments();
    }
  }

  function tableColumns(raw) {
    if (Array.isArray(raw)) {
      return new Set(raw.flatMap((row) => Object.keys(row || {})));
    }
    if (Array.isArray(raw?.records)) {
      return new Set(raw.records.flatMap((record) => Object.keys(record?.fields || record || {})));
    }
    return new Set(Object.keys(raw || {}));
  }

  async function loadData() {
    const [rawTeam, rawProjects, rawProjectTeam] = await Promise.all([
      window.grist.docApi.fetchTable("Team"),
      window.grist.docApi.fetchTable("Projets2"),
      window.grist.docApi.fetchTable(core.PROJECT_TEAM_TABLE),
    ]);
    if (!tableColumns(rawTeam).has(core.ACCESS_COLUMN)) {
      throw new Error(
        "La configuration des affectations manuelles est incomplète. Contacte un administrateur Grist."
      );
    }
    state.teamRows = core.tableToRows(rawTeam).filter((row) => Number(row?.id) > 0);
    state.projectTeamRows = core.tableToRows(rawProjectTeam)
      .filter((row) => Number(row?.id) > 0);
    state.projects = core.groupProjectsByNumber(rawProjects)
      .filter((project) => Number(project.id) > 0);
    state.currentAdmin = core.findCurrentTeamRow(state.teamRows);
    if (!state.currentAdmin) {
      throw new Error("Votre profil utilisateur n’a pas pu être identifié.");
    }
    if (!core.isAdminTeamRow(state.currentAdmin)) {
      throw new Error("Ce widget est réservé aux administrateurs.");
    }
    if (!state.projects.length) {
      throw new Error("Aucun projet exploitable n’a été trouvé.");
    }
    if (!state.projects.some((project) => project.number === state.selectedProjectNumber)) {
      state.selectedProjectNumber = state.projects[0].number;
    }
  }

  function bindEvents() {
    if (state.initialized) return;
    state.initialized = true;
    dom.projectSearch.addEventListener("input", populateProjects);
    dom.projectSelect.addEventListener("change", () => {
      state.selectedProjectNumber = core.normalizeProjectNumber(dom.projectSelect.value);
      setMessage("");
      renderSelectedProject();
    });
    dom.personSearch.addEventListener("input", renderAssignments);
    dom.personSelect.addEventListener("change", () => {
      const result = core.getProjectAssignees(
        state.teamRows,
        state.projectTeamRows,
        state.selectedProjectNumber
      );
      populatePeople(result.assignees);
    });
    dom.addButton.addEventListener("click", addSelectedPeople);
    window.addEventListener("focus", refreshFromDocument);
    // Ce widget lit les tables sans filtre, il ne charge donc pas le runtime
    // partagé. Il écoute en revanche le même signal que lui : quand un autre
    // widget modifie l'annuaire, les projets ou les affectations, l'écran se met
    // à jour sans attendre un retour de focus ni un rechargement.
    window.addEventListener("storage", (event) => {
      if (event.key !== core.DATA_CHANGED_STORAGE_KEY) return;
      const changedTables = core.parseDataChangeSignal(event.newValue);
      const watched = ["Team", "Projets2", core.PROJECT_TEAM_TABLE];
      if (!changedTables.some((tableName) => watched.includes(tableName))) return;
      refreshFromDocument();
    });
  }

  // Relire est bon marché, re-rendre ne l'est pas : tant que les lignes sont
  // identiques, l'écran ne bouge pas et la position de lecture est conservée.
  // Seule exception : l'espace de travail masqué après une erreur, qu'il faut
  // rétablir même si les données n'ont pas bougé.
  function refreshFromDocument() {
    if (state.busy) return;
    loadData().then(() => {
      const signature = computeDataSignature();
      if (signature === state.renderedSignature && !dom.workspace.hidden) return;
      state.renderedSignature = signature;

      const restoreScroll = captureWorkspaceScroll();
      populateProjects();
      dom.workspace.hidden = false;
      dom.fatalPanel.hidden = true;
      setStatus("Administrateur", "ready");
      restoreScroll();
    }).catch((error) => {
      console.error("Actualisation impossible :", error);
      fail("Les données n’ont pas pu être actualisées. Réessaie ou contacte un administrateur.");
    });
  }

  async function bootstrap() {
    if (!core || !window.grist?.docApi) {
      fail("L’API Grist ou le module d’accès est indisponible.");
      return;
    }
    window.grist.ready?.({ requiredAccess: "full" });
    try {
      await loadData();
      state.renderedSignature = computeDataSignature();
      bindEvents();
      populateProjects();
      dom.workspace.hidden = false;
      dom.fatalPanel.hidden = true;
      setStatus("Administrateur", "ready");
    } catch (error) {
      console.error("Initialisation du widget d’affectation impossible :", error);
      fail(error instanceof Error && [
        "La configuration des affectations manuelles est incomplète. Contacte un administrateur Grist.",
        "Votre profil utilisateur n’a pas pu être identifié.",
        "Ce widget est réservé aux administrateurs.",
        "Aucun projet exploitable n’a été trouvé.",
      ].includes(error.message)
        ? error.message
        : "Les données n’ont pas pu être chargées. Réessaie ou contacte un administrateur.");
    }
  }

  bootstrap();
})(window);
