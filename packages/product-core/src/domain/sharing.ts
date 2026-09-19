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

/**
 * 가임 정보를 동의 없이 내보내지 않으면서, 그 사실이 **부재로 역추론되지도**
 * 않게 만든다.
 *
 * 값을 빼는 방식은 안전해 보이지만 그렇지 않다. 다른 날에는 국면이 보이고
 * 배란기에만 사라지면, 값이 없다는 사실 자체가 "지금이 배란기"라는 정보다.
 * 그래서 숨기는 대신 인접 국면으로 접어 필드가 항상 존재하게 한다.
 *
 * 배란기는 난포기와 황체기 사이에 있으므로 난포기로 흡수한다. 파트너는
 * 저해상도 국면을 보고, 날짜에 따라 필드 존재 여부가 달라지지 않는다.
 */
function lowResolutionPhase(phase: CyclePhase): CyclePhase {
  return phase === "ovulatory" ? "follicular" : phase;
}

function sharedCyclePhase(
  source: PartnerProjectionSource,
  settings: ShareSettings,
): CyclePhase | undefined {
  if (source.cyclePhase === undefined) return undefined;
  // 가임 동의가 있으면 그대로 보낸다.
  if (settings.fields.fertilityStatus) return source.cyclePhase;
  // 국면 동의만 있으면 가임 구간을 접어서 보낸다. 날짜와 무관하게 존재한다.
  if (settings.fields.cyclePhase) return lowResolutionPhase(source.cyclePhase);
  // 어느 동의도 없으면 날짜와 무관하게 부재한다.
  return undefined;
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
  const sharedPhase = sharedCyclePhase(source, settings);
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
    ...(sharedPhase !== undefined ? { cyclePhase: sharedPhase } : {}),
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
