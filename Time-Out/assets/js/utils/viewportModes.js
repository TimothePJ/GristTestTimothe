// viewportModes.js — pure calendar-aligned viewport ranges for Time-Out.
// mode ∈ "week" (Mon→Sun) | "month" (1st→last) | "quarter" (calendar quarter).
// No DOM, no Grist. Node-testable.

const DAY_MS = 86400000;

function pad2(n) {
  return String(n).padStart(2, "0");
}
function iso(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function toDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const m = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function normalizeMode(mode) {
  return mode === "week" || mode === "quarter" ? mode : "month";
}

// Monday of the week containing `date`.
export function startOfWeek(date) {
  const d = toDate(date);
  if (!d) return null;
  const offset = (d.getDay() + 6) % 7; // Mon→0 ... Sun→6
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
}

export function computeViewport(mode, anchorDate) {
  const anchor = toDate(anchorDate);
  if (!anchor) return null;
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const resolved = normalizeMode(mode);
  let first;
  let end;
  if (resolved === "week") {
    first = startOfWeek(anchor);
    end = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6);
  } else if (resolved === "quarter") {
    const qFirstMonth = Math.floor(m / 3) * 3;
    first = new Date(y, qFirstMonth, 1);
    end = new Date(y, qFirstMonth + 3, 0);
  } else {
    first = new Date(y, m, 1);
    end = new Date(y, m + 1, 0);
  }
  const firstVisibleDate = iso(first);
  return {
    mode: resolved,
    firstVisibleDate,
    rangeStartDate: firstVisibleDate,
    rangeEndDate: iso(end),
    visibleDays: Math.round((end - first) / DAY_MS) + 1,
  };
}

// New anchor Date one period earlier/later (direction < 0 = previous).
export function shiftAnchor(mode, firstVisibleDate, direction) {
  const d = toDate(firstVisibleDate);
  if (!d) return null;
  const dir = direction < 0 ? -1 : 1;
  const resolved = normalizeMode(mode);
  if (resolved === "week") {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * dir);
  }
  if (resolved === "quarter") {
    const qFirstMonth = Math.floor(d.getMonth() / 3) * 3;
    return new Date(d.getFullYear(), qFirstMonth + 3 * dir, 1);
  }
  return new Date(d.getFullYear(), d.getMonth() + dir, 1);
}
