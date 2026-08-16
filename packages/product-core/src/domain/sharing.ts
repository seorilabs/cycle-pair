import type { LocalDate } from "./local-date.js";
import type {
  Cycle,
  CycleLog,
  CyclePhase,
  PartnerProjection,
  Prediction,
  ShareableField,
  ShareSettings,
} from "./models.js";

const SHAREABLE_FIELDS: readonly ShareableField[] = Object.freeze([
  "periodDates",
  "cyclePhase",
  "fertilityStatus",
  "prediction",
  "symptoms",
  "mood",
  "energy",
  "condition",
  "helpPreferences",
  "note",
]);

export function createShareSettings(
  memberId: string,
  updatedOn: LocalDate,
  shared: Partial<Record<ShareableField, boolean>> = {},
): ShareSettings {
  if (memberId.trim().length === 0) {
    throw new Error("member id must not be empty");
  }

  const fields = Object.fromEntries(
    SHAREABLE_FIELDS.map((field) => [field, shared[field] === true]),
  ) as Record<ShareableField, boolean>;

  return Object.freeze({
    memberId,
    updatedOn,
    fields: Object.freeze(fields),
  });
}

export interface PartnerProjectionSource {
  readonly subjectMemberId: string;
  readonly asOf: LocalDate;
  readonly currentCycle?: Cycle;
  readonly cyclePhase?: CyclePhase;
  readonly prediction?: Prediction;
  readonly latestLog?: CycleLog;
}

export function projectForPartner(
  source: PartnerProjectionSource,
  settings: ShareSettings,
): PartnerProjection {
  if (settings.memberId !== source.subjectMemberId) {
    throw new Error("Share settings do not belong to the projection subject");
  }
  if (source.latestLog && source.latestLog.memberId !== source.subjectMemberId) {
    throw new Error("Cycle log does not belong to the projection subject");
  }
  if (source.prediction && source.prediction.memberId !== source.subjectMemberId) {
    throw new Error("Prediction does not belong to the projection subject");
  }
  if (source.currentCycle && source.currentCycle.memberId !== source.subjectMemberId) {
    throw new Error("Cycle does not belong to the projection subject");
  }

  const log = source.latestLog;
  return Object.freeze({
    subjectMemberId: source.subjectMemberId,
    asOf: source.asOf,
    ...(settings.fields.periodDates && source.currentCycle !== undefined
      ? {
          periodDates: Object.freeze({
            start: source.currentCycle.startedOn,
            ...(source.currentCycle.endedOn !== undefined
              ? { end: source.currentCycle.endedOn }
              : {}),
          }),
        }
      : {}),
    ...(((settings.fields.cyclePhase && source.cyclePhase !== "ovulatory") ||
      (settings.fields.fertilityStatus && source.cyclePhase === "ovulatory")) &&
    source.cyclePhase !== undefined
      ? { cyclePhase: source.cyclePhase }
      : {}),
    ...(settings.fields.prediction && source.prediction !== undefined
      ? {
          prediction: Object.freeze({
            nextPeriodDate: source.prediction.nextPeriodDate,
            confidence: source.prediction.confidence,
            confidenceWindow: Object.freeze({ ...source.prediction.confidenceWindow }),
          }),
        }
      : {}),
    ...(settings.fields.symptoms && log?.symptoms !== undefined
      ? { symptoms: Object.freeze([...log.symptoms]) }
      : {}),
    ...(settings.fields.mood && log?.mood !== undefined ? { mood: log.mood } : {}),
    ...(settings.fields.energy && log?.energy !== undefined ? { energy: log.energy } : {}),
    ...(settings.fields.condition && log?.condition !== undefined
      ? { condition: log.condition }
      : {}),
    ...(settings.fields.helpPreferences && log?.helpPreferences !== undefined
      ? { helpPreferences: Object.freeze([...log.helpPreferences]) }
      : {}),
    ...(settings.fields.note && log?.note !== undefined ? { note: log.note } : {}),
  });
}
