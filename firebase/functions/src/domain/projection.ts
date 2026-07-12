type JsonRecord = Record<string, unknown>;

const CYCLE_PHASES = new Set([
  "menstrual",
  "follicular",
  "luteal",
  "unknown",
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
  readonly generatedAt: string;
  readonly periodDates?: PeriodDates;
  readonly cyclePhase?: string;
  readonly nextPeriodWindow?: DateWindow;
  readonly pmsWindow?: DateWindow;
  readonly symptomTags?: readonly string[];
  readonly moodTag?: string;
  readonly carePreferences?: readonly string[];
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
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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

  const tags = [...new Set(value.map(safeTag).filter(tag => tag !== undefined))]
    .slice(0, MAX_TAGS);
  return tags.length > 0 ? tags : undefined;
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

  const periodDates = isShared(shareSettings, "periodDates")
    ? safePeriodDates(cycle?.periodDates)
    : undefined;
  const cyclePhase = isShared(shareSettings, "cyclePhase")
    ? safeCyclePhase(cycle?.cyclePhase)
    : undefined;
  const nextPeriodWindow = isShared(shareSettings, "nextPeriodWindow")
    ? safeDateWindow(cycle?.nextPeriodWindow)
    : undefined;
  const pmsWindow = isShared(shareSettings, "pmsWindow")
    ? safeDateWindow(cycle?.pmsWindow)
    : undefined;
  const symptomTags = isShared(shareSettings, "symptomTags")
    ? safeTags(dailyLog?.symptomTags)
    : undefined;
  const moodTag = isShared(shareSettings, "moodTag")
    ? safeTag(dailyLog?.moodTag)
    : undefined;
  const carePreferences = isShared(shareSettings, "carePreferences")
    ? safeTags(dailyLog?.carePreferences)
    : undefined;

  return {
    ...projection,
    ...(periodDates === undefined ? {} : {periodDates}),
    ...(cyclePhase === undefined ? {} : {cyclePhase}),
    ...(nextPeriodWindow === undefined ? {} : {nextPeriodWindow}),
    ...(pmsWindow === undefined ? {} : {pmsWindow}),
    ...(symptomTags === undefined ? {} : {symptomTags}),
    ...(moodTag === undefined ? {} : {moodTag}),
    ...(carePreferences === undefined ? {} : {carePreferences}),
  };
}
