// Pure half-day slot / segment math for planning-synchro.
// No top-level access to window/document/localStorage: safe to import under Node.
//
// HALF_DAY_PARTS, HALF_DAY_TIMES, createLocalDate, isValidDate, isBusinessDay,
// toDateKey, createHalfDaySlotKey, getHalfDaySlotRange,
// getBusinessHalfDaySlotsBetween (and its private getHalfDaySlotsBetween),
// getSegmentAllocationDays, getSegmentEffectiveDays, toGristDateTimeValue are
// ported verbatim from `gestion-depenses2/assets/js/utils/timeSegments.js`
// (~lines 3-16, 18-28, 30-32, 77-193). The original `parseRawDateTime` calls
// are replaced with `parseDateTime` imported from `./dates.js` (this widget's
// renamed port of that function); `parseRawDateTime` itself is not redefined
// here.

import { toFiniteNumber } from "./format.js";
import { parseDateTime } from "./dates.js";

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

export function toGristDateTimeValue(value) {
  const date = parseDateTime(value);
  if (!date) return null;
  return Math.floor(date.getTime() / 1000);
}

export function isBusinessDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
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
  const startAt = parseDateTime(startValue);
  const endAt = parseDateTime(endValue);
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

export function getSegmentAllocationDays(segment) {
  const explicitAllocation = toFiniteNumber(segment?.allocationDays, 0);
  if (explicitAllocation > 0) {
    return explicitAllocation;
  }

  const slots = getBusinessHalfDaySlotsBetween(segment?.startAt, segment?.endAt);
  return slots.length / 2;
}

export function getSegmentEffectiveDays(segment) {
  const allocationDays = getSegmentAllocationDays(segment);
  const rawEffectifDays = segment?.effectifDays ?? segment?.effectif;

  if (rawEffectifDays == null || rawEffectifDays === "") {
    return 0;
  }

  const parsedEffectifDays = Math.max(0, toFiniteNumber(rawEffectifDays, 0));
  return Math.min(allocationDays, parsedEffectifDays);
}
