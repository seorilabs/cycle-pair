import type { CyclePairState } from './CyclePairStore';
import type { RemotePartnerProjection } from '../platform/backend/CyclePairBackend';
import {
  toPrivateCycleRecord,
  toPrivateDailyLogRecord,
} from '../platform/backend/backendPayloads';
/** Preview uses the same persisted codes and explicit consent boundaries as the server. */
export function sharingPreview(state: CyclePairState): RemotePartnerProjection {
  const shares = state.shareSettings;
  const cycle =
    state.isLogger && state.hasCycleSeed
      ? toPrivateCycleRecord(state.seed, state.currentLocalDate)
      : undefined;
  const hasDailyRecord = state.dailyHistory.some(
    entry => entry.localDate === state.currentLocalDate,
  );
  const daily = hasDailyRecord ? toPrivateDailyLogRecord(state.checkIn) : {};
  const projection: Record<string, unknown> = {
    ownerUid: 'preview',
    pairId: 'preview',
  };
  for (const [setting, field] of [
    ['emotions', 'emotionTags'],
    ['symptoms', 'symptomTags'],
    ['energy', 'energyLevel'],
    ['condition', 'conditionCode'],
    ['carePreference', 'carePreferences'],
    ['note', 'note'],
  ] as const) {
    if (shares[setting] && daily[field] !== undefined)
      projection[field] = daily[field];
  }
  if (cycle) {
    if (shares.periodDates) projection.periodDates = cycle.periodDates;
    if (shares.predictedPeriod && cycle.nextPeriodWindow)
      projection.nextPeriodWindow = cycle.nextPeriodWindow;
    if (
      shares.cyclePhase ||
      (shares.fertilityStatus && cycle.cyclePhase === 'ovulatory')
    )
      projection.cyclePhase =
        !shares.fertilityStatus && cycle.cyclePhase === 'ovulatory'
          ? 'follicular'
          : cycle.cyclePhase;
    if (
      shares.cycleStatus ||
      (shares.fertilityStatus && cycle.cycleStatus === 'fertile-window')
    )
      projection.cycleStatus =
        !shares.fertilityStatus && cycle.cycleStatus === 'fertile-window'
          ? 'cycle-in-progress'
          : cycle.cycleStatus;
  }
  if (
    cycle &&
    ['periodDates', 'cyclePhase', 'cycleStatus', 'nextPeriodWindow'].some(
      key => projection[key] !== undefined,
    )
  ) {
    projection.cycleAsOfDate = state.currentLocalDate;
  }
  if (
    hasDailyRecord &&
    [
      'emotionTags',
      'symptomTags',
      'energyLevel',
      'conditionCode',
      'carePreferences',
      'note',
    ].some(key => projection[key] !== undefined)
  ) {
    projection.dailyLogDate = state.currentLocalDate;
  }
  return projection as unknown as RemotePartnerProjection;
}
