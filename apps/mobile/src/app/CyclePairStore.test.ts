import {
  createCycle,
  parseLocalDate,
  predictNextPeriod,
} from '@cyclepair/product-core';
import { createInitialState, reduceCyclePairState } from './CyclePairStore';
import { SELF_MEMBER_ID } from './memberIds';
import { SENSITIVE_HEALTH_CONSENT_VERSION } from '../domain/privacy/SensitiveHealthConsent';

function localDateDaysAgo(count: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - count);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

describe('CyclePair pair privacy state', () => {
  it('updates the average cycle length from observed period starts', () => {
    const base = createInitialState();
    const state = {
      ...base,
      hasCycleSeed: true,
      seed: {
        ...base.seed,
        lastPeriodStart: localDateDaysAgo(30),
        averageCycleLength: 28,
      },
      dailyHistory: [
        {
          localDate: localDateDaysAgo(60),
          checkIn: {
            symptoms: [],
            periodStarted: true,
            periodEnded: false,
          },
        },
      ],
    };

    const updated = reduceCyclePairState(state, {
      type: 'SAVE_CHECK_IN',
      payload: {
        symptoms: [],
        periodStarted: true,
        periodEnded: false,
      },
    });

    expect(updated.seed.averageCycleLength).toBe(30);
    expect(updated.seed.lastPeriodStart).toBe(localDateDaysAgo(0));
  });

  it('저장되는 seed 평균과 홈 예측의 평균이 같은 값이다', () => {
    // 간격 13개 이력이다. 예전에는 저장 쪽이 전체 단순 평균, 예측 쪽이 최근
    // 12개 가중 평균이라 같은 기록으로 두 값이 갈렸다.
    const offsets = [400, 360, 320, 280, 240, 200, 160, 120, 100, 80, 60, 40, 20, 0];
    const starts = offsets.map(localDateDaysAgo);
    const base = createInitialState();
    const state = {
      ...base,
      hasCycleSeed: true,
      seed: {
        ...base.seed,
        lastPeriodStart: starts[0]!,
        averageCycleLength: 28,
      },
    };

    const restored = reduceCyclePairState(state, {
      type: 'RESTORE_DAILY_HISTORY',
      payload: starts.map(localDate => ({
        localDate,
        checkIn: { symptoms: [], periodStarted: true, periodEnded: false },
      })),
    });

    const cycles = [...starts]
      .sort()
      .map((start, index) =>
        createCycle({
          id: `cycle-${index}`,
          memberId: SELF_MEMBER_ID,
          startedOn: parseLocalDate(start),
        }),
      );
    const prediction = predictNextPeriod(
      cycles,
      parseLocalDate(localDateDaysAgo(0)),
    );

    expect(prediction).not.toBeNull();
    expect(restored.seed.averageCycleLength).toBe(
      prediction!.averageCycleLengthDays,
    );
  });

  it('rebuilds the current seed after queued daily logs are restored', () => {
    const base = createInitialState();
    const state = {
      ...base,
      hasCycleSeed: true,
      seed: {
        ...base.seed,
        lastPeriodStart: localDateDaysAgo(60),
        lastPeriodEnd: localDateDaysAgo(55),
      },
    };

    const restored = reduceCyclePairState(state, {
      type: 'RESTORE_DAILY_HISTORY',
      payload: [
        {
          localDate: localDateDaysAgo(25),
          checkIn: {
            symptoms: [],
            periodStarted: false,
            periodEnded: true,
          },
        },
        {
          localDate: localDateDaysAgo(30),
          checkIn: {
            symptoms: [],
            periodStarted: true,
            periodEnded: false,
          },
        },
      ],
    });

    expect(restored.seed).toMatchObject({
      lastPeriodStart: localDateDaysAgo(30),
      lastPeriodEnd: localDateDaysAgo(25),
      averageCycleLength: 30,
    });
  });

  it('clears a stale check-in when restored history has no entry for today', () => {
    const base = createInitialState();
    const restored = reduceCyclePairState(
      {
        ...base,
        checkIn: {
          mood: '좋아요',
          symptoms: ['두통'],
          periodStarted: false,
          periodEnded: false,
        },
      },
      {
        type: 'RESTORE_DAILY_HISTORY',
        payload: [
          {
            localDate: localDateDaysAgo(1),
            checkIn: {
              mood: '좋아요',
              symptoms: ['두통'],
              periodStarted: false,
              periodEnded: false,
            },
          },
        ],
      },
    );

    expect(restored.checkIn).toEqual({
      symptoms: [],
      periodStarted: false,
      periodEnded: false,
    });
  });

  it('refreshes the current check-in when the device date changes', () => {
    const base = createInitialState();
    const state = {
      ...base,
      checkIn: {
        mood: '좋아요' as const,
        symptoms: [],
        periodStarted: false,
        periodEnded: false,
      },
      dailyHistory: [
        {
          localDate: '2026-07-14',
          checkIn: {
            mood: '좋아요' as const,
            symptoms: [],
            periodStarted: false,
            periodEnded: false,
          },
        },
      ],
    };

    const nextDay = reduceCyclePairState(state, {
      type: 'REFRESH_TODAY',
      payload: '2026-07-15',
    });

    expect(nextDay.checkIn).toEqual({
      symptoms: [],
      periodStarted: false,
      periodEnded: false,
    });
  });

  it('updates recordsCycle and seed without returning to onboarding', () => {
    const base = {
      ...createInitialState(),
      stage: 'main' as const,
      sensitiveDataConsentAcceptedAt: '2026-07-12T00:00:00.000Z',
    };
    const seed = {
      lastPeriodStart: '2026-07-01',
      averageCycleLength: 31,
      averagePeriodLength: 6,
    };

    const updated = reduceCyclePairState(base, {
      type: 'UPDATE_PRIVATE_SETUP',
      payload: { isLogger: false, seed },
    });

    expect(updated.stage).toBe('main');
    expect(updated.isLogger).toBe(false);
    expect(updated.hasCycleSeed).toBe(false);
    expect(updated.seed).toEqual(seed);
    expect(updated.checkIn.periodStarted).toBe(false);
    expect(updated.checkIn.periodEnded).toBe(false);
  });

  it('does not create predictions from the draft defaults before explicit input', () => {
    const initial = createInitialState();
    expect(initial.hasCycleSeed).toBe(false);

    const completed = reduceCyclePairState(initial, {
      type: 'COMPLETE_SETUP',
      payload: {
        isLogger: true,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });
    const afterPeriodStart = reduceCyclePairState(completed, {
      type: 'SAVE_CHECK_IN',
      payload: {
        symptoms: [],
        periodStarted: true,
        periodEnded: false,
      },
    });

    expect(completed.hasCycleSeed).toBe(false);
    expect(afterPeriodStart.hasCycleSeed).toBe(false);
    expect(afterPeriodStart.seed).toEqual(initial.seed);
  });

  it('restores a prediction seed only when one exists in private setup', () => {
    const seed = {
      lastPeriodStart: '2026-07-01',
      averageCycleLength: 31,
      averagePeriodLength: 6,
    };
    const restored = reduceCyclePairState(createInitialState(), {
      type: 'RESTORE_PRIVATE_SETUP',
      payload: {
        isLogger: true,
        seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });

    expect(restored.hasCycleSeed).toBe(true);
    expect(restored.seed).toEqual(seed);
  });

  it('무버전 setup 데이터는 보존하되 재동의 전 setup 단계에 머문다', () => {
    const seed = {
      lastPeriodStart: '2026-07-01',
      averageCycleLength: 31,
      averagePeriodLength: 6,
    };
    const legacy = reduceCyclePairState(createInitialState(), {
      type: 'RESTORE_PRIVATE_SETUP',
      payload: {
        isLogger: true,
        seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
      },
    });

    expect(legacy.stage).toBe('setup');
    expect(legacy.seed).toEqual(seed);
    expect(legacy.sensitiveDataConsentAcceptedAt).toBeUndefined();
    expect(legacy.sensitiveDataConsentVersion).toBeUndefined();
  });

  it('keeps energy, condition, and note sharing disabled by default', () => {
    const { shareSettings } = createInitialState();

    expect(shareSettings.energy).toBe(false);
    expect(shareSettings.condition).toBe(false);
    expect(shareSettings.note).toBe(false);
  });

  it('does not skip onboarding when the backend reports no active pair', () => {
    const state = reduceCyclePairState(createInitialState(), {
      type: 'DISCONNECT_PAIR',
    });

    expect(state.stage).toBe('onboarding');
  });

  it('returns from basic setup to onboarding', () => {
    let state = reduceCyclePairState(createInitialState(), {
      type: 'COMPLETE_ONBOARDING',
    });

    state = reduceCyclePairState(state, { type: 'GO_BACK' });

    expect(state.stage).toBe('onboarding');
  });

  it('starts in solo main and can open then close optional pairing', () => {
    let state = createInitialState();
    const seed = {
      lastPeriodStart: '2026-07-01',
      averageCycleLength: 31,
      averagePeriodLength: 6,
    };
    state = reduceCyclePairState(state, { type: 'COMPLETE_ONBOARDING' });
    state = reduceCyclePairState(state, {
      type: 'COMPLETE_SETUP',
      payload: {
        isLogger: false,
        seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });

    expect(state.stage).toBe('main');
    expect(state.paired).toBe(false);

    state = reduceCyclePairState(state, { type: 'OPEN_PAIRING' });
    expect(state.stage).toBe('invite');

    state = reduceCyclePairState(state, { type: 'GO_BACK' });

    expect(state.stage).toBe('main');
    expect(state.activeTab).toBe('partner');
    expect(state.isLogger).toBe(false);
    expect(state.seed).toEqual(seed);
    expect(state.sensitiveDataConsentAcceptedAt).toBe(
      '2026-07-12T00:00:00.000Z',
    );
  });

  it('restores private setup into solo main without an active Pair', () => {
    const state = reduceCyclePairState(createInitialState(), {
      type: 'RESTORE_PRIVATE_SETUP',
      payload: {
        isLogger: true,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });

    expect(state.stage).toBe('main');
    expect(state.paired).toBe(false);
    expect(state.activeTab).toBe('home');
  });

  it('returns to solo partner tab after Pair disconnection', () => {
    let state = createInitialState();
    state = reduceCyclePairState(state, { type: 'COMPLETE_ONBOARDING' });
    state = reduceCyclePairState(state, {
      type: 'COMPLETE_SETUP',
      payload: {
        isLogger: true,
        seed: state.seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });
    state = reduceCyclePairState(state, {
      type: 'LINK_PARTNER',
      payload: { pairId: 'pair-one' },
    });

    state = reduceCyclePairState(state, { type: 'DISCONNECT_PAIR' });

    expect(state.stage).toBe('main');
    expect(state.activeTab).toBe('partner');
    expect(state.paired).toBe(false);
    expect(state.sharingPairId).toBeUndefined();
  });

  it('does not mutate sharing choices without an active Pair', () => {
    let state = createInitialState();
    state = reduceCyclePairState(state, { type: 'COMPLETE_ONBOARDING' });
    state = reduceCyclePairState(state, {
      type: 'COMPLETE_SETUP',
      payload: {
        isLogger: true,
        seed: state.seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });

    const recommended = reduceCyclePairState(state, {
      type: 'USE_RECOMMENDED_SHARING',
    });
    const toggled = reduceCyclePairState(state, {
      type: 'SET_SHARE_SETTINGS',
      payload: { ...state.shareSettings, mood: true },
    });

    expect(recommended).toBe(state);
    expect(toggled).toBe(state);
  });

  it('returns from sharing to a connected invite without changing the Pair or settings', () => {
    let state = createInitialState();
    state = reduceCyclePairState(state, { type: 'COMPLETE_ONBOARDING' });
    state = reduceCyclePairState(state, {
      type: 'COMPLETE_SETUP',
      payload: {
        isLogger: true,
        seed: state.seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });
    state = reduceCyclePairState(state, {
      type: 'LINK_PARTNER',
      payload: { pairId: 'pair-one' },
    });
    state = reduceCyclePairState(state, { type: 'USE_RECOMMENDED_SHARING' });
    const settingsBeforeBack = state.shareSettings;

    state = reduceCyclePairState(state, { type: 'GO_BACK' });
    state = reduceCyclePairState(state, {
      type: 'LINK_PARTNER',
      payload: { pairId: 'pair-one' },
    });
    state = reduceCyclePairState(state, {
      type: 'RESTORE_SHARE_SETTINGS',
      payload: { pairId: 'pair-one', settings: null },
    });

    expect(state.stage).toBe('invite');
    expect(state.paired).toBe(true);
    expect(state.sharingPairId).toBe('pair-one');
    expect(state.shareSettings).toEqual(settingsBeforeBack);

    state = reduceCyclePairState(state, { type: 'CONTINUE_TO_SHARING' });
    expect(state.stage).toBe('sharing');
  });

  it('keeps dirty sharing choices regardless of watcher and back ordering', () => {
    let state = createInitialState();
    state = reduceCyclePairState(state, { type: 'COMPLETE_ONBOARDING' });
    state = reduceCyclePairState(state, {
      type: 'COMPLETE_SETUP',
      payload: {
        isLogger: true,
        seed: state.seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });
    state = reduceCyclePairState(state, {
      type: 'LINK_PARTNER',
      payload: { pairId: 'pair-one' },
    });
    state = reduceCyclePairState(state, { type: 'USE_RECOMMENDED_SHARING' });
    const settingsBeforeSnapshot = state.shareSettings;

    state = reduceCyclePairState(state, {
      type: 'RESTORE_SHARE_SETTINGS',
      payload: { pairId: 'pair-one', settings: null },
    });

    expect(state.stage).toBe('sharing');
    expect(state.shareSettings).toEqual(settingsBeforeSnapshot);
    expect(state.shareSettingsDirty).toBe(true);

    state = reduceCyclePairState(state, { type: 'GO_BACK' });
    expect(state.stage).toBe('invite');
    expect(state.shareSettings).toEqual(settingsBeforeSnapshot);
  });

  it('keeps queued sharing choices authoritative until the offline flush succeeds', () => {
    let state = createInitialState();
    state = reduceCyclePairState(state, {
      type: 'RESTORE_PRIVATE_SETUP',
      payload: {
        isLogger: true,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });
    state = reduceCyclePairState(state, {
      type: 'LINK_PARTNER',
      payload: { pairId: 'pair-one' },
    });
    state = reduceCyclePairState(state, { type: 'USE_RECOMMENDED_SHARING' });
    const queuedSettings = state.shareSettings;
    state = reduceCyclePairState(state, {
      type: 'COMPLETE_SHARING',
      queued: true,
    });

    expect(state.shareSettingsDirty).toBe(true);
    const staleSnapshot = reduceCyclePairState(state, {
      type: 'RESTORE_SHARE_SETTINGS',
      payload: {
        pairId: 'pair-one',
        settings: {
          cyclePhase: false,
          cycleStatus: false,
          fertilityStatus: false,
          predictedPeriod: false,
          periodDates: false,
          mood: false,
          symptoms: false,
          energy: false,
          condition: false,
          carePreference: false,
          note: false,
        },
      },
    });

    expect(staleSnapshot.shareSettings).toEqual(queuedSettings);
    expect(staleSnapshot.shareSettingsDirty).toBe(true);

    const flushed = reduceCyclePairState(staleSnapshot, {
      type: 'SET_SHARE_SETTINGS',
      payload: queuedSettings,
      dirty: false,
    });
    expect(flushed.shareSettingsDirty).toBe(false);
  });

  it('restores server sharing settings before local edits begin', () => {
    let state = createInitialState();
    state = reduceCyclePairState(state, { type: 'COMPLETE_ONBOARDING' });
    state = reduceCyclePairState(state, {
      type: 'COMPLETE_SETUP',
      payload: {
        isLogger: true,
        seed: state.seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });
    state = reduceCyclePairState(state, {
      type: 'LINK_PARTNER',
      payload: { pairId: 'pair-one' },
    });
    const serverSettings = {
      ...state.shareSettings,
      cyclePhase: true,
      carePreference: true,
    };

    state = reduceCyclePairState(state, {
      type: 'RESTORE_SHARE_SETTINGS',
      payload: { pairId: 'pair-one', settings: serverSettings },
    });

    expect(state.stage).toBe('main');
    expect(state.shareSettings).toEqual(serverSettings);
    expect(state.shareSettingsDirty).toBe(false);
  });

  it('does not jump to main when sharing finishes after the user went back', () => {
    let state = createInitialState();
    state = reduceCyclePairState(state, { type: 'COMPLETE_ONBOARDING' });
    state = reduceCyclePairState(state, {
      type: 'COMPLETE_SETUP',
      payload: {
        isLogger: true,
        seed: state.seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });
    state = reduceCyclePairState(state, {
      type: 'LINK_PARTNER',
      payload: { pairId: 'pair-one' },
    });
    state = reduceCyclePairState(state, { type: 'GO_BACK' });

    state = reduceCyclePairState(state, { type: 'COMPLETE_SHARING' });

    expect(state.stage).toBe('invite');
    expect(state.sharingCompleted).toBe(false);
  });

  it('does not continue to sharing without an active Pair', () => {
    let state = createInitialState();
    state = reduceCyclePairState(state, { type: 'COMPLETE_ONBOARDING' });
    state = reduceCyclePairState(state, {
      type: 'COMPLETE_SETUP',
      payload: {
        isLogger: true,
        seed: state.seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });

    expect(reduceCyclePairState(state, { type: 'CONTINUE_TO_SHARING' })).toBe(
      state,
    );
  });

  it('resets every sharing field when a different Pair becomes active', () => {
    let state = createInitialState();
    state = reduceCyclePairState(state, { type: 'COMPLETE_ONBOARDING' });
    state = reduceCyclePairState(state, {
      type: 'COMPLETE_SETUP',
      payload: {
        isLogger: true,
        seed: state.seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });
    state = reduceCyclePairState(state, {
      type: 'LINK_PARTNER',
      payload: { pairId: 'pair-one' },
    });
    state = reduceCyclePairState(state, { type: 'USE_RECOMMENDED_SHARING' });
    state = reduceCyclePairState(state, { type: 'COMPLETE_SHARING' });

    state = reduceCyclePairState(state, {
      type: 'LINK_PARTNER',
      payload: { pairId: 'pair-two' },
    });

    expect(state.sharingPairId).toBe('pair-two');
    expect(state.sharingCompleted).toBe(false);
    expect(Object.values(state.shareSettings)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(state.stage).toBe('sharing');
  });
});
