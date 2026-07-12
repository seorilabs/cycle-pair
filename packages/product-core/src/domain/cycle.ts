import { compareLocalDates, daysBetween } from "./local-date.js";
import type { LocalDate } from "./local-date.js";
import type {
  Cycle,
  CycleLog,
  CyclePhaseResult,
  EnergyLevel,
} from "./models.js";

export class CycleInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CycleInvariantError";
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new CycleInvariantError(`${field} must not be empty`);
  }
}

export function createCycle(input: Cycle): Cycle {
  requireNonEmpty(input.id, "cycle id");
  requireNonEmpty(input.memberId, "member id");
  if (input.endedOn && compareLocalDates(input.endedOn, input.startedOn) < 0) {
    throw new CycleInvariantError("cycle end must not precede its start");
  }

  return Object.freeze({
    id: input.id,
    memberId: input.memberId,
    startedOn: input.startedOn,
    ...(input.endedOn ? { endedOn: input.endedOn } : {}),
  });
}

function isEnergyLevel(value: number): value is EnergyLevel {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

export function createCycleLog(input: CycleLog): CycleLog {
  requireNonEmpty(input.id, "cycle log id");
  requireNonEmpty(input.memberId, "member id");
  if (input.energy !== undefined && !isEnergyLevel(input.energy)) {
    throw new CycleInvariantError("energy must be an integer between 1 and 5");
  }

  return Object.freeze({
    id: input.id,
    memberId: input.memberId,
    date: input.date,
    ...(input.bleeding !== undefined ? { bleeding: input.bleeding } : {}),
    ...(input.symptoms !== undefined ? { symptoms: Object.freeze([...input.symptoms]) } : {}),
    ...(input.mood !== undefined ? { mood: input.mood } : {}),
    ...(input.energy !== undefined ? { energy: input.energy } : {}),
    ...(input.condition !== undefined ? { condition: input.condition } : {}),
    ...(input.helpPreferences !== undefined
      ? { helpPreferences: Object.freeze([...input.helpPreferences]) }
      : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  });
}

export interface DetermineCyclePhaseInput {
  readonly on: LocalDate;
  readonly lastPeriodStart: LocalDate;
  readonly averageCycleLengthDays: number;
  readonly periodLengthDays?: number;
  readonly lutealLengthDays?: number;
  readonly ovulationWindowRadiusDays?: number;
}

export function determineCyclePhase(input: DetermineCyclePhaseInput): CyclePhaseResult {
  const periodLength = input.periodLengthDays ?? 5;
  const lutealLength = input.lutealLengthDays ?? 14;
  const ovulationRadius = input.ovulationWindowRadiusDays ?? 1;
  const cycleLength = input.averageCycleLengthDays;

  if (!Number.isInteger(cycleLength) || cycleLength < 15 || cycleLength > 60) {
    throw new CycleInvariantError("average cycle length must be an integer between 15 and 60");
  }
  if (!Number.isInteger(periodLength) || periodLength < 1 || periodLength >= cycleLength) {
    throw new CycleInvariantError("period length must be a positive integer shorter than the cycle");
  }
  if (!Number.isInteger(lutealLength) || lutealLength < 10 || lutealLength > 16) {
    throw new CycleInvariantError("luteal length must be an integer between 10 and 16");
  }
  if (!Number.isInteger(ovulationRadius) || ovulationRadius < 0 || ovulationRadius > 3) {
    throw new CycleInvariantError("ovulation window radius must be an integer between 0 and 3");
  }

  const offset = daysBetween(input.lastPeriodStart, input.on);
  if (offset < 0 || offset >= cycleLength) {
    return Object.freeze({ phase: "unknown", cycleDay: null, estimated: true });
  }

  const cycleDay = offset + 1;
  if (cycleDay <= periodLength) {
    return Object.freeze({ phase: "menstrual", cycleDay, estimated: true });
  }

  const ovulationDay = cycleLength - lutealLength;
  const ovulationStart = Math.max(periodLength + 1, ovulationDay - ovulationRadius);
  const ovulationEnd = Math.min(cycleLength, ovulationDay + ovulationRadius);
  if (cycleDay < ovulationStart) {
    return Object.freeze({ phase: "follicular", cycleDay, estimated: true });
  }
  if (cycleDay <= ovulationEnd) {
    return Object.freeze({ phase: "ovulatory", cycleDay, estimated: true });
  }
  return Object.freeze({ phase: "luteal", cycleDay, estimated: true });
}
