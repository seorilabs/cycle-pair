import {
  createCycle,
  createCycleLog,
  createShareSettings,
  determineCyclePhase,
  daysBetween,
  localDate,
  parseLocalDate,
  predictFromCycleSeed,
  projectForPartner,
  selectCareTips,
  type CareTip,
  type ConditionCode,
  type CyclePhase,
  type HelpPreference,
  type LocalDate,
  type Mood,
  type PartnerProjection,
} from '@cyclepair/product-core';
import { DailyCheckIn, CyclePairState } from './CyclePairStore';

const SELF_MEMBER_ID = 'local-self';
const PARTNER_MEMBER_ID = 'remote-partner';

const moodToDomain: Record<NonNullable<DailyCheckIn['mood']>, Mood> = {
  '힘들어요': 'very-low',
  '지쳐요': 'low',
  '괜찮아요': 'neutral',
  '좋아요': 'good',
};

const preferenceToDomain: Record<NonNullable<DailyCheckIn['carePreference']>, HelpPreference> = {
  '쉬고 싶어요': 'quiet-space',
  '따뜻하게 챙겨줘요': 'warmth',
  '그냥 들어줘요': 'listen',
  '평소처럼 대해줘요': 'no-action',
};

const phaseCopy: Record<CyclePhase, { title: string; description: string }> = {
  menstrual: { title: '월경 중', description: '오늘의 몸 상태를 가장 먼저 살펴주세요' },
  follicular: { title: '회복하는 시기', description: '컨디션은 사람마다 다르게 변할 수 있어요' },
  ovulatory: { title: '회복하는 시기', description: '컨디션은 사람마다 다르게 변할 수 있어요' },
  luteal: { title: '변화에 대비하는 시기', description: '예측보다 오늘 직접 남긴 상태가 우선이에요' },
  unknown: { title: '기록이 더 필요해요', description: '주기가 쌓이면 참고 범위를 계산해 드려요' },
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
  selfProjection: PartnerProjection;
  partnerProjection: PartnerProjection;
  careTip: CareTip;
}

export function todayLocalDate(): LocalDate {
  const date = new Date();
  return localDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function buildCurrentCycle(state: CyclePairState) {
  const lastStart = parseLocalDate(state.seed.lastPeriodStart);
  return createCycle({
    id: 'current-cycle',
    memberId: SELF_MEMBER_ID,
    startedOn: lastStart,
  });
}

function mapCondition(checkIn: DailyCheckIn): ConditionCode | undefined {
  if (checkIn.symptoms.includes('피로')) return 'tired';
  if (checkIn.symptoms.includes('예민함')) return 'sensitive';
  if (checkIn.symptoms.includes('복통')) return 'cramps';
  if (checkIn.symptoms.includes('두통')) return 'headache';
  return checkIn.mood ? 'comfortable' : undefined;
}

function mapHelpPreferences(checkIn: DailyCheckIn): HelpPreference[] | undefined {
  return checkIn.carePreference ? [preferenceToDomain[checkIn.carePreference]] : undefined;
}

export function buildCycleViewModel(state: CyclePairState): CycleViewModel {
  const today = todayLocalDate();
  const currentCycle = state.isLogger ? buildCurrentCycle(state) : undefined;
  const prediction = currentCycle
    ? predictFromCycleSeed({
        memberId: SELF_MEMBER_ID,
        generatedOn: today,
        lastPeriodStart: currentCycle.startedOn,
        averageCycleLengthDays: state.seed.averageCycleLength,
      })
    : undefined;
  const phaseResult = state.isLogger
    ? determineCyclePhase({
        on: today,
        lastPeriodStart: parseLocalDate(state.seed.lastPeriodStart),
        averageCycleLengthDays: state.seed.averageCycleLength,
        periodLengthDays: state.seed.averagePeriodLength,
      })
    : { phase: 'unknown' as const, cycleDay: null };
  const phase: CyclePhase = phaseResult.phase;

  const latestLog = createCycleLog({
    id: `check-in-${today}`,
    memberId: SELF_MEMBER_ID,
    date: today,
    ...(state.checkIn.mood ? { mood: moodToDomain[state.checkIn.mood] } : {}),
    ...(state.checkIn.symptoms.length > 0 ? { symptoms: state.checkIn.symptoms } : {}),
    ...(mapCondition(state.checkIn) ? { condition: mapCondition(state.checkIn) } : {}),
    ...(mapHelpPreferences(state.checkIn) ? { helpPreferences: mapHelpPreferences(state.checkIn) } : {}),
  });

  const selfSettings = createShareSettings(SELF_MEMBER_ID, today, {
    cyclePhase: state.shareSettings.cyclePhase,
    periodDates: state.shareSettings.periodDates,
    prediction: state.shareSettings.predictedPeriod,
    mood: state.shareSettings.mood,
    symptoms: state.shareSettings.symptoms,
    condition: state.shareSettings.mood,
    helpPreferences: state.shareSettings.carePreference,
  });
  const selfProjection = projectForPartner(
    {
      subjectMemberId: SELF_MEMBER_ID,
      asOf: today,
      ...(state.isLogger ? { cyclePhase: phase } : {}),
      ...(currentCycle ? { currentCycle } : {}),
      ...(prediction ? { prediction } : {}),
      latestLog,
    },
    selfSettings,
  );

  const remote = state.partnerProjection;
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
  const remoteCondition: ConditionCode | undefined = remoteSymptoms.includes('cramps')
    ? 'cramps'
    : remoteSymptoms.includes('headache')
      ? 'headache'
      : remoteSymptoms.includes('fatigue')
        ? 'tired'
        : remoteSymptoms.includes('sensitive')
          ? 'sensitive'
          : undefined;
  let partnerAsOf = today;
  if (remote?.generatedAt) {
    try {
      partnerAsOf = parseLocalDate(remote.generatedAt.slice(0, 10));
    } catch {
      partnerAsOf = today;
    }
  }
  const partnerProjection: PartnerProjection = {
    subjectMemberId: remote?.ownerUid ?? PARTNER_MEMBER_ID,
    asOf: partnerAsOf,
    ...(remoteMood ? { mood: remoteMood } : {}),
    ...(remoteCondition ? { condition: remoteCondition } : {}),
    ...(remotePreferences.length > 0 ? { helpPreferences: remotePreferences } : {}),
    ...(remoteSymptoms.length > 0 ? { symptoms: remoteSymptoms } : {}),
    ...(remote?.cyclePhase ? { cyclePhase: remote.cyclePhase } : {}),
    ...(remote?.periodDates
      ? {
          periodDates: {
            start: parseLocalDate(remote.periodDates.startDate),
            ...(remote.periodDates.endDate
              ? { end: parseLocalDate(remote.periodDates.endDate) }
              : {}),
          },
        }
      : {}),
  };
  const careTip = selectCareTips({
    helpPreferences: partnerProjection.helpPreferences,
    condition: partnerProjection.condition,
    limit: 1,
  })[0] ?? {
    id: 'fallback',
    title: '직접 물어보는 것이 가장 정확해요',
    body: '추측하지 말고 지금 필요한 것이 있는지 가볍게 확인해 보세요.',
  };

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
        }
      : {}),
    selfProjection,
    partnerProjection,
    careTip,
  };
}

export function formatKoreanDate(value: LocalDate | string): string {
  const [, month, day] = String(value).split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}
