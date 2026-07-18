import { buildCalendarCycleRanges } from './calendarCycleRanges';

const baseInput = {
  recordsOwnCycle: true,
  ownPeriodStart: '2026-07-01',
  averagePeriodLength: 5,
  paired: false,
};

describe('calendar cycle ranges', () => {
  it('명시적인 종료일이 있으면 전체 구간을 실제 기록으로 표시한다', () => {
    expect(
      buildCalendarCycleRanges({
        ...baseInput,
        ownPeriodEnd: '2026-07-04',
      }),
    ).toEqual({
      ownActual: { start: '2026-07-01', end: '2026-07-04' },
    });
  });

  it('종료일이 없으면 시작일만 실제이고 나머지는 추정 구간으로 분리한다', () => {
    expect(buildCalendarCycleRanges(baseInput)).toEqual({
      ownActual: { start: '2026-07-01', end: '2026-07-01' },
      ownInferred: { start: '2026-07-02', end: '2026-07-05' },
    });
  });

  it('파트너의 실제 날짜와 다음 예상 범위를 별도 구간으로 만든다', () => {
    expect(
      buildCalendarCycleRanges({
        ...baseInput,
        paired: true,
        partnerPeriodDates: {
          startDate: '2026-07-10',
          endDate: '2026-07-12',
        },
        partnerNextPeriodWindow: {
          startDate: '2026-08-01',
          endDate: '2026-08-07',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        partnerActual: { start: '2026-07-10', end: '2026-07-12' },
        partnerPrediction: { start: '2026-08-01', end: '2026-08-07' },
      }),
    );
  });

  it('실재하지 않거나 역전된 파트너 날짜는 범위로 사용하지 않는다', () => {
    expect(
      buildCalendarCycleRanges({
        ...baseInput,
        recordsOwnCycle: false,
        paired: true,
        partnerPeriodDates: { startDate: '2026-02-30' },
        partnerNextPeriodWindow: {
          startDate: '2026-08-10',
          endDate: '2026-08-01',
        },
      }),
    ).toEqual({});
  });
});
