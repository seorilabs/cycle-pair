const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

declare const localDateBrand: unique symbol;

/** A Gregorian calendar date with no time or time-zone component. */
export type LocalDate = string & { readonly [localDateBrand]: "LocalDate" };

export class InvalidLocalDateError extends RangeError {
  constructor(value: unknown) {
    super(`Invalid LocalDate: ${String(value)}`);
    this.name = "InvalidLocalDateError";
  }
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function toParts(value: string): readonly [number, number, number] | null {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    year < 1 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    return null;
  }

  return [year, month, day];
}

export function isLocalDate(value: unknown): value is LocalDate {
  return typeof value === "string" && toParts(value) !== null;
}

export function parseLocalDate(value: string): LocalDate {
  if (!isLocalDate(value)) {
    throw new InvalidLocalDateError(value);
  }
  return value;
}

export function localDate(year: number, month: number, day: number): LocalDate {
  if (![year, month, day].every(Number.isInteger)) {
    throw new InvalidLocalDateError(`${year}-${month}-${day}`);
  }
  return parseLocalDate(
    `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
      .toString()
      .padStart(2, "0")}`,
  );
}

function toEpochMilliseconds(value: LocalDate): number {
  const parts = toParts(value);
  if (!parts) {
    throw new InvalidLocalDateError(value);
  }
  const [year, month, day] = parts;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

function fromEpochMilliseconds(value: number): LocalDate {
  const date = new Date(value);
  return localDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(value: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) {
    throw new RangeError("days must be an integer");
  }
  return fromEpochMilliseconds(toEpochMilliseconds(value) + days * MILLISECONDS_PER_DAY);
}

/** Returns `to - from` in calendar days. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return (toEpochMilliseconds(to) - toEpochMilliseconds(from)) / MILLISECONDS_PER_DAY;
}

export function compareLocalDates(left: LocalDate, right: LocalDate): -1 | 0 | 1 {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function minLocalDate(left: LocalDate, right: LocalDate): LocalDate {
  return compareLocalDates(left, right) <= 0 ? left : right;
}

export function maxLocalDate(left: LocalDate, right: LocalDate): LocalDate {
  return compareLocalDates(left, right) >= 0 ? left : right;
}

export function sortUniqueLocalDates(values: readonly LocalDate[]): readonly LocalDate[] {
  return Object.freeze([...new Set(values)].sort(compareLocalDates));
}
