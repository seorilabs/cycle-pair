import { createInitialState } from './CyclePairStore';
import { buildCycleViewModel } from './cycleViewModel';

describe('cycle view model roles', () => {
  it('does not derive a synthetic cycle for a partner-only user', () => {
    const state = { ...createInitialState(), isLogger: false };
    const viewModel = buildCycleViewModel(state);

    expect(viewModel.phase).toBe('unknown');
    expect(viewModel.cycleDay).toBeNull();
    expect(viewModel.predictedDate).toBeUndefined();
    expect(viewModel.predictionStart).toBeUndefined();
    expect(viewModel.predictionEnd).toBeUndefined();
    expect(viewModel.selfProjection.cyclePhase).toBeUndefined();
    expect(viewModel.selfProjection.periodDates).toBeUndefined();
    expect(viewModel.selfProjection.prediction).toBeUndefined();
  });
});
