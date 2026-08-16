import type {
  PairEvent,
  RemotePartnerProjection,
} from '../platform/backend/CyclePairBackend';

export type InAppNoticeKind = 'partner-record' | 'shared-event';

export interface InAppNotice {
  readonly id: string;
  readonly kind: InAppNoticeKind;
  readonly destination: 'home' | 'calendar' | 'partner' | 'settings';
  readonly message: string;
}

const projectionContentFields = [
  'cycleAsOfDate',
  'dailyLogDate',
  'periodDates',
  'cyclePhase',
  'cycleStatus',
  'nextPeriodWindow',
  'symptomTags',
  'moodTag',
  'energyLevel',
  'conditionCode',
  'carePreferences',
  'note',
] as const;

function projectionContent(
  value: RemotePartnerProjection | null,
): Record<string, unknown> {
  if (!value) return {};
  return Object.fromEntries(
    projectionContentFields.flatMap(field =>
      value[field] === undefined ? [] : [[field, value[field]]],
    ),
  );
}

export function hasMeaningfulPartnerProjectionChange(
  before: RemotePartnerProjection | null,
  after: RemotePartnerProjection | null,
): boolean {
  return (
    JSON.stringify(projectionContent(before)) !==
    JSON.stringify(projectionContent(after))
  );
}

export function hasPartnerPairEventUpdate(
  before: readonly PairEvent[],
  after: readonly PairEvent[],
  partnerUid: string,
): boolean {
  const previousMutations = new Map(
    before.map(event => [event.id, event.mutationId]),
  );
  return after.some(
    event =>
      event.updatedBy === partnerUid &&
      previousMutations.get(event.id) !== event.mutationId,
  );
}

export function noticeCopy(
  kind: InAppNoticeKind,
): Pick<InAppNotice, 'destination' | 'message'> {
  return kind === 'partner-record'
    ? {
        destination: 'partner',
        message: '파트너가 새 기록을 공유했어요.',
      }
    : {
        destination: 'calendar',
        message: '파트너가 공동 일정을 업데이트했어요.',
      };
}
