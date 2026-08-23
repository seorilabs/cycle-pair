import { addDays, localDate } from '@cyclepair/product-core';
import { createInitialState, type DailyHistoryEntry } from './CyclePairStore';
import { buildCycleViewModel, formatKoreanDate } from './cycleViewModel';

describe('cycle view model roles', () => {
  it.each([
    ['힘들어요', 'very-low'],
    ['지쳐요', 'low'],
    ['괜찮아요', 'neutral'],
    ['좋아요', 'good'],
  ] as const)(
    'does not infer a condition from the mood %s',
    (mood, expectedMood) => {
      const initialState = createInitialState();
      const state = {
        ...initialState,
        shareSettings: {
          ...initialState.shareSettings,
          mood: true,
          condition: true,
        },
        checkIn: {
          mood,
          symptoms: [],
          periodStarted: false,
          periodEnded: false,
        },
      };

      const viewModel = buildCycleViewModel(state);

      expect(viewModel.selfProjection.mood).toBe(expectedMood);
      expect(viewModel.selfProjection.condition).toBeUndefined();
    },
  );

  it('keeps explicit symptom-based condition mapping when a condition is not selected', () => {
    const initialState = createInitialState();
    const state = {
      ...initialState,
      shareSettings: {
        ...initialState.shareSettings,
        condition: true,
      },
      checkIn: {
        mood: '힘들어요' as const,
        symptoms: ['피로'],
        periodStarted: false,
        periodEnded: false,
      },
    };

    expect(buildCycleViewModel(state).selfProjection.condition).toBe('tired');
  });

  it('keeps a partner mood-only projection conditionless and uses safe care fallback', () => {
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
        moodTag: 'very-low' as const,
      },
    };

    const viewModel = buildCycleViewModel(state);

    expect(viewModel.partnerProjection.mood).toBe('very-low');
    expect(viewModel.partnerProjection.condition).toBeUndefined();
    expect(viewModel.careTip.id).toBe('general-respect');
  });

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

  it('exposes a late prediction without shifting the original expected date', () => {
    const now = new Date();
    const today = localDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const lastPeriodStart = addDays(today, -40);
    const state = {
      ...createInitialState(),
      hasCycleSeed: true,
      seed: {
        lastPeriodStart,
        averageCycleLength: 28,
        averagePeriodLength: 5,
      },
    };

    const viewModel = buildCycleViewModel(state);

    expect(viewModel.predictedDate).toBe(addDays(lastPeriodStart, 28));
    expect(viewModel.daysUntilPrediction).toBe(-12);
    expect(viewModel.daysLate).toBe(12);
  });

  it('includes the year only when formatting a date from another year', () => {
    expect(formatKoreanDate(localDate(2026, 12, 31), localDate(2026, 1, 1))).toBe(
      '12월 31일',
    );
    expect(formatKoreanDate(localDate(2025, 12, 31), localDate(2026, 1, 1))).toBe(
      '2025년 12월 31일',
    );
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

  it('keeps period starts older than 365 days in the observed prediction history', () => {
    const today = new Date();
    const todayValue = localDate(
      today.getFullYear(),
      today.getMonth() + 1,
      today.getDate(),
    );
    const oldest = addDays(todayValue, -420);
    const middle = addDays(todayValue, -370);
    const latest = addDays(todayValue, -340);
    const state = {
      ...createInitialState(),
      hasCycleSeed: true,
      seed: {
        lastPeriodStart: latest,
        averageCycleLength: 28,
        averagePeriodLength: 5,
      },
      dailyHistory: [oldest, middle].map(localDateValue => ({
        localDate: localDateValue,
        checkIn: {
          symptoms: [],
          periodStarted: true,
          periodEnded: false,
        },
      })),
    };

    const viewModel = buildCycleViewModel(state);

    expect(viewModel.predictedDate).toBe(addDays(latest, 40));
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
