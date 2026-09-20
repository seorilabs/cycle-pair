import type {
  PairEvent,
  RemotePartnerProjection,
} from '../platform/backend/CyclePairBackend';
import {
  hasMeaningfulPartnerProjectionChange,
  hasPartnerPairEventUpdate,
} from './inAppNotifications';

const initialProjection: RemotePartnerProjection = {
  ownerUid: 'partner-a',
  pairId: 'pair-a',
  generatedAt: '2026-08-24T00:00:00.000Z',
  dailyLogDate: '2026-08-24',
  emotionTags: ['anxious'],
};

const ownEvent: PairEvent = {
  id: 'event-a',
  pairId: 'pair-a',
  title: '공동 일정',
  date: '2026-08-24',
  createdBy: 'self-a',
  updatedBy: 'self-a',
  mutationId: 'mutation-a',
};

describe('in-app partner notifications', () => {
  it('ignores projection materialization time but catches shared content changes', () => {
    expect(
      hasMeaningfulPartnerProjectionChange(initialProjection, {
        ...initialProjection,
        generatedAt: '2026-08-24T00:01:00.000Z',
      }),
    ).toBe(false);
    expect(
      hasMeaningfulPartnerProjectionChange(initialProjection, {
        ...initialProjection,
        emotionTags: ['calm'],
      }),
    ).toBe(true);
    // 배열이라 같은 값이면 알리지 않아야 한다.
    expect(
      hasMeaningfulPartnerProjectionChange(initialProjection, {
        ...initialProjection,
        emotionTags: ['anxious'],
      }),
    ).toBe(false);
    // 감정이 하나 늘어난 것도 변화다.
    expect(
      hasMeaningfulPartnerProjectionChange(initialProjection, {
        ...initialProjection,
        emotionTags: ['anxious', 'lonely'],
      }),
    ).toBe(true);
  });

  it('only treats a new partner-authored event mutation as an update', () => {
    expect(hasPartnerPairEventUpdate([], [ownEvent], 'partner-a')).toBe(false);
    expect(
      hasPartnerPairEventUpdate(
        [ownEvent],
        [
          {
            ...ownEvent,
            updatedBy: 'partner-a',
            mutationId: 'mutation-b',
          },
        ],
        'partner-a',
      ),
    ).toBe(true);
  });
});
