import {
  createInitialState,
  reduceMoonMateState,
} from './MoonMateStore';

describe('MoonMate pair privacy state', () => {
  it('does not skip onboarding when the backend reports no active pair', () => {
    const state = reduceMoonMateState(createInitialState(), {
      type: 'DISCONNECT_PAIR',
    });

    expect(state.stage).toBe('onboarding');
  });

  it('resets every sharing field when a different Pair becomes active', () => {
    let state = createInitialState();
    state = reduceMoonMateState(state, { type: 'COMPLETE_ONBOARDING' });
    state = reduceMoonMateState(state, {
      type: 'COMPLETE_SETUP',
      payload: {
        isLogger: true,
        seed: state.seed,
        consentAcceptedAt: '2026-07-12T00:00:00.000Z',
      },
    });
    state = reduceMoonMateState(state, {
      type: 'LINK_PARTNER',
      payload: { pairId: 'pair-one' },
    });
    state = reduceMoonMateState(state, { type: 'USE_RECOMMENDED_SHARING' });
    state = reduceMoonMateState(state, { type: 'COMPLETE_SHARING' });

    state = reduceMoonMateState(state, {
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
