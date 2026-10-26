import { createInitialState } from './CyclePairStore';
import { recordedPeriods, cycleSetupForPeriodChange } from './periodCalendar';
const state = () => ({
  ...createInitialState(),
  isLogger: true,
  hasCycleSeed: true,
  currentLocalDate: '2026-10-27',
  seed: {
    lastPeriodStart: '2026-10-01',
    lastPeriodEnd: '2026-10-05',
    averageCycleLength: 28,
    averagePeriodLength: 5,
  },
  dailyHistory: [
    {
      localDate: '2026-09-01',
      checkIn: { symptoms: [], periodStarted: true, periodEnded: false },
    },
    {
      localDate: '2026-09-05',
      checkIn: { symptoms: [], periodStarted: false, periodEnded: true },
    },
  ],
});
it('shows all historical periods and keeps the setup dates until they are edited', () => {
  expect(recordedPeriods(state())).toEqual([
    { start: '2026-09-01', end: '2026-09-05', lengthDays: 5 },
    { start: '2026-10-01', end: '2026-10-05', lengthDays: 5 },
  ]);
});
it('removes a cleared latest start from the summary instead of resurrecting it from the seed', () => {
  const edited = {
    localDate: '2026-10-01',
    periodStarted: false,
    periodEnded: false,
  };
  expect(recordedPeriods(state(), edited)).toEqual([
    { start: '2026-09-01', end: '2026-09-05', lengthDays: 5 },
    { end: '2026-10-05' },
  ]);
  expect(cycleSetupForPeriodChange(state(), edited).seed).toMatchObject({
    lastPeriodStart: '2026-09-01',
    lastPeriodEnd: '2026-09-05',
  });
});
it('does not fabricate a prediction when no recorded start remains', () => {
  expect(
    cycleSetupForPeriodChange(
      { ...state(), dailyHistory: [] },
      { localDate: '2026-10-01', periodStarted: false, periodEnded: false },
    ).hasCycleSeed,
  ).toBe(false);
});
it('supports a one-day end and removes a cleared end without changing the start', () => {
  expect(
    cycleSetupForPeriodChange(state(), {
      localDate: '2026-10-01',
      periodStarted: true,
      periodEnded: true,
    }).seed.lastPeriodEnd,
  ).toBe('2026-10-01');
  expect(
    cycleSetupForPeriodChange(state(), {
      localDate: '2026-10-05',
      periodStarted: false,
      periodEnded: false,
    }).seed.lastPeriodEnd,
  ).toBeUndefined();
});
it('keeps condition-only mode free of period projections', () => {
  expect(recordedPeriods({ ...state(), isLogger: false })).toEqual([]);
  expect(
    cycleSetupForPeriodChange({ ...state(), isLogger: false }).hasCycleSeed,
  ).toBe(false);
});
