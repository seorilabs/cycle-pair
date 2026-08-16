import {
  fromBackendShareSettings,
  fromPrivateDailyLogRecord,
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
        periodEnded: false,
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
        cycleStatus: false,
        fertilityStatus: false,
        predictedPeriod: false,
        periodDates: false,
        mood: true,
        symptoms: false,
        energy: false,
        condition: false,
        carePreference: false,
        note: false,
      }),
    ).toEqual({
      cyclePhase: false,
      cycleStatus: false,
      fertilityStatus: false,
      nextPeriodWindow: false,
      periodDates: false,
      moodTag: true,
      symptomTags: false,
      energyLevel: false,
      conditionCode: false,
      carePreferences: false,
      note: false,
    });
  });

  it('uses LocalDate arithmetic for the low-confidence seed window', () => {
    expect(
      toPrivateCycleRecord({
        lastPeriodStart: '2026-01-31',
        averageCycleLength: 28,
        averagePeriodLength: 5,
      }, '2026-02-10'),
    ).toEqual({
      asOfDate: '2026-02-10',
      averageCycleLength: 28,
      averagePeriodLength: 5,
      periodDates: { startDate: '2026-01-31' },
      cyclePhase: 'follicular',
      cycleStatus: 'cycle-in-progress',
      nextPeriodWindow: {
        startDate: '2026-02-21',
        endDate: '2026-03-07',
      },
    });
  });

  it.each([
    ['2026-01-30', 'unknown'],
    ['2026-02-02', 'menstrual'],
    ['2026-02-10', 'follicular'],
    ['2026-02-12', 'ovulatory'],
    ['2026-02-15', 'luteal'],
    ['2026-02-28', 'unknown'],
  ] as const)('maps %s to the privacy-safe cycle phase %s', (onDate, phase) => {
    expect(
      toPrivateCycleRecord(
        {
          lastPeriodStart: '2026-01-31',
          averageCycleLength: 28,
          averagePeriodLength: 5,
        },
        onDate,
      ).cyclePhase,
    ).toBe(phase);
  });

  it.each([
    ['2026-01-31', 'period-starting'],
    ['2026-02-02', 'period-in-progress'],
    ['2026-02-04', 'period-ending'],
    ['2026-02-05', 'post-period'],
    ['2026-02-12', 'fertile-window'],
    ['2026-02-25', 'pre-period'],
  ] as const)('maps %s to the nuanced cycle status %s', (onDate, status) => {
    expect(
      toPrivateCycleRecord(
        {
          lastPeriodStart: '2026-01-31',
          averageCycleLength: 28,
          averagePeriodLength: 5,
        },
        onDate,
      ).cycleStatus,
    ).toBe(status);
  });

  it('prioritizes an explicitly recorded period end over the average duration', () => {
    const seed = {
      lastPeriodStart: '2026-01-31',
      lastPeriodEnd: '2026-02-02',
      averageCycleLength: 28,
      averagePeriodLength: 5,
    };

    expect(toPrivateCycleRecord(seed, '2026-02-02').cycleStatus).toBe(
      'period-ending',
    );
    expect(toPrivateCycleRecord(seed, '2026-02-03').cycleStatus).toBe(
      'post-period',
    );
    expect(toPrivateCycleRecord(seed, '2026-02-05')).toMatchObject({
      cyclePhase: 'follicular',
      cycleStatus: 'cycle-in-progress',
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
        energyLevel: true,
        conditionCode: true,
        carePreferences: true,
        note: true,
      }),
    ).toEqual({
      cyclePhase: true,
      cycleStatus: false,
      fertilityStatus: false,
      predictedPeriod: false,
      periodDates: false,
      mood: true,
      symptoms: false,
      energy: true,
      condition: true,
      carePreference: true,
      note: true,
    });
  });

  it('uses the device calendar date instead of the UTC date', () => {
    expect(toDeviceLocalDate(new Date(2026, 0, 2, 0, 30))).toBe('2026-01-02');
  });

  it('omits cleared daily values so a replacement write removes old fields', () => {
    expect(
      toPrivateDailyLogRecord({
        symptoms: [],
        periodStarted: false,
        periodEnded: false,
      }),
    ).toEqual({});
  });

  it('round-trips the complete private daily record without localized values in Firestore', () => {
    const record = toPrivateDailyLogRecord({
      mood: '좋아요',
      symptoms: ['두통'],
      energy: 4,
      condition: '편안해요',
      carePreference: '따뜻하게 챙겨줘요',
      note: '  오늘은 조금 나아졌어요.  ',
      periodStarted: false,
      periodEnded: true,
    });

    expect(record).toEqual({
      moodTag: 'good',
      symptomTags: ['headache'],
      energyLevel: 4,
      conditionCode: 'comfortable',
      carePreferences: ['warmth'],
      note: '오늘은 조금 나아졌어요.',
      periodEnded: true,
    });
    expect(fromPrivateDailyLogRecord(record)).toEqual({
      mood: '좋아요',
      symptoms: ['두통'],
      energy: 4,
      condition: '편안해요',
      carePreference: '따뜻하게 챙겨줘요',
      note: '오늘은 조금 나아졌어요.',
      periodStarted: false,
      periodEnded: true,
    });
  });

  it('bounds free-form daily notes to the 500-character mobile contract', () => {
    const record = toPrivateDailyLogRecord({
      symptoms: [],
      note: `  ${'x'.repeat(501)}  `,
      periodStarted: false,
      periodEnded: false,
    });

    expect(record.note).toHaveLength(500);
  });
});
