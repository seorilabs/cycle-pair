import { buildCalendarMonthRows } from './calendarMonth';

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
});
