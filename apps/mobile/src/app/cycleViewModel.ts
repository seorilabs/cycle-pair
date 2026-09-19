import {
  addDays,
  createCycle,
  createCycleLog,
  createShareSettings,
  determineCyclePhase,
  daysBetween,
  isLocalDate,
  localDate,
  parseLocalDate,
  predictFromCycleSeed,
  predictNextPeriod,
  projectForPartner,
  selectCareTips,
  type CareTip,
  type ConditionCode,
  type CyclePhase,
  type HelpPreference,
  type LocalDate,
  type Mood,
  type PartnerProjection,
  type Prediction,
} from '@cyclepair/product-core';
import { DailyCheckIn, CyclePairState } from './CyclePairStore';
import { PARTNER_MEMBER_ID, SELF_MEMBER_ID } from './memberIds';
import { getSafePartnerProjectionForToday } from './partnerProjectionPresentation';
import type {CycleFeaturePolicy} from './subscription/cycleFeaturePolicy';
import {
  FREE_CARE_TIP_LIMIT,
  FREE_HISTORY_LOOKBACK_DAYS,
} from './subscription/cycleFeaturePolicy';

const moodToDomain: Record<NonNullable<DailyCheckIn['mood']>, Mood> = {
  힘들어요: 'very-low',
  지쳐요: 'low',
  괜찮아요: 'neutral',
  좋아요: 'good',
};

const preferenceToDomain: Record<
  NonNullable<DailyCheckIn['carePreference']>,
  HelpPreference
> = {
  '쉬고 싶어요': 'quiet-space',
  '따뜻하게 챙겨줘요': 'warmth',
  '그냥 들어줘요': 'listen',
  '평소처럼 대해줘요': 'no-action',
};

const phaseCopy: Record<CyclePhase, { title: string; description: string }> = {
  menstrual: {
    title: '월경 중',
    description: '오늘의 몸 상태를 가장 먼저 살펴주세요',
  },
  follicular: {
    title: '회복하는 시기',
    description: '컨디션은 사람마다 다르게 변할 수 있어요',
  },
  ovulatory: {
    title: '회복하는 시기',
    description: '컨디션은 사람마다 다르게 변할 수 있어요',
  },
  luteal: {
    title: '변화에 대비하는 시기',
    description: '예측보다 오늘 직접 남긴 상태가 우선이에요',
  },
  unknown: {
    title: '기록이 더 필요해요',
    description: '주기가 쌓이면 참고 범위를 계산해 드려요',
  },
};

export interface CycleViewModel {
  today: LocalDate;
  phase: CyclePhase;
  phaseTitle: string;
  phaseDescription: string;
  cycleDay: number | null;
  predictedDate?: LocalDate;
  predictionStart?: LocalDate;
  predictionEnd?: LocalDate;
  daysUntilPrediction?: number;
  daysLate?: number;
  selfProjection: PartnerProjection;
  partnerProjection: PartnerProjection;
  careTips: readonly CareTip[];
  advancedPrediction?: {
    readonly averageCycleLengthDays: number;
    readonly confidence: Prediction['confidence'];
    readonly sampleSize: number;
    readonly observedCycleLengths: readonly number[];
    readonly standardDeviationDays: number | null;
    readonly excludedIntervalCount: number;
  };
}

const FREE_CYCLE_FEATURE_POLICY: CycleFeaturePolicy = Object.freeze({
  extendedHistoryEnabled: false,
  advancedPredictionEnabled: false,
  fullCareTipsEnabled: false,
  historyLookbackDays: FREE_HISTORY_LOOKBACK_DAYS,
  careTipLimit: FREE_CARE_TIP_LIMIT,
});

export function todayLocalDate(): LocalDate {
  const date = new Date();
  return localDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function observedCycles(
  state: CyclePairState,
  today: LocalDate,
  historyLookbackDays: number,
) {
  const historyCutoff = addDays(today, -historyLookbackDays);
  const starts = new Set<string>([state.seed.lastPeriodStart]);
  for (const entry of state.dailyHistory) {
    if (entry.checkIn.periodStarted && entry.localDate >= historyCutoff) {
      starts.add(entry.localDate);
    }
  }
  return [...starts].sort().map((start, index) =>
    createCycle({
      id: `cycle-${index}-${start}`,
      memberId: SELF_MEMBER_ID,
      startedOn: parseLocalDate(start),
    }),
  );
}

function predictionForState(
  state: CyclePairState,
  today: LocalDate,
  historyLookbackDays: number,
): Prediction {
  const cycles = observedCycles(state, today, historyLookbackDays);
  const observed = predictNextPeriod(cycles, today);
  if (observed) return observed;
  const lastStart =
    cycles.at(-1)?.startedOn ?? parseLocalDate(state.seed.lastPeriodStart);
  return predictFromCycleSeed({
    memberId: SELF_MEMBER_ID,
    generatedOn: today,
    lastPeriodStart: lastStart,
    averageCycleLengthDays: state.seed.averageCycleLength,
  });
}

function buildCurrentCycle(state: CyclePairState, lastStart: LocalDate) {
  return createCycle({
    id: 'current-cycle',
    memberId: SELF_MEMBER_ID,
    startedOn: lastStart,
    ...(state.seed.lastPeriodStart === lastStart && state.seed.lastPeriodEnd
      ? { endedOn: parseLocalDate(state.seed.lastPeriodEnd) }
      : {}),
  });
}

const conditionToDomain: Record<
  NonNullable<DailyCheckIn['condition']>,
  ConditionCode
> = {
  편안해요: 'comfortable',
  피곤해요: 'tired',
  '기운이 없어요': 'low-energy',
  '공간이 필요해요': 'needs-space',
};

function mapCondition(checkIn: DailyCheckIn): ConditionCode | undefined {
  if (checkIn.condition) return conditionToDomain[checkIn.condition];
  if (checkIn.symptoms.includes('피로')) return 'tired';
  if (checkIn.symptoms.includes('예민함')) return 'sensitive';
  if (checkIn.symptoms.includes('복통')) return 'cramps';
  if (checkIn.symptoms.includes('두통')) return 'headache';
  return undefined;
}

function conditionFromSymptoms(
  symptoms: readonly string[],
): ConditionCode | undefined {
  if (symptoms.includes('cramps')) return 'cramps';
  if (symptoms.includes('headache')) return 'headache';
  if (symptoms.includes('fatigue')) return 'tired';
  if (symptoms.includes('sensitive')) return 'sensitive';
  return undefined;
}

function mapHelpPreferences(
  checkIn: DailyCheckIn,
): HelpPreference[] | undefined {
  return checkIn.carePreference
    ? [preferenceToDomain[checkIn.carePreference]]
    : undefined;
}

function standardDeviation(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

export function buildCycleViewModel(
  state: CyclePairState,
  featurePolicy: CycleFeaturePolicy = FREE_CYCLE_FEATURE_POLICY,
): CycleViewModel {
  const today = todayLocalDate();
  const hasPredictionBasis = state.isLogger && state.hasCycleSeed;
  const prediction = hasPredictionBasis
    ? predictionForState(state, today, featurePolicy.historyLookbackDays)
    : undefined;
  const currentCycle = prediction
    ? buildCurrentCycle(state, prediction.lastPeriodStart)
    : undefined;
  const effectiveCycleLength =
    prediction?.averageCycleLengthDays ?? state.seed.averageCycleLength;
  const phaseResult = hasPredictionBasis
    ? determineCyclePhase({
        on: today,
        lastPeriodStart:
          prediction?.lastPeriodStart ??
          parseLocalDate(state.seed.lastPeriodStart),
        averageCycleLengthDays: effectiveCycleLength,
        periodLengthDays: state.seed.averagePeriodLength,
      })
    : { phase: 'unknown' as const, cycleDay: null };
  const phase: CyclePhase = phaseResult.phase;
  const mappedCondition = mapCondition(state.checkIn);

  const latestLog = createCycleLog({
    id: `check-in-${today}`,
    memberId: SELF_MEMBER_ID,
    date: today,
    ...(state.checkIn.mood ? { mood: moodToDomain[state.checkIn.mood] } : {}),
    ...(state.checkIn.symptoms.length > 0
      ? { symptoms: state.checkIn.symptoms }
      : {}),
    ...(state.checkIn.energy ? { energy: state.checkIn.energy } : {}),
    ...(mappedCondition ? { condition: mappedCondition } : {}),
    ...(mapHelpPreferences(state.checkIn)
      ? { helpPreferences: mapHelpPreferences(state.checkIn) }
      : {}),
    ...(state.checkIn.note ? { note: state.checkIn.note } : {}),
  });

  const selfSettings = createShareSettings(SELF_MEMBER_ID, today, {
    cyclePhase: state.shareSettings.cyclePhase,
    fertilityStatus: state.shareSettings.fertilityStatus,
    periodDates: state.shareSettings.periodDates,
    prediction: state.shareSettings.predictedPeriod,
    mood: state.shareSettings.mood,
    symptoms: state.shareSettings.symptoms,
    energy: state.shareSettings.energy,
    condition: state.shareSettings.condition,
    helpPreferences: state.shareSettings.carePreference,
    note: state.shareSettings.note,
  });
  const selfProjection = projectForPartner(
    {
      subjectMemberId: SELF_MEMBER_ID,
      asOf: today,
      ...(hasPredictionBasis ? { cyclePhase: phase } : {}),
      ...(currentCycle ? { currentCycle } : {}),
      ...(prediction ? { prediction } : {}),
      latestLog,
    },
    selfSettings,
  );

  const remote = getSafePartnerProjectionForToday(state.partnerProjection);
  const remoteMood =
    remote?.moodTag === 'very-low' ||
    remote?.moodTag === 'low' ||
    remote?.moodTag === 'neutral' ||
    remote?.moodTag === 'good' ||
    remote?.moodTag === 'very-good'
      ? remote.moodTag
      : undefined;
  const remotePreferences = (remote?.carePreferences ?? []).filter(
    (value): value is HelpPreference =>
      value === 'listen' ||
      value === 'quiet-space' ||
      value === 'warmth' ||
      value === 'meal-support' ||
      value === 'schedule-flexibility' ||
      value === 'practical-help' ||
      value === 'check-in' ||
      value === 'no-action',
  );
  const remoteSymptoms = remote?.symptomTags ?? [];
  const remoteCondition: ConditionCode | undefined =
    remote?.conditionCode ?? conditionFromSymptoms(remoteSymptoms);
  const remotePeriodStart = isLocalDate(remote?.periodDates?.startDate)
    ? remote.periodDates.startDate
    : undefined;
  const remotePeriodEnd =
    remotePeriodStart &&
    isLocalDate(remote?.periodDates?.endDate) &&
    remote.periodDates.endDate >= remotePeriodStart
      ? remote.periodDates.endDate
      : undefined;
  let partnerAsOf = today;
  const sourceLocalDate = remote?.dailyLogDate ?? remote?.cycleAsOfDate;
  if (sourceLocalDate) {
    try {
      partnerAsOf = parseLocalDate(sourceLocalDate);
    } catch {
      partnerAsOf = today;
    }
  }
  const partnerProjection: PartnerProjection = {
    subjectMemberId: remote?.ownerUid ?? PARTNER_MEMBER_ID,
    asOf: partnerAsOf,
    ...(remoteMood ? { mood: remoteMood } : {}),
    ...(remote?.energyLevel ? { energy: remote.energyLevel } : {}),
    ...(remoteCondition ? { condition: remoteCondition } : {}),
    ...(remotePreferences.length > 0
      ? { helpPreferences: remotePreferences }
      : {}),
    ...(remoteSymptoms.length > 0 ? { symptoms: remoteSymptoms } : {}),
    ...(remote?.note ? { note: remote.note } : {}),
    ...(remote?.cyclePhase ? { cyclePhase: remote.cyclePhase } : {}),
    ...(remotePeriodStart
      ? {
          periodDates: {
            start: remotePeriodStart,
            ...(remotePeriodEnd ? { end: remotePeriodEnd } : {}),
          },
        }
      : {}),
  };
  const careTips = selectCareTips({
    helpPreferences: partnerProjection.helpPreferences,
    condition: partnerProjection.condition,
    limit: featurePolicy.careTipLimit,
  });

  const copy = phaseCopy[phase];
  return {
    today,
    phase,
    phaseTitle: copy.title,
    phaseDescription: copy.description,
    cycleDay: phaseResult.cycleDay,
    ...(prediction
      ? {
          predictedDate: prediction.nextPeriodDate,
          predictionStart: prediction.confidenceWindow.start,
          predictionEnd: prediction.confidenceWindow.end,
          daysUntilPrediction: daysBetween(today, prediction.nextPeriodDate),
          daysLate: prediction.daysLate,
        }
      : {}),
    selfProjection,
    partnerProjection,
    careTips,
    ...(prediction && featurePolicy.advancedPredictionEnabled
      ? {
          advancedPrediction: {
            averageCycleLengthDays: prediction.averageCycleLengthDays,
            confidence: prediction.confidence,
            sampleSize: prediction.sampleSize,
            observedCycleLengths: prediction.observedCycleLengths,
            standardDeviationDays: standardDeviation(
              prediction.observedCycleLengths,
            ),
            excludedIntervalCount: prediction.excludedIntervalCount,
          },
        }
      : {}),
  };
}

export function formatKoreanDate(
  value: LocalDate | string,
  reference: LocalDate | string = todayLocalDate(),
): string {
  const [year, month, day] = String(value).split('-');
  const [referenceYear] = String(reference).split('-');
  const date = `${Number(month)}월 ${Number(day)}일`;
  return year === referenceYear ? date : `${Number(year)}년 ${date}`;
}
