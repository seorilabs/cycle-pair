type JsonRecord = Record<string, unknown>;
type EnergyLevel = 1 | 2 | 3 | 4 | 5;
type ConditionCode =
  | "comfortable"
  | "cramps"
  | "headache"
  | "needs-space";

const CYCLE_PHASES = new Set([
  "menstrual",
  "follicular",
  "ovulatory",
  "luteal",
  "unknown",
]);
const CYCLE_STATUSES = new Set([
  "period-starting",
  "period-in-progress",
  "period-ending",
  "post-period",
  "fertile-window",
  "pre-period",
  "cycle-in-progress",
  "period-late",
  "unknown",
]);
const CONDITION_CODES = new Set<ConditionCode>([
  "comfortable",
  "cramps",
  "headache",
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
  readonly cycleStatus?: string;
  readonly nextPeriodWindow?: DateWindow;
  readonly symptomTags?: readonly string[];
  readonly emotionTags?: readonly string[];
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

/**
 * 공유 동의 판정의 정본.
 *
 * 누락과 `false`를 같게 다루고 문자열 `"true"` 같은 값은 동의로 보지 않는다.
 * 이 규칙을 두 벌로 만들면 파트너 화면과 알림이 다른 기준으로 갈린다.
 */
export function isShared(
  settings: JsonRecord | undefined,
  field: string,
): boolean {
  return settings?.[field] === true;
}

function safeCyclePhase(value: unknown): string | undefined {
  return typeof value === "string" && CYCLE_PHASES.has(value)
    ? value
    : undefined;
}

function safeCycleStatus(value: unknown): string | undefined {
  return typeof value === "string" && CYCLE_STATUSES.has(value)
    ? value
    : undefined;
}

/**
 * 가임 정보를 동의 없이 내보내지 않으면서, 그 사실이 **부재로 역추론되지도**
 * 않게 만든다.
 *
 * 예전에는 가임을 드러내는 값만 빼고 나머지 날은 그대로 보냈다. 그러면 다른
 * 날에는 값이 보이고 가임 구간에만 사라지므로, 값이 없다는 사실 자체가 가임
 * 정보였다. 숨기는 대신 인접 값으로 접어 필드 존재 여부가 날짜와 무관하게
 * 한다.
 *
 * 필드 동의가 없으면 날짜와 무관하게 언제나 부재한다. 가임 동의만 있으면
 * 가임 구간에만 값이 나가는데, 그건 사용자가 공유하기로 한 정보 그 자체다.
 */
function sharedFertilitySafeValue(
  raw: string | undefined,
  options: {
    readonly fertilityValue: string;
    readonly foldedValue: string;
    readonly sharesField: boolean;
    readonly sharesFertility: boolean;
  },
): string | undefined {
  if (raw === undefined) return undefined;
  if (options.sharesFertility) {
    return options.sharesField || raw === options.fertilityValue
      ? raw
      : undefined;
  }
  if (!options.sharesField) return undefined;
  return raw === options.fertilityValue ? options.foldedValue : raw;
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

const EMOTION_CODES = new Set([
  "calm",
  "happy",
  "affectionate",
  "anxious",
  "irritable",
  "hurt",
  "lonely",
  "drained",
  "other",
]);
const MAX_EMOTIONS = 3;

/** 감정은 알려진 코드만, 중복 없이, 상한까지만 내보낸다. */
function safeEmotions(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const codes = [
    ...new Set(
      value.filter(
        (entry): entry is string =>
          typeof entry === "string" && EMOTION_CODES.has(entry),
      ),
    ),
  ].slice(0, MAX_EMOTIONS);
  return codes.length > 0 ? codes : undefined;
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
  const rawCyclePhase = safeCyclePhase(cycle?.cyclePhase);
  const rawCycleStatus = safeCycleStatus(cycle?.cycleStatus);
  const sharesGeneralCycle = isShared(shareSettings, "cyclePhase");
  const sharesDetailedCycle = isShared(shareSettings, "cycleStatus");
  const sharesFertility = isShared(shareSettings, "fertilityStatus");
  const cyclePhase =
    cycleAsOfDate === undefined
      ? undefined
      : sharedFertilitySafeValue(rawCyclePhase, {
          fertilityValue: "ovulatory",
          foldedValue: "follicular",
          sharesField: sharesGeneralCycle,
          sharesFertility,
        });
  const cycleStatus =
    cycleAsOfDate === undefined
      ? undefined
      : sharedFertilitySafeValue(rawCycleStatus, {
          fertilityValue: "fertile-window",
          foldedValue: "cycle-in-progress",
          sharesField: sharesDetailedCycle,
          sharesFertility,
        });
  const nextPeriodWindow = isShared(shareSettings, "nextPeriodWindow")
    ? safeDateWindow(cycle?.nextPeriodWindow)
    : undefined;
  const symptomTags = isShared(shareSettings, "symptomTags")
    ? dailyLogDate === undefined
      ? undefined
      : safeTags(dailyLog?.symptomTags)
    : undefined;
  const emotionTags = isShared(shareSettings, "emotionTags")
    ? dailyLogDate === undefined
      ? undefined
      : safeEmotions(dailyLog?.emotionTags)
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
    cycleStatus !== undefined ||
    nextPeriodWindow !== undefined;
  const hasDailyValue =
    symptomTags !== undefined ||
    emotionTags !== undefined ||
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
    ...(cycleStatus === undefined ? {} : {cycleStatus}),
    ...(nextPeriodWindow === undefined ? {} : {nextPeriodWindow}),
    ...(symptomTags === undefined ? {} : {symptomTags}),
    ...(emotionTags === undefined ? {} : {emotionTags}),
    ...(energyLevel === undefined ? {} : {energyLevel}),
    ...(conditionCode === undefined ? {} : {conditionCode}),
    ...(carePreferences === undefined ? {} : {carePreferences}),
    ...(note === undefined ? {} : {note}),
  };
}
