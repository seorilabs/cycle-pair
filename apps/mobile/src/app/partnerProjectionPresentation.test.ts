import type { RemotePartnerProjection } from '../platform/backend/CyclePairBackend';
import {
  PARTNER_PROJECTION_STALE_AFTER_MS,
  buildPartnerSharedFields,
  buildPartnerTodaySummary,
  getSafePartnerProjectionForToday,
  getPartnerProjectionFreshness,
} from './partnerProjectionPresentation';

const metadata: RemotePartnerProjection = {
  ownerUid: 'partner-a',
  pairId: 'pair-a',
  generatedAt: '2026-07-14T00:00:00.000Z',
  cycleAsOfDate: '2026-07-14',
  dailyLogDate: '2026-07-14',
};
const metadataDate = new Date('2026-07-14T12:00:00.000Z');

describe('partner projection presentation', () => {
  it('메타데이터만 있는 projection은 공유된 실제 값으로 세지 않는다', () => {
    expect(buildPartnerSharedFields(metadata, metadataDate)).toEqual([]);
  });

  it('직접 공유된 9개 필드를 사람이 읽을 수 있는 값으로 표시한다', () => {
    const fields = buildPartnerSharedFields(
      {
        ...metadata,
        cyclePhase: 'follicular',
        nextPeriodWindow: {
          startDate: '2026-07-28',
          endDate: '2026-08-03',
        },
        periodDates: {
          startDate: '2026-07-01',
          endDate: '2026-07-05',
        },
        moodTag: 'good',
        symptomTags: ['headache', 'fatigue'],
        energyLevel: 4,
        conditionCode: 'comfortable',
        carePreferences: ['listen', 'warmth'],
        note: '오늘은 일찍 쉬고 싶어요.',
      },
      metadataDate,
    );

    expect(fields).toHaveLength(9);
    expect(fields.map(field => field.key)).toEqual([
      'cyclePhase',
      'nextPeriodWindow',
      'periodDates',
      'moodTag',
      'symptomTags',
      'energyLevel',
      'conditionCode',
      'carePreferences',
      'note',
    ]);
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'symptomTags', value: '두통 · 피로' }),
        expect.objectContaining({ key: 'energyLevel', value: '4/5 · 좋음' }),
        expect.objectContaining({
          key: 'note',
          value: '오늘은 일찍 쉬고 싶어요.',
        }),
      ]),
    );
  });

  it('알 수 없는 태그와 실재하지 않는 날짜를 원문 그대로 표시하지 않는다', () => {
    const fields = buildPartnerSharedFields(
      {
        ...metadata,
        moodTag: '<unexpected>',
        symptomTags: ['unknown-symptom'],
        carePreferences: ['unknown-care'],
        periodDates: { startDate: '2026-02-30' },
        nextPeriodWindow: {
          startDate: '2026-13-01',
          endDate: '2026-13-02',
        },
      },
      metadataDate,
    );

    expect(fields).toEqual([]);
  });

  it('36시간이 지난 projection과 잘못된 시각을 오래된 정보로 표시한다', () => {
    const now = new Date('2026-07-15T12:00:00.001Z');
    const justStale = getPartnerProjectionFreshness(metadata, now);
    expect(justStale.stale).toBe(true);

    const fresh = getPartnerProjectionFreshness(
      {
        ...metadata,
        generatedAt: new Date(
          now.getTime() - PARTNER_PROJECTION_STALE_AFTER_MS,
        ).toISOString(),
      },
      now,
    );
    expect(fresh.stale).toBe(false);

    expect(
      getPartnerProjectionFreshness(
        { ...metadata, generatedAt: 'not-a-date' },
        now,
      ),
    ).toEqual({ label: '업데이트 시각 확인 불가', stale: true });
  });

  it('과거 daily log와 cycle 계산값을 오늘 상태나 케어 입력으로 재표시하지 않는다', () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    const staleSource: RemotePartnerProjection = {
      ...metadata,
      generatedAt: '2026-07-14T11:59:00.000Z',
      dailyLogDate: '2026-07-13',
      cycleAsOfDate: '2026-07-13',
      periodDates: { startDate: '2026-07-01' },
      cyclePhase: 'luteal',
      nextPeriodWindow: {
        startDate: '2026-07-28',
        endDate: '2026-08-03',
      },
      moodTag: 'very-low',
      conditionCode: 'needs-space',
      carePreferences: ['quiet-space'],
      note: '어제 기록',
    };

    expect(getSafePartnerProjectionForToday(staleSource, now)).toEqual({
      ownerUid: 'partner-a',
      pairId: 'pair-a',
      generatedAt: '2026-07-14T11:59:00.000Z',
      cycleAsOfDate: '2026-07-13',
      dailyLogDate: '2026-07-13',
      periodDates: { startDate: '2026-07-01' },
    });
    expect(buildPartnerSharedFields(staleSource, now)).toEqual([
      {
        key: 'periodDates',
        label: '공유한 생리 날짜',
        value: '7월 1일 시작',
      },
    ]);
    expect(getPartnerProjectionFreshness(staleSource, now).stale).toBe(true);
  });

  it('source LocalDate가 없는 legacy daily 값은 기본 비공개로 처리한다', () => {
    const legacy: RemotePartnerProjection = {
      ownerUid: 'partner-a',
      pairId: 'pair-a',
      generatedAt: '2026-07-14T11:59:00.000Z',
      moodTag: 'good',
    };

    expect(
      buildPartnerSharedFields(legacy, new Date('2026-07-14T12:00:00.000Z')),
    ).toEqual([]);
    expect(
      getPartnerProjectionFreshness(
        legacy,
        new Date('2026-07-14T12:00:00.000Z'),
      ).stale,
    ).toBe(true);
  });

  it.each([
    ['period-starting', '생리가 시작된 날이에요'],
    ['period-in-progress', '생리 진행 중이에요'],
    ['period-ending', '생리 마무리 시기에 가까워요'],
    ['post-period', '생리가 끝난 직후예요'],
    ['fertile-window', '가임 가능성이 높은 시기예요'],
    ['pre-period', '생리 시작 전이에요'],
  ] as const)('파트너의 %s 상태를 홈 요약으로 표현한다', (cycleStatus, title) => {
    expect(
      buildPartnerTodaySummary(
        {
          ...metadata,
          cyclePhase:
            cycleStatus === 'fertile-window' ? 'ovulatory' : 'follicular',
          cycleStatus,
          moodTag: 'good',
          conditionCode: 'comfortable',
        },
        metadataDate,
      ),
    ).toMatchObject({
      cycleTitle: title,
      conditionTitle: '기분이 좋아요',
      conditionTags: ['편안해요'],
    });
  });
});

describe('국면 문구 커버리지', () => {
  it('파트너에게 나갈 수 있는 모든 국면에 문구가 있다', () => {
    const phases = [
      'menstrual',
      'follicular',
      'ovulatory',
      'luteal',
      'unknown',
    ] as const;

    for (const cyclePhase of phases) {
      const fields = buildPartnerSharedFields(
        { ...metadata, cyclePhase },
        metadataDate,
      );
      const phaseField = fields.find(field => field.key === 'cyclePhase');
      expect(phaseField).toBeDefined();
      expect(phaseField?.value).toBeTruthy();
      expect(String(phaseField?.value)).not.toContain('undefined');
    }
  });
});
