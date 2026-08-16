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

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function cyclePhaseForDate(
  seed: CycleSeed,
  onDate: string,
): NonNullable<PrivateCycleRecord['cyclePhase']> {
  const start = Date.parse(`${seed.lastPeriodStart}T12:00:00.000Z`);
  const current = Date.parse(`${onDate}T12:00:00.000Z`);
  const offset = Math.round((current - start) / 86_400_000);
  if (
    !Number.isFinite(offset) ||
    offset < 0 ||
    offset >= seed.averageCycleLength
  ) {
    return 'unknown';
  }
  const explicitPeriodEnd = seed.lastPeriodEnd
    ? Date.parse(`${seed.lastPeriodEnd}T12:00:00.000Z`)
    : Number.NaN;
  const explicitPeriodLength = Math.round(
    (explicitPeriodEnd - start) / 86_400_000,
  ) + 1;
  const periodLength =
    Number.isFinite(explicitPeriodLength) && explicitPeriodLength > 0
      ? explicitPeriodLength
      : seed.averagePeriodLength;
  if (offset < periodLength) return 'menstrual';
  const cycleDay = offset + 1;
  const ovulationDay = seed.averageCycleLength - 14;
  if (cycleDay >= ovulationDay - 1 && cycleDay <= ovulationDay + 1) {
    return 'ovulatory';
  }
  if (cycleDay > ovulationDay + 1) return 'luteal';
  return 'follicular';
}

function cycleStatusForDate(
  seed: CycleSeed,
  onDate: string,
): BackendCycleStatus {
  const start = Date.parse(`${seed.lastPeriodStart}T12:00:00.000Z`);
  const current = Date.parse(`${onDate}T12:00:00.000Z`);
  const offset = Math.round((current - start) / 86_400_000);
  if (
    !Number.isFinite(offset) ||
    offset < 0 ||
    offset >= seed.averageCycleLength
  ) {
    return 'unknown';
  }

  const cycleDay = offset + 1;
  if (cycleDay === 1) return 'period-starting';
  if (seed.lastPeriodEnd) {
    const periodEnd = Date.parse(`${seed.lastPeriodEnd}T12:00:00.000Z`);
    const daysAfterEnd = Math.round((current - periodEnd) / 86_400_000);
    if (Number.isFinite(daysAfterEnd)) {
      if (daysAfterEnd < 0) return 'period-in-progress';
      if (daysAfterEnd === 0) return 'period-ending';
      if (daysAfterEnd <= 2) return 'post-period';
    }
  } else {
    if (cycleDay < seed.averagePeriodLength) return 'period-in-progress';
    if (cycleDay === seed.averagePeriodLength) return 'period-ending';
    if (cycleDay <= seed.averagePeriodLength + 2) return 'post-period';
  }

  const ovulationDay = seed.averageCycleLength - 14;
  if (cycleDay >= ovulationDay - 1 && cycleDay <= ovulationDay + 1) {
    return 'fertile-window';
  }
  if (cycleDay >= seed.averageCycleLength - 2) return 'pre-period';
  return 'cycle-in-progress';
}

export function toPrivateCycleRecord(
  seed: CycleSeed,
  onDate = toDeviceLocalDate(),
): PrivateCycleRecord {
  const predicted = addDays(seed.lastPeriodStart, seed.averageCycleLength);
  return {
    asOfDate: onDate,
    averageCycleLength: seed.averageCycleLength,
    averagePeriodLength: seed.averagePeriodLength,
    periodDates: {
      startDate: seed.lastPeriodStart,
      ...(seed.lastPeriodEnd ? { endDate: seed.lastPeriodEnd } : {}),
    },
    cyclePhase: cyclePhaseForDate(seed, onDate),
    cycleStatus: cycleStatusForDate(seed, onDate),
    nextPeriodWindow: {
      startDate: addDays(predicted, -7),
      endDate: addDays(predicted, 7),
    },
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
