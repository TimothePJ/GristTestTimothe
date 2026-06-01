function toCleanText(value) {
  return String(value ?? "").trim();
}

function normalizeLookupText(value) {
  return toCleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function normalizeCompactLookupText(value) {
  return normalizeLookupText(value).replace(/\s+/g, "");
}

export function normalizePlanningIndice(value) {
  return toCleanText(value).toUpperCase();
}

export function normalizePlanningDocumentType(value) {
  const normalized = normalizeLookupText(value);
  const compact = normalizeCompactLookupText(value);

  if (
    compact === "NDC" ||
    normalized.includes("NOTE DE CALCUL") ||
    normalized.includes("NOTES DE CALCUL") ||
    normalized.includes("NOTE CALCUL") ||
    normalized.includes("NOTES CALCUL")
  ) {
    return "NDC";
  }

  if (normalized.includes("COFFRAGE")) return "COFFRAGE";
  if (normalized.includes("ARMATURE")) return "ARMATURES";
  if (normalized.includes("DEMOLITION")) return "DEMOLITION";
  if (normalized.includes("COUPE")) return "COUPES";

  return normalized || "NON SPECIFIE";
}

export function getDefaultTargetIndiceForDocumentType(typeDoc) {
  return normalizePlanningDocumentType(typeDoc) === "COFFRAGE" ? "A" : "0";
}

function getIndiceRank(indice) {
  const normalizedIndice = normalizePlanningIndice(indice);
  if (!normalizedIndice) return 0;
  if (normalizedIndice === "0") return 1;
  if (/^[A-Z]$/.test(normalizedIndice)) {
    return normalizedIndice.charCodeAt(0) - 63;
  }

  return null;
}

export function computeIndexedRealisation(indice, targetIndice) {
  const normalizedIndice = normalizePlanningIndice(indice);
  const normalizedTargetIndice = normalizePlanningIndice(targetIndice);

  if (!normalizedIndice) return 0;
  if (!normalizedTargetIndice) return normalizedIndice ? 100 : 0;
  if (normalizedIndice === normalizedTargetIndice) return 100;

  const indiceRank = getIndiceRank(normalizedIndice);
  const targetRank = getIndiceRank(normalizedTargetIndice);
  if (indiceRank == null || targetRank == null || targetRank <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((indiceRank / targetRank) * 100)));
}

export function computePlanningRealisationValue(typeDoc, indice, targetIndice = "") {
  const effectiveTargetIndice =
    normalizePlanningIndice(targetIndice) || getDefaultTargetIndiceForDocumentType(typeDoc);

  return computeIndexedRealisation(indice, effectiveTargetIndice);
}

export function buildTargetIndiceByTypeFromAvancement(rawValue) {
  const targetIndiceByType = new Map();
  if (rawValue == null || rawValue === "") {
    return targetIndiceByType;
  }

  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    if (!Array.isArray(parsed)) {
      return targetIndiceByType;
    }

    parsed.forEach((item) => {
      const typeKey = normalizePlanningDocumentType(item?.typeDocument);
      const indice = normalizePlanningIndice(item?.indice);
      if (!typeKey || !indice || item?.budgetKey || targetIndiceByType.has(typeKey)) {
        return;
      }

      targetIndiceByType.set(typeKey, indice);
    });
  } catch (_error) {
    return targetIndiceByType;
  }

  return targetIndiceByType;
}

export function getTargetIndiceForDocumentType(typeDoc, targetIndiceByType = null) {
  const typeKey = normalizePlanningDocumentType(typeDoc);
  if (targetIndiceByType instanceof Map && targetIndiceByType.has(typeKey)) {
    return targetIndiceByType.get(typeKey);
  }

  return getDefaultTargetIndiceForDocumentType(typeDoc);
}
