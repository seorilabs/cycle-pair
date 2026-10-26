import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseLocalDate } from './local-date.js';
import { buildRecordedPeriods, type PeriodBoundary } from './period-history.js';

const boundary = (
  date: string,
  started = false,
  ended = false,
): PeriodBoundary => ({ date: parseLocalDate(date), started, ended });

test('pairs recorded boundaries across a month and a leap day', () => {
  assert.deepEqual(
    buildRecordedPeriods([
      boundary('2024-02-28', true),
      boundary('2024-03-02', false, true),
    ]),
    [{ start: '2024-02-28', end: '2024-03-02', lengthDays: 4 }],
  );
});
test('keeps a one-day period when both markers are selected', () => {
  assert.deepEqual(buildRecordedPeriods([boundary('2026-10-05', true, true)]), [
    { start: '2026-10-05', end: '2026-10-05', lengthDays: 1 },
  ]);
});
test('does not invent an end for an interrupted or incomplete period', () => {
  assert.deepEqual(
    buildRecordedPeriods([
      boundary('2026-09-01', true),
      boundary('2026-10-01', true),
      boundary('2026-10-05', false, true),
      boundary('2026-11-01', true),
    ]),
    [
      { start: '2026-09-01' },
      { start: '2026-10-01', end: '2026-10-05', lengthDays: 5 },
      { start: '2026-11-01' },
    ],
  );
});
test('preserves unmatched end markers without extending a previous period', () => {
  assert.deepEqual(
    buildRecordedPeriods([
      boundary('2026-10-02', false, true),
      boundary('2026-10-05', true),
      boundary('2026-10-07', false, true),
      boundary('2026-10-09', false, true),
    ]),
    [
      { end: '2026-10-02' },
      { start: '2026-10-05', end: '2026-10-07', lengthDays: 3 },
      { end: '2026-10-09' },
    ],
  );
});
test('orders and combines duplicate day boundaries, ignoring unmarked dates', () => {
  assert.deepEqual(
    buildRecordedPeriods([
      boundary('2026-10-04', false, true),
      boundary('2026-10-01'),
      boundary('2026-10-04', true),
    ]),
    [{ start: '2026-10-04', end: '2026-10-04', lengthDays: 1 }],
  );
});
