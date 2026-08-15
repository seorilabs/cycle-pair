import { addDays, localDate, type LocalDate } from '@cyclepair/product-core';

const DAYS_PER_WEEK = 7;
const WEEKS_PER_GRID = 6;

export interface CalendarMonth {
  readonly year: number;
  readonly month: number;
}

function weekdayIndex(value: LocalDate): number {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year!, month! - 1, day!);
  return date.getUTCDay();
}

/**
 * Builds six explicit seven-day rows. Keeping row boundaries in data avoids
 * iOS percentage rounding from wrapping the seventh cell onto the next line.
 */
export function buildCalendarMonthRows(
  year: number,
  month: number,
): readonly (readonly LocalDate[])[] {
  const first = localDate(year, month, 1);
  const gridStart = addDays(first, -weekdayIndex(first));

  return Array.from({ length: WEEKS_PER_GRID }, (_week, weekIndex) =>
    Array.from({ length: DAYS_PER_WEEK }, (_day, dayIndex) =>
      addDays(gridStart, weekIndex * DAYS_PER_WEEK + dayIndex),
    ),
  );
}

/** Moves a calendar cursor without converting it through the device time zone. */
export function shiftCalendarMonth(
  value: CalendarMonth,
  offset: number,
): CalendarMonth {
  if (!Number.isInteger(offset)) {
    throw new RangeError('offset must be an integer');
  }
  const monthIndex = value.year * 12 + value.month - 1 + offset;
  return {
    year: Math.floor(monthIndex / 12),
    month: ((monthIndex % 12) + 12) % 12 + 1,
  };
}
