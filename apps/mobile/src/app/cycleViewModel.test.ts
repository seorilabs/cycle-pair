import { addDays, localDate } from '@cyclepair/product-core';
import { createInitialState, type DailyHistoryEntry } from './CyclePairStore';
import { buildCycleViewModel } from './cycleViewModel';

describe('cycle view model roles', () => {
  it('does not predict for a logger until a complete seed is explicitly saved', () => {
    const state = createInitialState();
    const viewModel = buildCycleViewModel(state);

    expect(state.isLogger).toBe(true);
    expect(state.hasCycleSeed).toBe(false);
    expect(viewModel.phase).toBe('unknown');
    expect(viewModel.predictedDate).toBeUndefined();
    expect(viewModel.selfProjection.cyclePhase).toBeUndefined();
    expect(viewModel.selfProjection.periodDates).toBeUndefined();
    expect(viewModel.selfProjection.prediction).toBeUndefined();
  });

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

  it('uses valid recorded period starts instead of keeping seed-only prediction forever', () => {
    const today = new Date();
    const todayValue = localDate(
      today.getFullYear(),
      today.getMonth() + 1,
      today.getDate(),
    );
    const first = addDays(todayValue, -90);
    const second = addDays(todayValue, -60);
    const latest = addDays(todayValue, -29);
    const history: DailyHistoryEntry[] = [first, second, latest].map(
      localDateValue => ({
        localDate: localDateValue,
        checkIn: {
          symptoms: [],
          periodStarted: true,
          periodEnded: false,
        },
      }),
    );
    const state = {
      ...createInitialState(),
      hasCycleSeed: true,
      seed: {
        lastPeriodStart: latest,
        averageCycleLength: 28,
        averagePeriodLength: 5,
      },
      shareSettings: {
        ...createInitialState().shareSettings,
        predictedPeriod: true,
      },
      dailyHistory: history,
    };

    const viewModel = buildCycleViewModel(state);

    expect(viewModel.predictedDate).toBe(addDays(latest, 31));
    expect(viewModel.selfProjection.prediction?.confidence).toBe('low');
  });

  it('maps explicit energy, condition, and note into the private domain log', () => {
    const state = {
      ...createInitialState(),
      checkIn: {
        mood: '괜찮아요' as const,
        symptoms: [],
        energy: 2 as const,
        condition: '공간이 필요해요' as const,
        carePreference: '쉬고 싶어요' as const,
        note: '나만의 메모',
        periodStarted: false,
        periodEnded: false,
      },
    };

    const viewModel = buildCycleViewModel(state);

    expect(viewModel.selfProjection.condition).toBeUndefined();
    expect(viewModel.selfProjection.energy).toBeUndefined();
    expect(viewModel.selfProjection.note).toBeUndefined();
  });

  it('uses an explicitly shared condition instead of inferring one from symptoms', () => {
    const now = new Date();
    const dailyLogDate = localDate(
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate(),
    );
    const state = {
      ...createInitialState(),
      partnerProjection: {
        ownerUid: 'partner',
        pairId: 'pair-1',
        dailyLogDate,
        conditionCode: 'needs-space' as const,
        symptomTags: ['headache'],
      },
    };

    expect(buildCycleViewModel(state).partnerProjection.condition).toBe(
      'needs-space',
    );
  });

  it('does not use an old daily state for today care guidance', () => {
    const state = {
      ...createInitialState(),
      partnerProjection: {
        ownerUid: 'partner',
        pairId: 'pair-1',
        generatedAt: new Date().toISOString(),
        dailyLogDate: '2026-01-01',
        conditionCode: 'needs-space' as const,
        carePreferences: ['quiet-space'],
      },
    };

    const viewModel = buildCycleViewModel(state);

    expect(viewModel.partnerProjection.condition).toBeUndefined();
    expect(viewModel.partnerProjection.helpPreferences).toBeUndefined();
    expect(viewModel.careTip.id).toBe('general-respect');
  });

  it('실재하지 않는 파트너 생리 날짜는 화면 모델에서 안전하게 제외한다', () => {
    const state = {
      ...createInitialState(),
      partnerProjection: {
        ownerUid: 'partner',
        pairId: 'pair-1',
        periodDates: {
          startDate: '2026-02-30',
          endDate: '2026-03-04',
        },
      },
    };

    expect(
      buildCycleViewModel(state).partnerProjection.periodDates,
    ).toBeUndefined();
  });
});
