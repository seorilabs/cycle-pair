import { buildCalendarMonthRows, shiftCalendarMonth } from './calendarMonth';

describe('calendar month rows', () => {
  it('keeps every week at seven columns on iPhone-sized layouts', () => {
    const rows = buildCalendarMonthRows(2026, 8);

    expect(rows).toHaveLength(6);
    expect(rows.every(row => row.length === 7)).toBe(true);
    expect(rows[0]).toEqual([
      '2026-07-26',
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
    ]);
  });

  it('places 2026-08-24 in the Monday column', () => {
    const rows = buildCalendarMonthRows(2026, 8);

    expect(rows[4]?.[1]).toBe('2026-08-24');
  });

  it('keeps every Gregorian month aligned from 1900 through 2100', () => {
    for (let year = 1900; year <= 2100; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const rows = buildCalendarMonthRows(year, month);
        const days = rows.flat();
        const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
        const firstDayIndex = days.indexOf(firstDay as (typeof days)[number]);
        const expectedFirstDayIndex = new Date(
          Date.UTC(year, month - 1, 1),
        ).getUTCDay();
        const expectedDaysInMonth = new Date(
          Date.UTC(year, month, 0),
        ).getUTCDate();

        expect(rows).toHaveLength(6);
        expect(rows.every(row => row.length === 7)).toBe(true);
        expect(days).toHaveLength(42);
        expect(firstDayIndex).toBe(expectedFirstDayIndex);
        expect(
          days.filter(day =>
            day.startsWith(
              `${year}-${String(month).padStart(2, '0')}-`,
            ),
          ),
        ).toHaveLength(expectedDaysInMonth);
        expect(
          days.map(day => new Date(`${day}T00:00:00.000Z`).getUTCDay()),
        ).toEqual(Array.from({ length: 42 }, (_value, index) => index % 7));
        expect(
          days.slice(1).every(
            (day, index) =>
              new Date(`${day}T00:00:00.000Z`).getTime() -
                new Date(`${days[index]}T00:00:00.000Z`).getTime() ===
              86_400_000,
          ),
        ).toBe(true);
      }
    }
  });

  it('moves across year boundaries without using local Date arithmetic', () => {
    expect(shiftCalendarMonth({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    });
    expect(shiftCalendarMonth({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    });
    expect(() => shiftCalendarMonth({ year: 2026, month: 8 }, 0.5)).toThrow(
      'integer',
    );
  });
});
