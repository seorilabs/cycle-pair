import {
  fromBackendShareSettings,
  toBackendShareSettings,
  toDeviceLocalDate,
  toPrivateCycleRecord,
  toPrivateDailyLogRecord,
} from './backendPayloads';

describe('Firebase backend payload mapping', () => {
  it('maps localized health values to stable allowlisted tags', () => {
    expect(
      toPrivateDailyLogRecord({
        mood: '지쳐요',
        symptoms: ['피로', '복통', '알 수 없는 값'],
        carePreference: '그냥 들어줘요',
        periodStarted: false,
      }),
    ).toEqual({
      moodTag: 'low',
      symptomTags: ['fatigue', 'cramps'],
      carePreferences: ['listen'],
    });
  });

  it('keeps sharing private by default and maps UI fields explicitly', () => {
    expect(
      toBackendShareSettings({
        cyclePhase: false,
        predictedPeriod: false,
        periodDates: false,
        mood: true,
        symptoms: false,
        carePreference: false,
      }),
    ).toEqual({
      cyclePhase: false,
      nextPeriodWindow: false,
      periodDates: false,
      moodTag: true,
      symptomTags: false,
      carePreferences: false,
    });
  });

  it('uses LocalDate arithmetic for the low-confidence seed window', () => {
    expect(
      toPrivateCycleRecord({
        lastPeriodStart: '2026-01-31',
        averageCycleLength: 28,
        averagePeriodLength: 5,
      }),
    ).toEqual({
      averageCycleLength: 28,
      averagePeriodLength: 5,
      periodDates: { startDate: '2026-01-31' },
      nextPeriodWindow: {
        startDate: '2026-02-21',
        endDate: '2026-03-07',
      },
    });
  });

  it('maps pair-scoped server consent back to the UI fields', () => {
    expect(
      fromBackendShareSettings({
        cyclePhase: true,
        nextPeriodWindow: false,
        periodDates: false,
        moodTag: true,
        symptomTags: false,
        carePreferences: true,
      }),
    ).toEqual({
      cyclePhase: true,
      predictedPeriod: false,
      periodDates: false,
      mood: true,
      symptoms: false,
      carePreference: true,
    });
  });

  it('uses the device calendar date instead of the UTC date', () => {
    expect(toDeviceLocalDate(new Date(2026, 0, 2, 0, 30))).toBe('2026-01-02');
  });

  it('omits cleared daily values so a replacement write removes old fields', () => {
    expect(
      toPrivateDailyLogRecord({ symptoms: [], periodStarted: false }),
    ).toEqual({});
  });
});
