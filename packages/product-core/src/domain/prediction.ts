import { addDays, daysBetween, sortUniqueLocalDates } from "./local-date.js";
import type { LocalDate } from "./local-date.js";
import type { Cycle, Prediction, PredictionConfidence } from "./models.js";

const DEFAULT_MIN_CYCLE_DAYS = 15;
const DEFAULT_MAX_CYCLE_DAYS = 60;
const DEFAULT_RECENT_INTERVAL_WINDOW = 12;
const RECENT_EXCLUSION_WINDOW = 6;

export class PredictionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PredictionInputError";
  }
}

export interface PredictionConfig {
  readonly minimumCycleLengthDays?: number;
  readonly maximumCycleLengthDays?: number;
  readonly recentIntervalWindow?: number;
}

export interface CycleSeedPredictionInput {
  readonly memberId: string;
  readonly generatedOn: LocalDate;
  readonly lastPeriodStart: LocalDate;
  readonly averageCycleLengthDays: number;
}

/**
 * Produces an explicitly low-confidence estimate from user-entered seed data.
 * It must not be presented as observed history: sampleSize remains zero.
 */
export function predictFromCycleSeed(input: CycleSeedPredictionInput): Prediction {
  if (input.memberId.trim().length === 0) {
    throw new PredictionInputError("Seed prediction member id must not be empty");
  }
  if (
    !Number.isInteger(input.averageCycleLengthDays) ||
    input.averageCycleLengthDays < DEFAULT_MIN_CYCLE_DAYS ||
    input.averageCycleLengthDays > DEFAULT_MAX_CYCLE_DAYS
  ) {
    throw new PredictionInputError("Seed average cycle length must be an integer between 15 and 60");
  }

  const nextPeriodDate = addDays(input.lastPeriodStart, input.averageCycleLengthDays);
  const daysLate = Math.max(daysBetween(nextPeriodDate, input.generatedOn), 0);
  const radius = windowRadiusFor("low");
  return Object.freeze({
    memberId: input.memberId,
    generatedOn: input.generatedOn,
    lastPeriodStart: input.lastPeriodStart,
    nextPeriodDate,
    daysLate,
    averageCycleLengthDays: input.averageCycleLengthDays,
    confidence: "low",
    confidenceWindow: Object.freeze({
      start: addDays(nextPeriodDate, -radius),
      end: addDays(nextPeriodDate, radius),
    }),
    sampleSize: 0,
    observedCycleLengths: Object.freeze([]),
    excludedIntervalCount: 0,
  });
}

interface CycleIntervalSummary {
  readonly memberId: string;
  readonly starts: readonly LocalDate[];
  readonly validIntervals: readonly number[];
  readonly truncatedIntervalCount: number;
  readonly excludedIntervalCount: number;
  readonly hasRecentExcludedInterval: boolean;
}

function summarizeIntervals(
  cycles: readonly Cycle[],
  config: PredictionConfig = {},
): CycleIntervalSummary | null {
  if (cycles.length === 0) {
    return null;
  }

  const memberIds = new Set(cycles.map((cycle) => cycle.memberId));
  if (memberIds.size !== 1) {
    throw new PredictionInputError("Prediction history must belong to one member");
  }
  const memberId = cycles[0]?.memberId;
  if (!memberId) {
    throw new PredictionInputError("Prediction history has no member");
  }

  const minimum = config.minimumCycleLengthDays ?? DEFAULT_MIN_CYCLE_DAYS;
  const maximum = config.maximumCycleLengthDays ?? DEFAULT_MAX_CYCLE_DAYS;
  const recentIntervalWindow =
    config.recentIntervalWindow ?? DEFAULT_RECENT_INTERVAL_WINDOW;
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 1 || minimum >= maximum) {
    throw new PredictionInputError("Cycle interval bounds are invalid");
  }
  if (!Number.isInteger(recentIntervalWindow) || recentIntervalWindow < 1) {
    throw new PredictionInputError("Recent interval window must be a positive integer");
  }

  const starts = sortUniqueLocalDates(cycles.map((cycle) => cycle.startedOn));
  const validIntervals: number[] = [];
  let excludedIntervalCount = 0;
  let hasRecentExcludedInterval = false;
  const intervalCount = Math.max(starts.length - 1, 0);
  for (let index = 1; index < starts.length; index += 1) {
    const previous = starts[index - 1];
    const current = starts[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const interval = daysBetween(previous, current);
    if (interval >= minimum && interval <= maximum) {
      validIntervals.push(interval);
    } else {
      excludedIntervalCount += 1;
      if (index > intervalCount - RECENT_EXCLUSION_WINDOW) {
        hasRecentExcludedInterval = true;
      }
    }
  }

  const recentValidIntervals = validIntervals.slice(-recentIntervalWindow);
  return {
    memberId,
    starts,
    validIntervals: Object.freeze(recentValidIntervals),
    truncatedIntervalCount: validIntervals.length - recentValidIntervals.length,
    excludedIntervalCount,
    hasRecentExcludedInterval,
  };
}

function averageCycleLengthFor(summary: CycleIntervalSummary): number {
  if (summary.truncatedIntervalCount === 0) {
    const total = summary.validIntervals.reduce((sum, value) => sum + value, 0);
    return Math.round(total / summary.validIntervals.length);
  }

  let weightedTotal = 0;
  let totalWeight = 0;
  summary.validIntervals.forEach((value, index) => {
    const weight = index + 1;
    weightedTotal += value * weight;
    totalWeight += weight;
  });
  return Math.round(weightedTotal / totalWeight);
}

export function calculateAverageCycleLength(
  cycles: readonly Cycle[],
  config: PredictionConfig = {},
): number | null {
  const summary = summarizeIntervals(cycles, config);
  if (!summary || summary.validIntervals.length === 0) {
    return null;
  }
  return averageCycleLengthFor(summary);
}

function populationStandardDeviation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function confidenceFor(
  intervals: readonly number[],
  hasRecentExcludedInterval: boolean,
): PredictionConfidence {
  if (hasRecentExcludedInterval) {
    return "low";
  }
  const deviation = populationStandardDeviation(intervals);
  if (intervals.length >= 5 && deviation <= 2) {
    return "high";
  }
  if (intervals.length >= 3 && deviation <= 4) {
    return "medium";
  }
  return "low";
}

function windowRadiusFor(confidence: PredictionConfidence): number {
  switch (confidence) {
    case "high":
      return 2;
    case "medium":
      return 4;
    case "low":
      return 7;
  }
}

export function predictNextPeriod(
  cycles: readonly Cycle[],
  generatedOn: LocalDate,
  config: PredictionConfig = {},
): Prediction | null {
  const summary = summarizeIntervals(cycles, config);
  if (!summary || summary.validIntervals.length === 0) {
    return null;
  }

  const averageCycleLengthDays = averageCycleLengthFor(summary);
  const lastPeriodStart = summary.starts.at(-1);
  if (!lastPeriodStart) {
    return null;
  }
  const nextPeriodDate = addDays(lastPeriodStart, averageCycleLengthDays);
  const daysLate = Math.max(daysBetween(nextPeriodDate, generatedOn), 0);
  const confidence = confidenceFor(
    summary.validIntervals,
    summary.hasRecentExcludedInterval,
  );
  const radius = windowRadiusFor(confidence);

  return Object.freeze({
    memberId: summary.memberId,
    generatedOn,
    lastPeriodStart,
    nextPeriodDate,
    daysLate,
    averageCycleLengthDays,
    confidence,
    confidenceWindow: Object.freeze({
      start: addDays(nextPeriodDate, -radius),
      end: addDays(nextPeriodDate, radius),
    }),
    sampleSize: summary.validIntervals.length,
    observedCycleLengths: Object.freeze([...summary.validIntervals]),
    excludedIntervalCount: summary.excludedIntervalCount,
  });
}
