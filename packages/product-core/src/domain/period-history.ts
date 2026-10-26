import { daysBetween, type LocalDate } from './local-date.js';

export interface PeriodBoundary {
  readonly date: LocalDate;
  readonly started: boolean;
  readonly ended: boolean;
}

export interface RecordedPeriod {
  readonly start?: LocalDate;
  readonly end?: LocalDate;
  readonly lengthDays?: number;
}

export function buildRecordedPeriods(
  boundaries: readonly PeriodBoundary[],
): readonly RecordedPeriod[] {
  const byDate = new Map<LocalDate, PeriodBoundary>();
  for (const boundary of boundaries) {
    const previous = byDate.get(boundary.date);
    byDate.set(boundary.date, {
      date: boundary.date,
      started: boundary.started || previous?.started === true,
      ended: boundary.ended || previous?.ended === true,
    });
  }
  const periods: RecordedPeriod[] = [];
  let start: LocalDate | undefined;
  for (const boundary of [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    if (boundary.started) {
      if (start) periods.push({ start });
      start = boundary.date;
    }
    if (boundary.ended) {
      periods.push(
        start
          ? {
              start,
              end: boundary.date,
              lengthDays: daysBetween(start, boundary.date) + 1,
            }
          : { end: boundary.date },
      );
      start = undefined;
    }
  }
  if (start) periods.push({ start });
  return periods;
}
