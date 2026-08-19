(function initBordereauCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BordereauCore = api;
})(typeof window !== "undefined" ? window : globalThis, function createBordereauCore() {
  "use strict";

  function textValue(value) {
    if (value && typeof value === "object") {
      if (typeof value.details === "string") return value.details.trim();
      if (typeof value.display === "string") return value.display.trim();
      if (typeof value.label === "string") return value.label.trim();
      if (typeof value.name === "string") return value.name.trim();
    }
    return String(value ?? "").trim();
  }

  function normalizeCompareValue(value) {
    return textValue(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeIdentityValue(value) {
    return textValue(value)
      .toLocaleLowerCase("fr")
      .replace(/\s+/g, " ")
      .trim();
  }

  function compareText(left, right) {
    return textValue(left).localeCompare(textValue(right), "fr", {
      numeric: true,
      sensitivity: "base",
    });
  }

  function projectRows(projects) {
    if (Array.isArray(projects)) return projects;
    const ids = Array.isArray(projects?.id) ? projects.id : [];
    return ids.map((id, index) => ({
      id,
      Numero_de_projet: projects?.Numero_de_projet?.[index],
      Nom_de_projet: projects?.Nom_de_projet?.[index],
    }));
  }

  function buildProjectCatalog(projects) {
    return projectRows(projects)
      .map((project) => {
        const ids = [...new Set(
          [project?.id, ...(Array.isArray(project?.ids) ? project.ids : [])]
            .map(Number)
            .filter((id) => Number.isInteger(id) && id > 0)
        )];
        const names = [...new Set(
          [
            project?.name ??
            project?.Nom_de_projet ??
            project?.NomProjet ??
            project?.Nom_projet,
            ...(Array.isArray(project?.names) ? project.names : []),
          ]
            .map(textValue)
            .filter(Boolean)
        )];
        return {
          id: ids[0] || null,
          ids,
          number: textValue(
            project?.number ??
            project?.Numero_de_projet ??
            project?.NumeroProjet ??
            project?.Numero
          ),
          name: names[0] || "",
          names,
        };
      })
      .filter((project) => Number.isInteger(project.id) && project.id > 0 && project.name)
      .sort((left, right) => compareText(left.name, right.name));
  }

  function isTableColumnDefinitelyMissing(tableData, columnName) {
    const ids = Array.isArray(tableData?.id) ? tableData.id : [];
    const column = textValue(columnName);
    return Boolean(
      ids.length &&
      column &&
      !Object.prototype.hasOwnProperty.call(tableData, column)
    );
  }

  function getDocumentKey(planNumber, typeDocument) {
    return JSON.stringify([
      normalizeIdentityValue(planNumber),
      normalizeIdentityValue(typeDocument),
    ]);
  }

  function getDocumentIndiceKey(planNumber, typeDocument, indice) {
    return JSON.stringify([
      normalizeIdentityValue(planNumber),
      normalizeIdentityValue(typeDocument),
      normalizeIdentityValue(indice),
    ]);
  }

  function isEnvoyeValue(value) {
    return value === true || value === 1 || normalizeCompareValue(value) === "true";
  }

  function sameProject(value, projectName, resolveProjectName) {
    const resolve = typeof resolveProjectName === "function" ? resolveProjectName : textValue;
    return normalizeCompareValue(resolve(value)) === normalizeCompareValue(projectName);
  }

  function collectTypeCandidates(plans, projectName, planNumber, resolveProjectName) {
    const planKey = normalizeIdentityValue(planNumber);
    const candidates = new Map();
    if (!normalizeCompareValue(projectName) || !planKey) return [];

    (plans || []).forEach((plan) => {
      if (!sameProject(plan?.Nom_projet, projectName, resolveProjectName)) return;
      if (normalizeIdentityValue(plan?.NumeroDocument) !== planKey) return;
      const typeDocument = textValue(plan?.Type_document);
      const typeKey = normalizeIdentityValue(typeDocument);
      if (!typeKey || candidates.has(typeKey)) return;
      candidates.set(typeKey, typeDocument);
    });

    return Array.from(candidates.values()).sort(compareText);
  }

  function resolveMissingType(plans, projectName, planNumber, resolveProjectName) {
    const candidates = collectTypeCandidates(
      plans,
      projectName,
      planNumber,
      resolveProjectName
    );
    if (candidates.length === 1) {
      return { status: "unique", typeDocument: candidates[0], candidates };
    }
    if (candidates.length > 1) {
      return { status: "ambiguous", typeDocument: "", candidates };
    }
    return { status: "missing", typeDocument: "", candidates };
  }

  function buildUniqueTypeAssignments(envois, plans, resolveProjectName) {
    const assignments = [];
    const resolve = typeof resolveProjectName === "function" ? resolveProjectName : textValue;

    (envois || []).forEach((record) => {
      if (textValue(record?.Type_Document)) return;
      const recordId = Number(record?.id);
      const projectName = resolve(record?.Projet);
      const planNumber = textValue(record?.N_Plan);
      if (!Number.isInteger(recordId) || recordId <= 0 || !projectName || !planNumber) return;

      const resolution = resolveMissingType(
        plans,
        projectName,
        planNumber,
        resolveProjectName
      );
      if (resolution.status !== "unique" || !resolution.typeDocument) return;
      assignments.push({ recordId, typeDocument: resolution.typeDocument });
    });

    return assignments;
  }

  function buildSentDocumentIndiceKeys(
    envois,
    projectName,
    plans,
    resolveProjectName
  ) {
    const sentKeys = new Set();
    if (!normalizeCompareValue(projectName)) return sentKeys;

    (envois || []).forEach((record) => {
      if (!isEnvoyeValue(record?.Envoye)) return;
      if (!sameProject(record?.Projet, projectName, resolveProjectName)) return;

      const planNumber = textValue(record?.N_Plan);
      const indice = textValue(record?.Indice);
      if (!planNumber || !indice) return;

      const storedType = textValue(record?.Type_Document);
      const typeCandidates = storedType
        ? [storedType]
        : collectTypeCandidates(plans, projectName, planNumber, resolveProjectName);

      typeCandidates.forEach((typeDocument) => {
        sentKeys.add(getDocumentIndiceKey(planNumber, typeDocument, indice));
      });
    });

    return sentKeys;
  }

  return Object.freeze({
    buildProjectCatalog,
    buildSentDocumentIndiceKeys,
    buildUniqueTypeAssignments,
    collectTypeCandidates,
    compareText,
    getDocumentIndiceKey,
    getDocumentKey,
    isTableColumnDefinitelyMissing,
    isEnvoyeValue,
    normalizeCompareValue,
    normalizeIdentityValue,
    resolveMissingType,
    textValue,
  });
});
