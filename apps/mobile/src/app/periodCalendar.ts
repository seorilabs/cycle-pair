import {
  buildRecordedPeriods,
  calculateAverageCycleLength,
  createCycle,
  isLocalDate,
  parseLocalDate,
  type PeriodBoundary,
  type RecordedPeriod,
} from '@cyclepair/product-core';
import type { CyclePairState, CycleSeed } from './CyclePairStore';
import { SELF_MEMBER_ID } from './memberIds';

export interface PeriodEdit {
  readonly localDate: string;
  readonly periodStarted: boolean;
  readonly periodEnded: boolean;
}
export type PeriodCalendarState = Pick<
  CyclePairState,
  'isLogger' | 'hasCycleSeed' | 'seed' | 'dailyHistory' | 'currentLocalDate'
>;
export function recordedPeriods(
  state: PeriodCalendarState,
  edit?: PeriodEdit,
): readonly RecordedPeriod[] {
  if (!state.isLogger) return [];
  const byDate = new Map<string, PeriodBoundary>();
  for (const entry of state.dailyHistory) {
    if (
      isLocalDate(entry.localDate) &&
      entry.localDate <= state.currentLocalDate
    )
      byDate.set(entry.localDate, {
        date: entry.localDate,
        started: entry.checkIn.periodStarted,
        ended: entry.checkIn.periodEnded,
      });
  }
  const addSeed = (date: string | undefined, kind: 'started' | 'ended') => {
    if (
      !state.hasCycleSeed ||
      !isLocalDate(date) ||
      date > state.currentLocalDate
    )
      return;
    const previous = byDate.get(date) ?? { date, started: false, ended: false };
    byDate.set(date, { ...previous, [kind]: true });
  };
  addSeed(state.seed.lastPeriodStart, 'started');
  addSeed(state.seed.lastPeriodEnd, 'ended');
  if (
    edit &&
    isLocalDate(edit.localDate) &&
    edit.localDate <= state.currentLocalDate
  )
    byDate.set(edit.localDate, {
      date: edit.localDate,
      started: edit.periodStarted,
      ended: edit.periodEnded,
    });
  return buildRecordedPeriods([...byDate.values()]);
}

export function cycleSetupForPeriodChange(
  state: PeriodCalendarState,
  edit?: PeriodEdit,
): { hasCycleSeed: boolean; seed: CycleSeed } {
  const periods = recordedPeriods(state, edit);
  const starts = periods.flatMap(p => (p.start ? [p.start] : []));
  const start = starts.at(-1);
  const average = calculateAverageCycleLength(
    starts.map(date =>
      createCycle({
        id: `observed-${date}`,
        memberId: SELF_MEMBER_ID,
        startedOn: parseLocalDate(date),
      }),
    ),
  );
  const hasCycleSeed = Boolean(
    start && (average !== null || state.hasCycleSeed),
  );
  const end = start ? periods.find(p => p.start === start)?.end : undefined;
  return {
    hasCycleSeed,
    seed: hasCycleSeed
      ? {
          ...state.seed,
          lastPeriodStart: start ?? state.seed.lastPeriodStart,
          lastPeriodEnd: end,
          averageCycleLength: average ?? state.seed.averageCycleLength,
        }
      : state.seed,
  };
}
