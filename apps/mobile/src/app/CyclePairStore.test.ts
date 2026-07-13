import {
  createInitialState,
  reduceCyclePairState,
} from './CyclePairStore';

describe('CyclePair pair privacy state', () => {
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
    expect(state.sensitiveDataConsentAcceptedAt).toBe('2026-07-12T00:00:00.000Z');
  });

  it('restores private setup into solo main without an active Pair', () => {
    const state = reduceCyclePairState(createInitialState(), {
      type: 'RESTORE_PRIVATE_SETUP',
      payload: {
        isLogger: true,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
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
      },
    });

    const recommended = reduceCyclePairState(state, { type: 'USE_RECOMMENDED_SHARING' });
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

  it('restores server sharing settings before local edits begin', () => {
    let state = createInitialState();
    state = reduceCyclePairState(state, { type: 'COMPLETE_ONBOARDING' });
    state = reduceCyclePairState(state, {
      type: 'COMPLETE_SETUP',
      payload: {
        isLogger: true,
        seed: state.seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
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
      },
    });

    expect(reduceCyclePairState(state, { type: 'CONTINUE_TO_SHARING' })).toBe(state);
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
    ]);
    expect(state.stage).toBe('sharing');
  });
});
