import {
  addDays as addLocalDays,
  daysBetween,
  determineCyclePhase,
  parseLocalDate,
  type CyclePhaseResult,
} from '@cyclepair/product-core';
import type {
  CycleSeed,
  DailyCheckIn,
  ShareField,
} from '../../app/CyclePairStore';
import type {
  BackendCycleStatus,
  BackendConditionCode,
  BackendShareSettings,
  PrivateCycleRecord,
  PrivateDailyLogRecord,
  PrivateDailyLogSnapshot,
} from './CyclePairBackend';

const moodTags: Record<NonNullable<DailyCheckIn['mood']>, string> = {
  '힘들어요': 'very-low',
  '지쳐요': 'low',
  '괜찮아요': 'neutral',
  '좋아요': 'good',
};

const symptomTags: Record<string, string> = {
  '복통': 'cramps',
  '두통': 'headache',
  '피로': 'fatigue',
  '부종': 'bloating',
  '예민함': 'sensitive',
  '허리 불편': 'back-discomfort',
};

const carePreferenceTags: Record<NonNullable<DailyCheckIn['carePreference']>, string> = {
  '쉬고 싶어요': 'quiet-space',
  '따뜻하게 챙겨줘요': 'warmth',
  '그냥 들어줘요': 'listen',
  '평소처럼 대해줘요': 'no-action',
};

const moodByTag = Object.fromEntries(
  Object.entries(moodTags).map(([label, tag]) => [tag, label]),
) as Record<string, NonNullable<DailyCheckIn['mood']>>;

const symptomByTag = Object.fromEntries(
  Object.entries(symptomTags).map(([label, tag]) => [tag, label]),
) as Record<string, string>;

const carePreferenceByTag = Object.fromEntries(
  Object.entries(carePreferenceTags).map(([label, tag]) => [tag, label]),
) as Record<string, NonNullable<DailyCheckIn['carePreference']>>;

const conditionTags: Record<
  NonNullable<DailyCheckIn['condition']>,
  BackendConditionCode
> = {
  '편안해요': 'comfortable',
  '피곤해요': 'tired',
  '기운이 없어요': 'low-energy',
  '공간이 필요해요': 'needs-space',
};

const conditionByTag = Object.fromEntries(
  Object.entries(conditionTags).map(([label, tag]) => [tag, label]),
) as Record<string, NonNullable<DailyCheckIn['condition']>>;

const UNKNOWN_PHASE: CyclePhaseResult = Object.freeze({
  phase: 'unknown',
  cycleDay: null,
  estimated: true,
});

/**
 * 파트너에게 보낼 국면을 도메인 정본으로 판정한다.
 *
 * 예전에는 이 파일이 국면 규칙을 따로 구현했고, 배란 구간 클램프와 입력 검증이
 * 없어 짧은 주기에서 생리 중인 날이 `ovulatory`로 넘어갈 수 있었다. 그래서
 * 같은 날 홈 화면과 파트너 화면의 국면이 달랐다.
 *
 * 도메인이 던지는 불변식 위반과 잘못된 날짜는 `unknown`으로 흡수한다. 관측
 * 값 하나 때문에 전송 경로 전체가 막히면 안 된다.
 */
function cyclePhaseResultForDate(
  seed: CycleSeed,
  onDate: string,
): CyclePhaseResult {
  try {
    const lastPeriodStart = parseLocalDate(seed.lastPeriodStart);
    const on = parseLocalDate(onDate);
    const explicitPeriodLength = seed.lastPeriodEnd
      ? daysBetween(lastPeriodStart, parseLocalDate(seed.lastPeriodEnd)) + 1
      : 0;
    return determineCyclePhase({
      lastPeriodStart,
      on,
      averageCycleLengthDays: seed.averageCycleLength,
      periodLengthDays:
        explicitPeriodLength > 0
          ? explicitPeriodLength
          : seed.averagePeriodLength,
    });
  } catch {
    return UNKNOWN_PHASE;
  }
}

/**
 * 주기 상태는 국면 판정에서 파생한다.
 *
 * 가임 구간을 여기서 다시 계산하면 `cyclePhase`가 `menstrual`인 날에
 * `cycleStatus`가 `fertile-window`로 나가는 모순이 생긴다. 같은 판정 결과를
 * 입력으로 받아 두 값이 서로 어긋나지 않게 한다.
 */
function cycleStatusFromPhase(
  seed: CycleSeed,
  onDate: string,
  phase: CyclePhaseResult,
): BackendCycleStatus {
  const cycleDay = phase.cycleDay;
  if (cycleDay === null) return 'unknown';
  if (cycleDay === 1) return 'period-starting';

  if (seed.lastPeriodEnd) {
    let daysAfterEnd: number | null;
    try {
      daysAfterEnd = daysBetween(
        parseLocalDate(seed.lastPeriodEnd),
        parseLocalDate(onDate),
      );
    } catch {
      daysAfterEnd = null;
    }
    if (daysAfterEnd !== null) {
      if (daysAfterEnd < 0) return 'period-in-progress';
      if (daysAfterEnd === 0) return 'period-ending';
      if (daysAfterEnd <= 2) return 'post-period';
    }
  } else {
    if (cycleDay < seed.averagePeriodLength) return 'period-in-progress';
    if (cycleDay === seed.averagePeriodLength) return 'period-ending';
    if (cycleDay <= seed.averagePeriodLength + 2) return 'post-period';
  }

  if (phase.phase === 'ovulatory') return 'fertile-window';
  if (cycleDay >= seed.averageCycleLength - 2) return 'pre-period';
  return 'cycle-in-progress';
}

/**
 * 예상 구간은 선택 필드다.
 *
 * 시작일 형식이나 주기 길이가 유효하지 않으면 잘못된 구간을 보내는 대신
 * 비운다. 이 함수가 던지면 개인 기록 전송 자체가 막히는데, 관측 값 하나가
 * 저장을 막아서는 안 된다.
 */
function nextPeriodWindowFor(
  seed: CycleSeed,
): PrivateCycleRecord['nextPeriodWindow'] {
  try {
    const predicted = addLocalDays(
      parseLocalDate(seed.lastPeriodStart),
      seed.averageCycleLength,
    );
    return {
      startDate: addLocalDays(predicted, -7),
      endDate: addLocalDays(predicted, 7),
    };
  } catch {
    return undefined;
  }
}

export function toPrivateCycleRecord(
  seed: CycleSeed,
  onDate = toDeviceLocalDate(),
): PrivateCycleRecord {
  const phase = cyclePhaseResultForDate(seed, onDate);
  const nextPeriodWindow = nextPeriodWindowFor(seed);
  return {
    asOfDate: onDate,
    averageCycleLength: seed.averageCycleLength,
    averagePeriodLength: seed.averagePeriodLength,
    periodDates: {
      startDate: seed.lastPeriodStart,
      ...(seed.lastPeriodEnd ? { endDate: seed.lastPeriodEnd } : {}),
    },
    cyclePhase: phase.phase,
    cycleStatus: cycleStatusFromPhase(seed, onDate, phase),
    ...(nextPeriodWindow ? { nextPeriodWindow } : {}),
  };
}

export function fromBackendShareSettings(
  settings: BackendShareSettings,
): Record<ShareField, boolean> {
  return {
    cyclePhase: settings.cyclePhase,
    cycleStatus: settings.cycleStatus === true,
    fertilityStatus: settings.fertilityStatus === true,
    predictedPeriod: settings.nextPeriodWindow,
    periodDates: settings.periodDates,
    mood: settings.moodTag,
    symptoms: settings.symptomTags,
    energy: settings.energyLevel,
    condition: settings.conditionCode,
    carePreference: settings.carePreferences,
    note: settings.note,
  };
}

export function toDeviceLocalDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toPrivateDailyLogRecord(checkIn: DailyCheckIn): PrivateDailyLogRecord {
  return {
    ...(checkIn.mood ? { moodTag: moodTags[checkIn.mood] } : {}),
    ...(checkIn.symptoms.length > 0
      ? {
          symptomTags: checkIn.symptoms
            .map(symptom => symptomTags[symptom])
            .filter((tag): tag is string => Boolean(tag)),
        }
      : {}),
    ...(checkIn.energy ? { energyLevel: checkIn.energy } : {}),
    ...(checkIn.condition ? { conditionCode: conditionTags[checkIn.condition] } : {}),
    ...(checkIn.carePreference
      ? { carePreferences: [carePreferenceTags[checkIn.carePreference]] }
      : {}),
    ...(checkIn.note?.trim() ? { note: checkIn.note.trim().slice(0, 500) } : {}),
    ...(checkIn.periodStarted ? { periodStarted: true } : {}),
    ...(checkIn.periodEnded ? { periodEnded: true } : {}),
  };
}

export function fromPrivateDailyLogRecord(
  record: PrivateDailyLogRecord,
): DailyCheckIn {
  const careTag = record.carePreferences?.[0];
  return {
    ...(record.moodTag && moodByTag[record.moodTag]
      ? { mood: moodByTag[record.moodTag] }
      : {}),
    symptoms: (record.symptomTags ?? [])
      .map(tag => symptomByTag[tag])
      .filter((label): label is string => Boolean(label)),
    ...(record.energyLevel ? { energy: record.energyLevel } : {}),
    ...(record.conditionCode && conditionByTag[record.conditionCode]
      ? { condition: conditionByTag[record.conditionCode] }
      : {}),
    ...(careTag && carePreferenceByTag[careTag]
      ? { carePreference: carePreferenceByTag[careTag] }
      : {}),
    ...(record.note ? { note: record.note } : {}),
    periodStarted: record.periodStarted === true,
    periodEnded: record.periodEnded === true,
  };
}

export function fromPrivateDailyLogSnapshot(
  snapshot: PrivateDailyLogSnapshot,
) {
  return {
    localDate: snapshot.localDate,
    checkIn: fromPrivateDailyLogRecord(snapshot.record),
    ...(snapshot.updatedAt ? { updatedAt: snapshot.updatedAt } : {}),
  };
}

export function toBackendShareSettings(
  settings: Readonly<Record<ShareField, boolean>>,
): BackendShareSettings {
  return {
    cyclePhase: settings.cyclePhase,
    cycleStatus: settings.cycleStatus,
    fertilityStatus: settings.fertilityStatus,
    nextPeriodWindow: settings.predictedPeriod,
    periodDates: settings.periodDates,
    moodTag: settings.mood,
    symptomTags: settings.symptoms,
    energyLevel: settings.energy,
    conditionCode: settings.condition,
    carePreferences: settings.carePreference,
    note: settings.note,
  };
}
