import type {
  CycleSeed,
  DailyCheckIn,
  ShareField,
} from '../../app/MoonMateStore';
import type {
  BackendShareSettings,
  PrivateCycleRecord,
  PrivateDailyLogRecord,
} from './MoonMateBackend';

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

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function toPrivateCycleRecord(seed: CycleSeed): PrivateCycleRecord {
  const predicted = addDays(seed.lastPeriodStart, seed.averageCycleLength);
  return {
    averageCycleLength: seed.averageCycleLength,
    averagePeriodLength: seed.averagePeriodLength,
    periodDates: { startDate: seed.lastPeriodStart },
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
    predictedPeriod: settings.nextPeriodWindow,
    periodDates: settings.periodDates,
    mood: settings.moodTag,
    symptoms: settings.symptomTags,
    carePreference: settings.carePreferences,
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
    ...(checkIn.carePreference
      ? { carePreferences: [carePreferenceTags[checkIn.carePreference]] }
      : {}),
  };
}

export function toBackendShareSettings(
  settings: Readonly<Record<ShareField, boolean>>,
): BackendShareSettings {
  return {
    cyclePhase: settings.cyclePhase,
    nextPeriodWindow: settings.predictedPeriod,
    periodDates: settings.periodDates,
    moodTag: settings.mood,
    symptomTags: settings.symptoms,
    carePreferences: settings.carePreference,
  };
}
