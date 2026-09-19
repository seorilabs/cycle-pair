import {
  addDays,
  determineCyclePhase,
  parseLocalDate,
} from '@cyclepair/product-core';
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

describe('파트너에게 보내는 주기 국면', () => {
  const start = '2026-03-01';
  const on = (offset: number) =>
    addDays(parseLocalDate(start), offset) as string;

  it('짧은 주기에서도 생리 중인 날이 가임 구간으로 넘어가지 않는다', () => {
    // averageCycleLength 16 이면 배란일이 2일차로 계산된다. 도메인은
    // ovulationStart 를 periodLength + 1 로 막아 생리 기간과 겹치지 않게 한다.
    const seed = {
      lastPeriodStart: start,
      averageCycleLength: 16,
      averagePeriodLength: 5,
    } as never;

    for (let offset = 0; offset < 5; offset += 1) {
      const record = toPrivateCycleRecord(seed, on(offset));
      expect(record.cyclePhase).toBe('menstrual');
      expect(record.cycleStatus).not.toBe('fertile-window');
    }
  });

  it('같은 입력에서 도메인 정본과 국면이 일치한다', () => {
    const seeds = [
      { averageCycleLength: 28, averagePeriodLength: 5 },
      { averageCycleLength: 16, averagePeriodLength: 5 },
      { averageCycleLength: 45, averagePeriodLength: 7 },
      { averageCycleLength: 21, averagePeriodLength: 3 },
    ];
    for (const partial of seeds) {
      const seed = { lastPeriodStart: start, ...partial } as never;
      for (let offset = 0; offset < partial.averageCycleLength; offset += 1) {
        const onDate = on(offset);
        const canonical = determineCyclePhase({
          lastPeriodStart: parseLocalDate(start),
          on: parseLocalDate(onDate),
          averageCycleLengthDays: partial.averageCycleLength,
          periodLengthDays: partial.averagePeriodLength,
        });
        expect(toPrivateCycleRecord(seed, onDate).cyclePhase).toBe(
          canonical.phase,
        );
      }
    }
  });

  it('가임 상태는 국면이 배란기일 때만 나간다', () => {
    const seed = {
      lastPeriodStart: start,
      averageCycleLength: 28,
      averagePeriodLength: 5,
    } as never;
    for (let offset = 0; offset < 28; offset += 1) {
      const record = toPrivateCycleRecord(seed, on(offset));
      if (record.cycleStatus === 'fertile-window') {
        expect(record.cyclePhase).toBe('ovulatory');
      }
    }
  });

  it('도메인 불변식을 어긴 seed는 예외 대신 unknown으로 나간다', () => {
    const invalid = [
      { averageCycleLength: 14, averagePeriodLength: 5 },
      { averageCycleLength: 61, averagePeriodLength: 5 },
      { averageCycleLength: 20, averagePeriodLength: 20 },
      { averageCycleLength: 28, averagePeriodLength: 0 },
    ];
    for (const partial of invalid) {
      const seed = { lastPeriodStart: start, ...partial } as never;
      const record = toPrivateCycleRecord(seed, on(3));
      expect(record.cyclePhase).toBe('unknown');
      expect(record.cycleStatus).toBe('unknown');
    }
  });

  it('주기 길이가 정수가 아니어도 전송 payload를 만들 수 있다', () => {
    // 예전 지역 구현은 Date 산술이라 조용히 넘어갔고, 도메인 날짜 유틸은
    // 정수가 아닌 일수를 거부한다. 예상 구간은 선택 필드이므로 비우고,
    // 개인 기록 전송 자체는 막지 않는다.
    const seed = {
      lastPeriodStart: start,
      averageCycleLength: 28.5,
      averagePeriodLength: 5,
    } as never;

    const record = toPrivateCycleRecord(seed, on(3));
    expect(record.cyclePhase).toBe('unknown');
    expect(record.nextPeriodWindow).toBeUndefined();
    expect(record.periodDates.startDate).toBe(start);
  });

  it('유효한 seed에서는 예상 구간이 예정일 앞뒤 7일이다', () => {
    const seed = {
      lastPeriodStart: start,
      averageCycleLength: 28,
      averagePeriodLength: 5,
    } as never;

    expect(toPrivateCycleRecord(seed, on(3)).nextPeriodWindow).toEqual({
      startDate: on(21),
      endDate: on(35),
    });
  });
});

describe('예정일을 넘긴 상태', () => {
  const start = '2026-03-01';
  const on = (offset: number) => addDays(parseLocalDate(start), offset) as string;
  const seed = {
    lastPeriodStart: start,
    averageCycleLength: 28,
    averagePeriodLength: 5,
  } as never;

  it('예정일이 지나면 국면은 unknown이지만 상태는 지연으로 나간다', () => {
    for (const offset of [28, 31, 40, 90]) {
      const record = toPrivateCycleRecord(seed, on(offset));
      expect(record.cyclePhase).toBe('unknown');
      expect(record.cycleStatus).toBe('period-late');
    }
  });

  it('주기 마지막 날까지는 지연이 아니다', () => {
    const record = toPrivateCycleRecord(seed, on(27));
    expect(record.cycleStatus).not.toBe('period-late');
  });

  it('계산 불가인 과거 날짜는 지연이 아니라 unknown이다', () => {
    const record = toPrivateCycleRecord(seed, on(-1));
    expect(record.cyclePhase).toBe('unknown');
    expect(record.cycleStatus).toBe('unknown');
  });

  it('도메인 불변식을 어긴 seed는 지연으로 단정하지 않는다', () => {
    const invalidSeed = {
      lastPeriodStart: start,
      averageCycleLength: 14,
      averagePeriodLength: 5,
    } as never;

    const record = toPrivateCycleRecord(invalidSeed, on(30));
    expect(record.cycleStatus).toBe('unknown');
  });
});
