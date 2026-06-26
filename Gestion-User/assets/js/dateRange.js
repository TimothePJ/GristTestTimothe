const DAY_MS = 86400000;

export function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCurrentWeekValue(date = new Date()) {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const week1 = new Date(target.getFullYear(), 0, 4);
  const week = 1 + Math.round(
    ((target.getTime() - week1.getTime()) / DAY_MS - 3 + ((week1.getDay() + 6) % 7)) / 7
  );
  return `${target.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function getCurrentMonthValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function getYearFromWeekValue(weekValue, fallbackDate = new Date()) {
  const match = String(weekValue || "").match(/^(\d{4})-W\d{2}$/);
  return match ? Number(match[1]) : fallbackDate.getFullYear();
}

export function getYearFromMonthValue(monthValue, fallbackDate = new Date()) {
  const match = String(monthValue || "").match(/^(\d{4})-\d{2}$/);
  return match ? Number(match[1]) : fallbackDate.getFullYear();
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function parseDateTime(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value > 100000000000 ? value : value * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value).trim();
  const frenchMatch = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?)?$/
  );
  if (frenchMatch) {
    const [, day, month, year, hour = "0", minute = "0"] = frenchMatch;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute)
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getWeekRange(weekValue) {
  const match = String(weekValue || "").match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  const end = new Date(monday);
  end.setDate(monday.getDate() + 7);
  return {
    start: monday,
    end,
    label: `Semaine ${String(week).padStart(2, "0")} - ${year}`,
  };
}

function getIsoWeekInfo(date) {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const week1 = new Date(target.getFullYear(), 0, 4);
  const week = 1 + Math.round(
    ((target.getTime() - week1.getTime()) / DAY_MS - 3 + ((week1.getDay() + 6) % 7)) / 7
  );
  return {
    year: target.getFullYear(),
    week,
    value: `${target.getFullYear()}-W${String(week).padStart(2, "0")}`,
  };
}

function getWeekMonthLabel(date) {
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

export function getWeeksGroupedByMonth(year) {
  const normalizedYear = Number(year) || new Date().getFullYear();
  const jan4 = new Date(normalizedYear, 0, 4);
  const firstMonday = new Date(jan4);
  firstMonday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  firstMonday.setHours(0, 0, 0, 0);

  const groups = [];
  const groupsByKey = new Map();
  const cursor = new Date(firstMonday);

  while (true) {
    const iso = getIsoWeekInfo(cursor);
    if (iso.year > normalizedYear) break;

    if (iso.year === normalizedYear) {
      const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      if (!groupsByKey.has(monthKey)) {
        const group = {
          key: monthKey,
          label: getWeekMonthLabel(cursor),
          weeks: [],
        };
        groupsByKey.set(monthKey, group);
        groups.push(group);
      }

      const end = addDays(cursor, 6);
      groupsByKey.get(monthKey).weeks.push({
        value: iso.value,
        week: iso.week,
        label: `Semaine ${String(iso.week).padStart(2, "0")}`,
        detail: `${cursor.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} - ${end.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`,
      });
    }

    cursor.setDate(cursor.getDate() + 7);
  }

  return groups;
}

export function getMonthRange(monthValue) {
  const match = String(monthValue || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  const label = start.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return { start, end, label };
}

export function getMonthsForYear(year) {
  const normalizedYear = Number(year) || new Date().getFullYear();
  return Array.from({ length: 12 }, (_, monthIndex) => {
    const date = new Date(normalizedYear, monthIndex, 1);
    return {
      value: `${normalizedYear}-${String(monthIndex + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("fr-FR", { month: "long" }),
    };
  });
}

export function getCustomRange(startValue, endValue) {
  const start = parseDateTime(startValue);
  const endDate = parseDateTime(endValue);
  if (!start || !endDate) return null;
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  if (end <= start) return null;
  return {
    start,
    end,
    label: `${start.toLocaleDateString("fr-FR")} - ${endDate.toLocaleDateString("fr-FR")}`,
  };
}

export function isWeekday(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

export function countWorkingDays(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date) || end <= start) return 0;
  let days = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  while (cursor < end) {
    if (isWeekday(cursor)) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

export function countWorkingHalfDayUnits(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date) || end <= start) return 0;
  let units = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  while (cursor < end) {
    if (isWeekday(cursor)) {
      const morningStart = new Date(cursor);
      morningStart.setHours(8, 0, 0, 0);
      const morningEnd = new Date(cursor);
      morningEnd.setHours(12, 0, 0, 0);
      const afternoonStart = new Date(cursor);
      afternoonStart.setHours(13, 0, 0, 0);
      const afternoonEnd = new Date(cursor);
      afternoonEnd.setHours(17, 0, 0, 0);

      if (overlaps(start, end, morningStart, morningEnd)) units += 1;
      if (overlaps(start, end, afternoonStart, afternoonEnd)) units += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return units;
}

export function getIntersection(startA, endA, startB, endB) {
  const start = new Date(Math.max(startA.getTime(), startB.getTime()));
  const end = new Date(Math.min(endA.getTime(), endB.getTime()));
  return end > start ? { start, end } : null;
}

export function getRangeCapacityDays(range) {
  return countWorkingDays(range?.start, range?.end);
}

export function shiftWeekValue(weekValue, delta) {
  const range = getWeekRange(weekValue);
  if (!range) return getCurrentWeekValue();
  return getCurrentWeekValue(addDays(range.start, delta * 7));
}

export function shiftMonthValue(monthValue, delta) {
  const range = getMonthRange(monthValue);
  if (!range) return getCurrentMonthValue();
  const next = new Date(range.start);
  next.setMonth(next.getMonth() + delta);
  return getCurrentMonthValue(next);
}

export function shiftCustomRangeValues(startValue, endValue, delta) {
  const range = getCustomRange(startValue, endValue);
  if (!range) {
    const today = new Date();
    const end = addDays(today, 7);
    return { startValue: toInputDate(today), endValue: toInputDate(end) };
  }

  const spanDays = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS));
  const nextStart = addDays(range.start, delta * spanDays);
  const currentEndInclusive = addDays(range.end, -1);
  const nextEndInclusive = addDays(currentEndInclusive, delta * spanDays);
  return {
    startValue: toInputDate(nextStart),
    endValue: toInputDate(nextEndInclusive),
  };
}
