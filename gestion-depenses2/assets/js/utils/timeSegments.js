import { toFiniteNumber } from "./format.js";

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

export function getBusinessHalfDaySlotsBetween(startValue, endValue) {
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
    if (isBusinessDay(cursor)) {
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

export function getSegmentAllocationDays(segment) {
  const explicitAllocation = toFiniteNumber(segment?.allocationDays, 0);
  if (explicitAllocation > 0) {
    return explicitAllocation;
  }

  const slots = getBusinessHalfDaySlotsBetween(segment?.startAt, segment?.endAt);
  return slots.length / 2;
}

export function getSegmentAllocationByMonth(segment) {
  const slots = getBusinessHalfDaySlotsBetween(segment?.startAt, segment?.endAt);
  if (!slots.length) return {};

  const totalDays = getSegmentAllocationDays(segment);
  if (totalDays <= 0) return {};

  const daysPerSlot = totalDays / slots.length;
  return slots.reduce((accumulator, slot) => {
    accumulator[slot.monthKey] =
      Math.round(((accumulator[slot.monthKey] || 0) + daysPerSlot) * 100) / 100;
    return accumulator;
  }, {});
}

export function buildHalfDaySelectionDates(startSlot, endSlot) {
  if (!startSlot || !endSlot) return null;

  const startAt = parseRawDateTime(startSlot.startAt);
  const endAt = parseRawDateTime(endSlot.endAt);
  if (!startAt || !endAt) return null;

  return {
    startAt,
    endAt,
    allocationDays: 0.5 + Math.max(0, endSlot.slotIndex - startSlot.slotIndex) * 0.5,
  };
}
