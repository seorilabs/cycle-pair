import { addDays, isLocalDate, type LocalDate } from '@cyclepair/product-core';

export interface CalendarDateRange {
  readonly start: LocalDate;
  readonly end: LocalDate;
}

export interface CalendarCycleRanges {
  readonly ownActual?: CalendarDateRange;
  readonly ownInferred?: CalendarDateRange;
  readonly partnerActual?: CalendarDateRange;
  readonly partnerPrediction?: CalendarDateRange;
}

export interface CalendarCycleRangeInput {
  readonly recordsOwnCycle: boolean;
  readonly ownPeriodStart?: string;
  readonly ownPeriodEnd?: string;
  readonly averagePeriodLength: number;
  readonly paired: boolean;
  readonly partnerPeriodDates?: {
    readonly startDate: string;
    readonly endDate?: string;
  };
  readonly partnerNextPeriodWindow?: {
    readonly startDate: string;
    readonly endDate: string;
  };
}

function validDate(value: unknown): LocalDate | undefined {
  return isLocalDate(value) ? value : undefined;
}

function orderedEnd(start?: LocalDate, end?: LocalDate): LocalDate | undefined {
  return start && end && end >= start ? end : undefined;
}

export function buildCalendarCycleRanges(
  input: CalendarCycleRangeInput,
): CalendarCycleRanges {
  const ownStart = input.recordsOwnCycle
    ? validDate(input.ownPeriodStart)
    : undefined;
  const ownExplicitEnd = orderedEnd(ownStart, validDate(input.ownPeriodEnd));
  const ownActual = ownStart
    ? { start: ownStart, end: ownExplicitEnd ?? ownStart }
    : undefined;
  const ownInferred =
    ownStart &&
    !ownExplicitEnd &&
    Number.isInteger(input.averagePeriodLength) &&
    input.averagePeriodLength > 1
      ? {
          start: addDays(ownStart, 1),
          end: addDays(ownStart, input.averagePeriodLength - 1),
        }
      : undefined;

  const partnerStart = input.paired
    ? validDate(input.partnerPeriodDates?.startDate)
    : undefined;
  const partnerEnd = orderedEnd(
    partnerStart,
    validDate(input.partnerPeriodDates?.endDate),
  );
  const partnerActual = partnerStart
    ? { start: partnerStart, end: partnerEnd ?? partnerStart }
    : undefined;

  const partnerPredictionStart = input.paired
    ? validDate(input.partnerNextPeriodWindow?.startDate)
    : undefined;
  const partnerPredictionEnd = orderedEnd(
    partnerPredictionStart,
    validDate(input.partnerNextPeriodWindow?.endDate),
  );
  const partnerPrediction =
    partnerPredictionStart && partnerPredictionEnd
      ? { start: partnerPredictionStart, end: partnerPredictionEnd }
      : undefined;

  return {
    ...(ownActual ? { ownActual } : {}),
    ...(ownInferred ? { ownInferred } : {}),
    ...(partnerActual ? { partnerActual } : {}),
    ...(partnerPrediction ? { partnerPrediction } : {}),
  };
}
