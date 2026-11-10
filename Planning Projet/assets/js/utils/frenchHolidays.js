// frenchHolidays.js — pure, self-contained. French métropole public holidays,
// computed (Easter via the anonymous Gregorian / Meeus algorithm). No imports.
// BYTE-IDENTICAL copy in each widget. Keys are LOCAL "YYYY-MM-DD" to match the
// widgets' local getDay()/getDate() isBusinessDay logic.

const holidayCache = new Map();

function pad2(n) {
  return String(n).padStart(2, "0");
}
function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher) → Easter Sunday.
export function computeEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function holidaySet(year) {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const set = new Set([
    `${year}-01-01`, // Jour de l'an
    `${year}-05-01`, // Fête du travail
    `${year}-05-08`, // Victoire 1945
    `${year}-07-14`, // Fête nationale
    `${year}-08-15`, // Assomption
    `${year}-11-01`, // Toussaint
    `${year}-11-11`, // Armistice
    `${year}-12-25`, // Noël
  ]);
  const easter = computeEaster(year);
  const addEasterOffset = (offset) => {
    const d = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + offset);
    set.add(dateKey(d));
  };
  addEasterOffset(1); // Lundi de Pâques
  addEasterOffset(39); // Ascension
  addEasterOffset(50); // Lundi de Pentecôte
  holidayCache.set(year, set);
  return set;
}

export function isFrenchHoliday(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  return holidaySet(date.getFullYear()).has(dateKey(date));
}
