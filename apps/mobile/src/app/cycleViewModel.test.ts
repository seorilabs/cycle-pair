import { addDays, localDate } from '@cyclepair/product-core';
import { createInitialState, type DailyHistoryEntry } from './CyclePairStore';
import { buildCycleViewModel, formatKoreanDate } from './cycleViewModel';
import { resolveCycleFeaturePolicy } from './subscription/cycleFeaturePolicy';

const freeFeaturePolicy = resolveCycleFeaturePolicy(() => false);
const premiumFeaturePolicy = resolveCycleFeaturePolicy(() => true);

describe('cycle view model roles', () => {
  it.each([
    ['anxious'],
    ['drained'],
    ['calm'],
    ['happy'],
  ] as const)(
    'does not infer a body condition from the emotion %s',
    emotion => {
      const initialState = createInitialState();
      const state = {
        ...initialState,
        shareSettings: {
          ...initialState.shareSettings,
          emotions: true,
          condition: true,
        },
        checkIn: {
          emotions: [emotion],
          symptoms: [],
          periodStarted: false,
          periodEnded: false,
        },
      };

      const viewModel = buildCycleViewModel(state);

      expect(viewModel.selfProjection.emotions).toEqual([emotion]);
      expect(viewModel.selfProjection.condition).toBeUndefined();
    },
  );

  it('maps a body symptom to a body condition when none is selected', () => {
    const initialState = createInitialState();
    const state = {
      ...initialState,
      shareSettings: {
        ...initialState.shareSettings,
        condition: true,
      },
      checkIn: {
        emotions: ['anxious'] as const,
        symptoms: ['복통'],
        periodStarted: false,
        periodEnded: false,
      },
    };

    expect(buildCycleViewModel(state).selfProjection.condition).toBe('cramps');
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
        emotionTags: ['anxious'] as const,
      },
    };

    const viewModel = buildCycleViewModel(state);

    expect(viewModel.partnerProjection.emotions).toEqual(['anxious']);
    expect(viewModel.partnerProjection.condition).toBeUndefined();
    expect(viewModel.careTips[0]?.id).toBe('general-respect');
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

    const freeViewModel = buildCycleViewModel(state, freeFeaturePolicy);
    const premiumViewModel = buildCycleViewModel(state, premiumFeaturePolicy);

    // 무료는 365일 창 안에 시작일이 하나뿐이라 간격이 없고 seed 값 28을 쓴다.
    expect(freeViewModel.predictedDate).toBe(addDays(latest, 28));
    // 프리미엄은 창 밖 시작일까지 보므로 간격 [50, 30]이 생긴다. 최근 가중
    // 평균이라 (50*1 + 30*2) / 3 = 36.67 -> 37 이다.
    expect(premiumViewModel.predictedDate).toBe(addDays(latest, 37));
  });

  it('shows one care tip for free and multiple matching tips for premium', () => {
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
        carePreferences: ['listen', 'quiet-space'],
      },
    };

    expect(
      buildCycleViewModel(state, freeFeaturePolicy).careTips.map(tip => tip.id),
    ).toEqual(['preference-listen']);
    expect(
      buildCycleViewModel(state, premiumFeaturePolicy).careTips.map(
        tip => tip.id,
      ),
    ).toEqual(['preference-listen', 'preference-space']);
  });

  it('keeps advanced prediction evidence locked for free users', () => {
    const today = new Date();
    const todayValue = localDate(
      today.getFullYear(),
      today.getMonth() + 1,
      today.getDate(),
    );
    const latest = addDays(todayValue, -29);
    const state = {
      ...createInitialState(),
      hasCycleSeed: true,
      seed: {
        lastPeriodStart: latest,
        averageCycleLength: 28,
        averagePeriodLength: 5,
      },
      dailyHistory: [-90, -60, -29].map(offset => ({
        localDate: addDays(todayValue, offset),
        checkIn: {
          symptoms: [],
          periodStarted: true,
          periodEnded: false,
        },
      })),
    };

    expect(
      buildCycleViewModel(state, freeFeaturePolicy).advancedPrediction,
    ).toBeUndefined();
    expect(
      buildCycleViewModel(state, premiumFeaturePolicy).advancedPrediction,
    ).toEqual(
      expect.objectContaining({
        averageCycleLengthDays: 31,
        sampleSize: 2,
        observedCycleLengths: [30, 31],
      }),
    );
  });

  it('maps explicit energy, condition, and note into the private domain log', () => {
    const state = {
      ...createInitialState(),
      checkIn: {
        emotions: ['anxious'] as const,
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
    expect(viewModel.careTips[0]?.id).toBe('general-respect');
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
