(function initPlanningClosureCore(root, factory) {
  const api = factory();

  if (typeof module === "object" && module?.exports) {
    module.exports = api;
  }
  if (root && typeof root === "object") {
    root.PlanningClosureCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlanningClosureCore() {
  "use strict";

  function toText(value) {
    if (value == null) return "";
    if (typeof value === "object" && !(value instanceof Date)) {
      return toText(
        value.details ?? value.display ?? value.label ?? value.name ?? value.id ?? ""
      );
    }
    return String(value).trim().replace(/\s+/g, " ");
  }

  function createLocalCalendarDate(year, month, day) {
    const normalizedYear = Number(year);
    const normalizedMonth = Number(month);
    const normalizedDay = Number(day);
    if (
      !Number.isInteger(normalizedYear) ||
      !Number.isInteger(normalizedMonth) ||
      !Number.isInteger(normalizedDay)
    ) {
      return null;
    }

    const date = new Date(normalizedYear, normalizedMonth - 1, normalizedDay);
    date.setHours(0, 0, 0, 0);
    if (
      date.getFullYear() !== normalizedYear ||
      date.getMonth() !== normalizedMonth - 1 ||
      date.getDate() !== normalizedDay
    ) {
      return null;
    }
    return date;
  }

  function parsePlanningCalendarDate(value) {
    if (value == null || value === "") return null;

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return createLocalCalendarDate(
        value.getFullYear(),
        value.getMonth() + 1,
        value.getDate()
      );
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      const milliseconds = Math.abs(value) < 1e11 ? value * 1000 : value;
      const parsed = new Date(milliseconds);
      if (Number.isNaN(parsed.getTime())) return null;
      return createLocalCalendarDate(
        parsed.getFullYear(),
        parsed.getMonth() + 1,
        parsed.getDate()
      );
    }

    const text = toText(value);
    if (!text) return null;

    // Une valeur ISO est une date calendaire : on conserve sa partie YYYY-MM-DD
    // au lieu de la convertir via UTC, ce qui évite tout décalage d'un jour.
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    if (isoMatch) {
      return createLocalCalendarDate(isoMatch[1], isoMatch[2], isoMatch[3]);
    }

    const frenchMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\s)/);
    if (frenchMatch) {
      return createLocalCalendarDate(frenchMatch[3], frenchMatch[2], frenchMatch[1]);
    }

    return null;
  }

  function formatPlanningCalendarDateIso(value) {
    const date = parsePlanningCalendarDate(value);
    if (!date) return "";
    return [
      String(date.getFullYear()).padStart(4, "0"),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }

  function formatPlanningCalendarDateFr(value) {
    const date = parsePlanningCalendarDate(value);
    if (!date) return "";
    return [
      String(date.getDate()).padStart(2, "0"),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getFullYear()).padStart(4, "0"),
    ].join("/");
  }

  function hasValidPlanningClosureDate(value) {
    return Boolean(parsePlanningCalendarDate(value));
  }

  function getPlanningIndiceRank(value) {
    const indice = toText(value).toUpperCase();
    if (!indice) return null;
    if (indice === "0") return 1;
    return /^[A-Z]$/.test(indice) ? indice.charCodeAt(0) - 63 : null;
  }

  function isPlanningDocumentAdvanced({ dateCloture, indice, targetIndice } = {}) {
    if (hasValidPlanningClosureDate(dateCloture)) return true;

    const normalizedIndice = toText(indice).toUpperCase();
    const normalizedTargetIndice = toText(targetIndice).toUpperCase();
    if (!normalizedIndice) return false;
    if (!normalizedTargetIndice) return true;

    const indiceRank = getPlanningIndiceRank(normalizedIndice);
    const targetRank = getPlanningIndiceRank(normalizedTargetIndice);
    return indiceRank != null && targetRank != null && indiceRank >= targetRank;
  }

  function normalizePlanningIdentityPart(value) {
    return toText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();
  }

  function normalizePlanningIdentityType(value) {
    const normalized = normalizePlanningIdentityPart(value);
    const compact = normalized.replace(/\s+/g, "");
    if (
      compact === "NDC" ||
      normalized.includes("NOTE DE CALCUL") ||
      normalized.includes("NOTES DE CALCUL")
    ) {
      return "NDC";
    }
    if (normalized.includes("COFFRAGE")) return "COFFRAGE";
    if (normalized.includes("ARMATURE")) return "ARMATURES";
    if (normalized.includes("DEMOLITION")) return "DEMOLITION";
    if (normalized.includes("COUPE")) return "COUPES";
    return normalized;
  }

  function buildPlanningDocumentIdentity(source = {}) {
    return {
      project: normalizePlanningIdentityPart(
        source.project ?? source.projectName ?? source.nomProjet
      ),
      service: normalizePlanningIdentityPart(source.service),
      documentNumber: normalizePlanningIdentityPart(
        source.documentNumber ?? source.numeroDocument ?? source.id2
      ),
      typeDocument: normalizePlanningIdentityType(
        source.typeDocument ?? source.typeDoc
      ),
      zone: normalizePlanningIdentityPart(source.zone),
      designation: normalizePlanningIdentityPart(
        source.designation ?? source.task ?? source.tache
      ),
    };
  }

  function buildPlanningDocumentIdentityKey(source = {}, options = {}) {
    const identity = buildPlanningDocumentIdentity(source);
    const includeOptional = options.includeOptional !== false;
    const parts = [identity.project, identity.documentNumber, identity.typeDocument];
    if (includeOptional) {
      parts.push(identity.service, identity.zone, identity.designation);
    }
    return parts.join("||");
  }

  function hasSameMandatoryPlanningIdentity(left, right) {
    return Boolean(
      left.project &&
      left.documentNumber &&
      left.typeDocument &&
      left.project === right.project &&
      left.documentNumber === right.documentNumber &&
      left.typeDocument === right.typeDocument
    );
  }

  function areOptionalPlanningIdentityPartsCompatible(left, right) {
    return ["service", "zone", "designation"].every(
      (key) => !left[key] || !right[key] || left[key] === right[key]
    );
  }

  function getPlanningIdentityMatchScore(left, right) {
    if (!hasSameMandatoryPlanningIdentity(left, right)) return -1;
    if (!areOptionalPlanningIdentityPartsCompatible(left, right)) return -1;

    let score = 0;
    if (left.service && right.service && left.service === right.service) score += 4;
    if (left.zone && right.zone && left.zone === right.zone) score += 2;
    if (left.designation && right.designation && left.designation === right.designation) score += 1;
    return score;
  }

  function getOptionalPlanningIdentitySignature(identity) {
    return [identity.service, identity.zone, identity.designation].join("||");
  }

  function findBestPlanningDocumentMatches(targetSource, candidates = [], identitySelector) {
    const target = buildPlanningDocumentIdentity(targetSource);
    if (!target.project || !target.documentNumber || !target.typeDocument) return [];

    const normalizedCandidates = (candidates || []).map((candidate) => ({
      candidate,
      identity: buildPlanningDocumentIdentity(
        typeof identitySelector === "function" ? identitySelector(candidate) : candidate
      ),
    }));
    const strictKey = buildPlanningDocumentIdentityKey(target);
    const strictMatches = normalizedCandidates.filter(
      ({ identity }) => buildPlanningDocumentIdentityKey(identity) === strictKey
    );
    if (strictMatches.length) {
      return strictMatches.map(({ candidate }) => candidate);
    }

    const compatible = normalizedCandidates
      .map(({ candidate, identity }) => ({
        candidate,
        identity,
        score: getPlanningIdentityMatchScore(target, identity),
      }))
      .filter(({ score }) => score >= 0);
    if (!compatible.length) return [];

    const bestScore = Math.max(...compatible.map(({ score }) => score));
    const bestMatches = compatible.filter(({ score }) => score === bestScore);
    const distinctOptionalIdentities = new Set(
      bestMatches.map(({ identity }) => getOptionalPlanningIdentitySignature(identity))
    );

    // Un fallback ambigu (par exemple même numéro dans deux zones alors que la
    // zone source est vide) ne doit jamais propager la clôture au mauvais plan.
    if (distinctOptionalIdentities.size > 1) return [];
    return bestMatches.map(({ candidate }) => candidate);
  }

  return Object.freeze({
    parsePlanningCalendarDate,
    formatPlanningCalendarDateIso,
    formatPlanningCalendarDateFr,
    hasValidPlanningClosureDate,
    isPlanningDocumentAdvanced,
    normalizePlanningIdentityPart,
    normalizePlanningIdentityType,
    buildPlanningDocumentIdentity,
    buildPlanningDocumentIdentityKey,
    findBestPlanningDocumentMatches,
  });
});
