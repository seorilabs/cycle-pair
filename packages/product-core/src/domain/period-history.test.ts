import { expect, test } from 'vitest';
import { parseLocalDate } from './local-date.js';
import { buildRecordedPeriods, type PeriodBoundary } from './period-history.js';

const boundary = (
  date: string,
  started = false,
  ended = false,
): PeriodBoundary => ({ date: parseLocalDate(date), started, ended });

test('pairs recorded boundaries across a month and a leap day', () => {
  expect(
    buildRecordedPeriods([
      boundary('2024-02-28', true),
      boundary('2024-03-02', false, true),
    ]),
  ).toEqual([{ start: '2024-02-28', end: '2024-03-02', lengthDays: 4 }]);
});
test('keeps a one-day period when both markers are selected', () => {
  expect(buildRecordedPeriods([boundary('2026-10-05', true, true)])).toEqual([
    { start: '2026-10-05', end: '2026-10-05', lengthDays: 1 },
  ]);
});
test('does not invent an end for an interrupted or incomplete period', () => {
  expect(
    buildRecordedPeriods([
      boundary('2026-09-01', true),
      boundary('2026-10-01', true),
      boundary('2026-10-05', false, true),
      boundary('2026-11-01', true),
    ]),
  ).toEqual([
    { start: '2026-09-01' },
    { start: '2026-10-01', end: '2026-10-05', lengthDays: 5 },
    { start: '2026-11-01' },
  ]);
});
test('preserves unmatched end markers without extending a previous period', () => {
  expect(
    buildRecordedPeriods([
      boundary('2026-10-02', false, true),
      boundary('2026-10-05', true),
      boundary('2026-10-07', false, true),
      boundary('2026-10-09', false, true),
    ]),
  ).toEqual([
    { end: '2026-10-02' },
    { start: '2026-10-05', end: '2026-10-07', lengthDays: 3 },
    { end: '2026-10-09' },
  ]);
});
test('orders and combines duplicate day boundaries, ignoring unmarked dates', () => {
  expect(
    buildRecordedPeriods([
      boundary('2026-10-04', false, true),
      boundary('2026-10-01'),
      boundary('2026-10-04', true),
    ]),
  ).toEqual([{ start: '2026-10-04', end: '2026-10-04', lengthDays: 1 }]);
});
