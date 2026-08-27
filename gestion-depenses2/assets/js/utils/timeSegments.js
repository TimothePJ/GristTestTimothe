import { toFiniteNumber } from "./format.js";
import { isFrenchHoliday } from "./frenchHolidays.js";
import { getMonthBusinessDays } from "./monthSegments.js";

export const HALF_DAY_PARTS = ["am", "pm"];

const HALF_DAY_TIMES = {
  am: {
    label: "matin",
    startHour: 8,
    endHour: 12,
  },
  pm: {
    label: "apres-midi",
    startHour: 13,
    endHour: 17,
  },
};

function createLocalDate(baseDate, hour, minute = 0) {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hour,
    minute,
    0,
    0
  );
}

export function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function parseRawDateTime(value) {
  if (value == null || value === "") return null;

  if (isValidDate(value)) {
    return new Date(value.getTime());
  }

  if (typeof value === "number") {
    const timestamp = value > 1e11 ? value : value * 1000;
    const date = new Date(timestamp);
    return isValidDate(date) ? date : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  const isoDate = new Date(text);
  if (isValidDate(isoDate)) {
    return isoDate;
  }

  const match = text.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i
  );
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  let hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const meridiem = String(match[6] || "").toLowerCase();

  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  } else if (meridiem === "am" && hour === 12) {
    hour = 0;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return isValidDate(date) ? date : null;
}

export function toGristDateTimeValue(value) {
  const date = parseRawDateTime(value);
  if (!date) return null;
  return Math.floor(date.getTime() / 1000);
}

export function isBusinessDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6 && !isFrenchHoliday(date);
}

export function toDateKey(date) {
  if (!isValidDate(date)) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createHalfDaySlotKey(date, part) {
  return `${toDateKey(date)}:${part}`;
}

export function getHalfDaySlotRange(baseDate, part) {
  const config = HALF_DAY_TIMES[part];
  if (!config || !isValidDate(baseDate)) {
    return null;
  }

  return {
    part,
    label: config.label,
    startAt: createLocalDate(baseDate, config.startHour),
    endAt: createLocalDate(baseDate, config.endHour),
  };
}

function getHalfDaySlotsBetween(startValue, endValue, { includeWeekends = false } = {}) {
  const startAt = parseRawDateTime(startValue);
  const endAt = parseRawDateTime(endValue);
  if (!startAt || !endAt) return [];

  const rangeStart = startAt <= endAt ? startAt : endAt;
  const rangeEnd = startAt <= endAt ? endAt : startAt;
  const cursor = new Date(
    rangeStart.getFullYear(),
    rangeStart.getMonth(),
    rangeStart.getDate()
  );
  const lastDay = new Date(
    rangeEnd.getFullYear(),
    rangeEnd.getMonth(),
    rangeEnd.getDate()
  );
  const slots = [];

  while (cursor <= lastDay) {
    const workingDay = isBusinessDay(cursor);
    if (includeWeekends || workingDay) {
      HALF_DAY_PARTS.forEach((part) => {
        const slotRange = getHalfDaySlotRange(cursor, part);
        if (!slotRange) return;

        if (rangeStart < slotRange.endAt && rangeEnd > slotRange.startAt) {
          slots.push({
            key: createHalfDaySlotKey(cursor, part),
            monthKey: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
            date: new Date(cursor),
            part,
            label: slotRange.label,
            isBusinessDay: workingDay,
            startAt: slotRange.startAt,
            endAt: slotRange.endAt,
          });
        }
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return slots;
}

export function getBusinessHalfDaySlotsBetween(startValue, endValue) {
  return getHalfDaySlotsBetween(startValue, endValue, {
    includeWeekends: false,
  });
}

export function getCalendarHalfDaySlotsBetween(startValue, endValue) {
  return getHalfDaySlotsBetween(startValue, endValue, {
    includeWeekends: true,
  });
}

// Capacite d'un segment = jours ouvres de son mois (week-ends et feries exclus).
// Depuis le passage au mois, `allocationDays` stocke en base n'est plus lu : il
// reste ecrit pour la lisibilite de la grille Grist, mais la verite est le mois.
export function getSegmentAllocationDays(segment) {
  return getMonthBusinessDays(segment?.monthKey);
}

export function getSegmentEffectiveDays(segment) {
  const allocationDays = getSegmentAllocationDays(segment);
  if (allocationDays <= 0) return 0;

  const rawEffectifDays = segment?.effectifDays ?? segment?.effectif;
  if (rawEffectifDays == null || rawEffectifDays === "") return 0;

  const parsedEffectifDays = Math.max(0, toFiniteNumber(rawEffectifDays, 0));
  return Math.min(allocationDays, parsedEffectifDays);
}

// getSegmentAllocationByMonth / buildMonthSlotCounts ont disparu avec le passage
// au mois : un segment ne couvre plus qu'un seul mois, la ventilation au prorata
// des demi-journees n'a plus d'objet. Les totaux mensuels se posent desormais
// directement (provisionalDays[monthKey] = effectif) dans projectService.js et
// dans les mises a jour optimistes de main.js.
