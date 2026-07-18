type JsonRecord = Record<string, unknown>;
type EnergyLevel = 1 | 2 | 3 | 4 | 5;
type ConditionCode =
  | "comfortable"
  | "tired"
  | "low-energy"
  | "needs-space";

const CYCLE_PHASES = new Set(["menstrual", "follicular", "luteal", "unknown"]);
const CONDITION_CODES = new Set<ConditionCode>([
  "comfortable",
  "tired",
  "low-energy",
  "needs-space",
]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MAX_TAGS = 12;

export interface DateWindow {
  readonly startDate: string;
  readonly endDate: string;
}

export interface PeriodDates {
  readonly startDate: string;
  readonly endDate?: string;
}

export interface PartnerProjection {
  readonly ownerUid: string;
  readonly pairId: string;
  readonly schemaVersion: 1;
  /** Projection materialization time. It is not a source-record timestamp. */
  readonly generatedAt: string;
  /** LocalDate on which cycle-derived status was computed. */
  readonly cycleAsOfDate?: string;
  /** LocalDate of the daily check-in fields copied below. */
  readonly dailyLogDate?: string;
  readonly periodDates?: PeriodDates;
  readonly cyclePhase?: string;
  readonly nextPeriodWindow?: DateWindow;
  readonly symptomTags?: readonly string[];
  readonly moodTag?: string;
  readonly energyLevel?: EnergyLevel;
  readonly conditionCode?: ConditionCode;
  readonly carePreferences?: readonly string[];
  readonly note?: string;
}

export interface BuildProjectionInput {
  readonly ownerUid: string;
  readonly pairId: string;
  readonly generatedAt: string;
  readonly privateCycle?: unknown;
  readonly privateDailyLog?: unknown;
  readonly shareSettings?: unknown;
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as JsonRecord;
}

function isShared(settings: JsonRecord | undefined, field: string): boolean {
  return settings?.[field] === true;
}

function safeCyclePhase(value: unknown): string | undefined {
  return typeof value === "string" && CYCLE_PHASES.has(value)
    ? value
    : undefined;
}

function isIsoLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function safeDateWindow(value: unknown): DateWindow | undefined {
  const window = asRecord(value);
  const startDate = window?.startDate;
  const endDate = window?.endDate;

  if (
    !isIsoLocalDate(startDate) ||
    !isIsoLocalDate(endDate) ||
    startDate > endDate
  ) {
    return undefined;
  }

  return {startDate, endDate};
}

function safePeriodDates(value: unknown): PeriodDates | undefined {
  const periodDates = asRecord(value);
  const startDate = periodDates?.startDate;
  const endDate = periodDates?.endDate;

  if (!isIsoLocalDate(startDate)) {
    return undefined;
  }
  if (endDate === undefined || endDate === null) {
    return {startDate};
  }
  if (!isIsoLocalDate(endDate) || startDate > endDate) {
    return undefined;
  }

  return {startDate, endDate};
}

function safeTag(value: unknown): string | undefined {
  return typeof value === "string" && TAG.test(value) ? value : undefined;
}

function safeTags(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const tags = [
    ...new Set(value.map(safeTag).filter(tag => tag !== undefined)),
  ].slice(0, MAX_TAGS);
  return tags.length > 0 ? tags : undefined;
}

function safeEnergy(value: unknown): EnergyLevel | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
    ? (value as EnergyLevel)
    : undefined;
}

function safeCondition(value: unknown): ConditionCode | undefined {
  return typeof value === "string" &&
    CONDITION_CODES.has(value as ConditionCode)
    ? (value as ConditionCode)
    : undefined;
}

function safeNote(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 500
    ? value
    : undefined;
}

export function buildPartnerProjection(
  input: BuildProjectionInput,
): PartnerProjection {
  const cycle = asRecord(input.privateCycle);
  const dailyLog = asRecord(input.privateDailyLog);
  const shareSettings = asRecord(input.shareSettings);
  const projection: PartnerProjection = {
    ownerUid: input.ownerUid,
    pairId: input.pairId,
    schemaVersion: 1,
    generatedAt: input.generatedAt,
  };

  const cycleAsOfDate = isIsoLocalDate(cycle?.asOfDate)
    ? cycle.asOfDate
    : undefined;
  const dailyLogDate = isIsoLocalDate(dailyLog?.localDate)
    ? dailyLog.localDate
    : undefined;

  const periodDates = isShared(shareSettings, "periodDates")
    ? safePeriodDates(cycle?.periodDates)
    : undefined;
  const cyclePhase = isShared(shareSettings, "cyclePhase")
    // A phase without its source date can be stale while looking current.
    ? cycleAsOfDate === undefined
      ? undefined
      : safeCyclePhase(cycle?.cyclePhase)
    : undefined;
  const nextPeriodWindow = isShared(shareSettings, "nextPeriodWindow")
    ? safeDateWindow(cycle?.nextPeriodWindow)
    : undefined;
  const symptomTags = isShared(shareSettings, "symptomTags")
    ? dailyLogDate === undefined
      ? undefined
      : safeTags(dailyLog?.symptomTags)
    : undefined;
  const moodTag = isShared(shareSettings, "moodTag")
    ? dailyLogDate === undefined
      ? undefined
      : safeTag(dailyLog?.moodTag)
    : undefined;
  const energyLevel = isShared(shareSettings, "energyLevel")
    ? dailyLogDate === undefined
      ? undefined
      : safeEnergy(dailyLog?.energyLevel)
    : undefined;
  const conditionCode = isShared(shareSettings, "conditionCode")
    ? dailyLogDate === undefined
      ? undefined
      : safeCondition(dailyLog?.conditionCode)
    : undefined;
  const carePreferences = isShared(shareSettings, "carePreferences")
    ? dailyLogDate === undefined
      ? undefined
      : safeTags(dailyLog?.carePreferences)
    : undefined;
  const note = isShared(shareSettings, "note")
    ? dailyLogDate === undefined
      ? undefined
      : safeNote(dailyLog?.note)
    : undefined;

  const hasCycleValue =
    periodDates !== undefined ||
    cyclePhase !== undefined ||
    nextPeriodWindow !== undefined;
  const hasDailyValue =
    symptomTags !== undefined ||
    moodTag !== undefined ||
    energyLevel !== undefined ||
    conditionCode !== undefined ||
    carePreferences !== undefined ||
    note !== undefined;

  return {
    ...projection,
    ...(hasCycleValue && cycleAsOfDate !== undefined ? {cycleAsOfDate} : {}),
    ...(hasDailyValue && dailyLogDate !== undefined ? {dailyLogDate} : {}),
    ...(periodDates === undefined ? {} : {periodDates}),
    ...(cyclePhase === undefined ? {} : {cyclePhase}),
    ...(nextPeriodWindow === undefined ? {} : {nextPeriodWindow}),
    ...(symptomTags === undefined ? {} : {symptomTags}),
    ...(moodTag === undefined ? {} : {moodTag}),
    ...(energyLevel === undefined ? {} : {energyLevel}),
    ...(conditionCode === undefined ? {} : {conditionCode}),
    ...(carePreferences === undefined ? {} : {carePreferences}),
    ...(note === undefined ? {} : {note}),
  };
}
