export function toText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if (typeof value.details === "string") return value.details.trim();
    if (typeof value.display === "string") return value.display.trim();
    if (typeof value.label === "string") return value.label.trim();
    if (typeof value.name === "string") return value.name.trim();
  }
  return String(value).trim();
}

export function normalizeKey(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizePersonName(value) {
  return normalizeKey(value);
}

export function normalizeColumnName(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function parseFrenchNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = toText(value).replace(/\s+/g, "").replace(",", ".");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function formatDays(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0 j";
  const rounded = Math.round(number * 10) / 10;
  return `${String(rounded).replace(".", ",")} j`;
}

export function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0 %";
  return `${Math.round(number)} %`;
}

export function compareText(left, right) {
  return toText(left).localeCompare(toText(right), "fr", {
    numeric: true,
    sensitivity: "base",
  });
}

export function findColumn(tableData, candidates = []) {
  const keys = Object.keys(tableData || {});
  const normalizedCandidates = candidates.map(normalizeColumnName).filter(Boolean);

  for (const key of keys) {
    const normalizedKey = normalizeColumnName(key);
    if (normalizedCandidates.includes(normalizedKey)) return key;
  }

  for (const key of keys) {
    const normalizedKey = normalizeColumnName(key);
    if (normalizedCandidates.some((candidate) =>
      normalizedKey.includes(candidate) || candidate.includes(normalizedKey)
    )) {
      return key;
    }
  }

  return null;
}

export function tableToRows(tableData) {
  const data = tableData || {};
  const keys = Object.keys(data).filter((key) => Array.isArray(data[key]));
  const rowCount = keys.reduce((max, key) => Math.max(max, data[key].length), 0);

  return Array.from({ length: rowCount }, (_, index) => {
    const row = {};
    keys.forEach((key) => {
      row[key] = data[key][index];
    });
    return row;
  });
}
