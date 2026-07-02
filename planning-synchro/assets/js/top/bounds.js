import { parseDateTime, formatIsoDate } from "../utils/dates.js";
export function computeTimeSegmentBounds(rows, columns) {
  let minMs = Infinity, maxMs = -Infinity;
  for (const row of rows || []) {
    const s = parseDateTime(row?.[columns.startDate]);
    const e = parseDateTime(row?.[columns.endDate]);
    if (s) minMs = Math.min(minMs, s.getTime());
    if (e) maxMs = Math.max(maxMs, e.getTime());
    if (s) maxMs = Math.max(maxMs, s.getTime());
    if (e) minMs = Math.min(minMs, e.getTime());
  }
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || maxMs < minMs) return null;
  return { startMs: minMs, endMs: maxMs, startDate: formatIsoDate(new Date(minMs)), endDate: formatIsoDate(new Date(maxMs)) };
}
