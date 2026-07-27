(function initAccessAdministration(window) {
  "use strict";

  const core = window.GristServiceContextCore;
  const state = {
    teamRows: [],
    projects: [],
    currentAdmin: null,
    selectedTeamId: null,
    busy: false,
  };
  const dom = {
    adminStatus: document.getElementById("admin-status"),
    editor: document.getElementById("editor"),
    grantsPanel: document.getElementById("grants-panel"),
    fatalPanel: document.getElementById("fatal-panel"),
    fatalMessage: document.getElementById("fatal-message"),
    userSelect: document.getElementById("user-select"),
    projectSelect: document.getElementById("project-select"),
    serviceSelect: document.getElementById("service-select"),
    homeService: document.getElementById("user-home-service"),
    grantButton: document.getElementById("grant-button"),
    formMessage: document.getElementById("form-message"),
    grantsSummary: document.getElementById("grants-summary"),
    grantsList: document.getElementById("grants-list"),
  };

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
    dom.editor.hidden = true;
    dom.grantsPanel.hidden = true;
    dom.fatalPanel.hidden = false;
    dom.fatalMessage.textContent = message;
  }

  function getTeamLabel(row) {
    return core.toText(row?.PrenomNom) ||
      [core.toText(row?.Prenom), core.toText(row?.Nom)].filter(Boolean).join(" ") ||
      core.toText(row?.Email) ||
      `Ligne Team ${row?.id}`;
  }

  function getSelectedTeamRow() {
    const id = Number(dom.userSelect.value || state.selectedTeamId);
    return state.teamRows.find((row) => Number(row?.id) === id) || null;
  }

  function getProjectGroups(rawProjects) {
    const groups = new Map();
    core.tableToRows(rawProjects).forEach((row) => {
      const number = core.normalizeProjectNumber(
        row?.Numero_de_projet ?? row?.NumeroProjet ?? row?.Numero
      );
      const name = core.toText(row?.Nom_de_projet ?? row?.NomProjet ?? row?.Projet);
      if (!number) return;
      const current = groups.get(number) || { number, names: new Set(), ids: [] };
      if (name) current.names.add(name);
      if (Number(row?.id) > 0) current.ids.push(Number(row.id));
      groups.set(number, current);
    });
    return [...groups.values()]
      .map((group) => ({
        number: group.number,
        name: [...group.names].sort((a, b) => a.localeCompare(b, "fr", {
          numeric: true,
          sensitivity: "base",
        })).join(" / "),
        ids: group.ids,
      }))
      .sort((left, right) => left.number.localeCompare(right.number, "fr", {
        numeric: true,
        sensitivity: "base",
      }));
  }

  function populateUsers() {
    dom.userSelect.replaceChildren();
    [...state.teamRows]
      .sort((left, right) => getTeamLabel(left).localeCompare(getTeamLabel(right), "fr", {
        sensitivity: "base",
      }))
      .forEach((row) => {
        const option = document.createElement("option");
        option.value = String(row.id);
        option.textContent = `${getTeamLabel(row)} — ${core.normalizeService(row.Service) || "sans service"}`;
        dom.userSelect.appendChild(option);
      });
    const firstNonAdmin = state.teamRows.find((row) => Number(row.id) !== Number(state.currentAdmin?.id));
    state.selectedTeamId = Number(firstNonAdmin?.id || state.teamRows[0]?.id || 0);
    dom.userSelect.value = String(state.selectedTeamId || "");
  }

  function populateProjects() {
    dom.projectSelect.replaceChildren();
    state.projects.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.number;
      option.textContent = `${project.number} — ${project.name || "Projet sans nom"}`;
      option.dataset.projectName = project.name;
      dom.projectSelect.appendChild(option);
    });
  }

  function populateServices(teamRow) {
    const homeService = core.normalizeService(teamRow?.Service);
    const previous = core.normalizeService(dom.serviceSelect.value);
    dom.serviceSelect.replaceChildren();
    core.SERVICES
      .filter((service) => service !== homeService)
      .forEach((service) => {
        const option = document.createElement("option");
        option.value = service;
        option.textContent = service;
        dom.serviceSelect.appendChild(option);
      });
    if ([...dom.serviceSelect.options].some((option) => option.value === previous)) {
      dom.serviceSelect.value = previous;
    }
  }

  function getAllGrants(teamRow) {
    return core.SERVICES.flatMap((service) => (
      core.parseGrants(teamRow?.[core.GRANT_COLUMNS[service]])
        .map((grant) => ({ ...grant, service }))
    )).sort((left, right) => (
      left.service.localeCompare(right.service, "fr") ||
      left.projectNumber.localeCompare(right.projectNumber, "fr", { numeric: true })
    ));
  }

  function renderGrants() {
    const teamRow = getSelectedTeamRow();
    if (!teamRow) return;
    state.selectedTeamId = Number(teamRow.id);
    const homeService = core.normalizeService(teamRow.Service);
    dom.homeService.textContent = homeService || "Non renseigné";
    populateServices(teamRow);

    const grants = getAllGrants(teamRow);
    dom.grantsSummary.textContent = `${getTeamLabel(teamRow)} — ${grants.length} autorisation(s)`;
    dom.grantsList.replaceChildren();
    if (!grants.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Aucun accès interservice attribué.";
      dom.grantsList.appendChild(empty);
      return;
    }

    grants.forEach((grant) => {
      const row = document.createElement("article");
      row.className = "grant-row";
      const service = document.createElement("strong");
      service.textContent = grant.service;
      const project = document.createElement("p");
      project.textContent = `${grant.projectNumber} — ${grant.projectName || "Projet sans nom"}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "Retirer";
      remove.disabled = state.busy;
      remove.addEventListener("click", () => removeGrant(teamRow, grant));
      row.append(service, project, remove);
      dom.grantsList.appendChild(row);
    });
  }

  async function updateGrantColumn(teamRow, service, nextGrants) {
    const column = core.GRANT_COLUMNS[service];
    if (!column) throw new Error("Colonne d’autorisation inconnue.");
    const serialized = core.serializeGrants(nextGrants);
    await window.grist.docApi.applyUserActions([
      ["UpdateRecord", "Team", Number(teamRow.id), { [column]: serialized }],
    ]);
    teamRow[column] = serialized;
    try {
      localStorage.setItem("grist.service-grants-changed", JSON.stringify({
        at: Date.now(),
        teamId: Number(teamRow.id),
        service,
      }));
    } catch (_error) {
      // Signal best effort.
    }
  }

  async function addGrant() {
    const teamRow = getSelectedTeamRow();
    const service = core.normalizeService(dom.serviceSelect.value);
    const projectNumber = core.normalizeProjectNumber(dom.projectSelect.value);
    const project = state.projects.find((candidate) => candidate.number === projectNumber);
    if (!teamRow || !service || !projectNumber) {
      setMessage("Sélection incomplète.", "error");
      return;
    }
    if (service === core.normalizeService(teamRow.Service)) {
      setMessage("Le service principal ne nécessite pas d’autorisation.", "error");
      return;
    }

    const column = core.GRANT_COLUMNS[service];
    const existing = core.parseGrants(teamRow[column]);
    if (existing.some((grant) => grant.projectNumber === projectNumber)) {
      setMessage("Cette autorisation existe déjà.", "error");
      return;
    }

    state.busy = true;
    dom.grantButton.disabled = true;
    setMessage("Enregistrement…");
    try {
      await updateGrantColumn(teamRow, service, [
        ...existing,
        { projectNumber, projectName: project?.name || "" },
      ]);
      setMessage("Accès ajouté en lecture seule.", "success");
      renderGrants();
    } catch (error) {
      console.error("Ajout de l’autorisation impossible :", error);
      setMessage(error?.message || "Enregistrement impossible.", "error");
    } finally {
      state.busy = false;
      dom.grantButton.disabled = false;
    }
  }

  async function removeGrant(teamRow, grantToRemove) {
    if (!window.confirm(
      `Retirer l’accès ${grantToRemove.service} au projet ${grantToRemove.projectNumber} ?`
    )) return;
    state.busy = true;
    dom.grantButton.disabled = true;
    renderGrants();
    try {
      const column = core.GRANT_COLUMNS[grantToRemove.service];
      const nextGrants = core.parseGrants(teamRow[column]).filter(
        (grant) => grant.projectNumber !== grantToRemove.projectNumber
      );
      await updateGrantColumn(teamRow, grantToRemove.service, nextGrants);
      setMessage("Accès retiré.", "success");
    } catch (error) {
      console.error("Suppression de l’autorisation impossible :", error);
      setMessage(error?.message || "Suppression impossible.", "error");
    } finally {
      state.busy = false;
      dom.grantButton.disabled = false;
      renderGrants();
    }
  }

  async function bootstrap() {
    if (!core || !window.grist?.docApi) {
      fail("L’API Grist ou le module d’accès est indisponible.");
      return;
    }
    window.grist.ready?.({ requiredAccess: "full" });
    try {
      const [rawTeam, rawProjects] = await Promise.all([
        window.grist.docApi.fetchTable("Team"),
        window.grist.docApi.fetchTable("Projets2"),
      ]);
      const teamColumns = new Set(
        Array.isArray(rawTeam)
          ? Object.keys(rawTeam[0] || {})
          : Object.keys(rawTeam || {})
      );
      const missingGrantColumns = core.SERVICES
        .map((service) => core.GRANT_COLUMNS[service])
        .filter((column) => !teamColumns.has(column));
      if (missingGrantColumns.length) {
        fail(`Colonnes Team manquantes : ${missingGrantColumns.join(", ")}.`);
        return;
      }
      state.teamRows = core.tableToRows(rawTeam).filter((row) => Number(row?.id) > 0);
      state.projects = getProjectGroups(rawProjects);
      state.currentAdmin = core.findCurrentTeamRow(state.teamRows);
      if (!state.currentAdmin) {
        fail("La ligne Team de l’utilisateur courant est introuvable. Vérifie la colonne Moi.");
        return;
      }
      if (!core.isAdminTeamRow(state.currentAdmin)) {
        fail("Ce widget est réservé aux administrateurs.");
        return;
      }
      if (!state.projects.length) {
        fail("Aucun projet exploitable n’a été trouvé dans Projets2.");
        return;
      }

      populateUsers();
      populateProjects();
      renderGrants();
      dom.editor.hidden = false;
      dom.grantsPanel.hidden = false;
      setStatus("Administrateur", "ready");
      dom.userSelect.addEventListener("change", () => {
        setMessage("");
        renderGrants();
      });
      dom.grantButton.addEventListener("click", addGrant);
    } catch (error) {
      console.error("Initialisation du widget d’accès impossible :", error);
      fail(error?.message || "Chargement impossible.");
    }
  }

  bootstrap();
})(window);
