import {parseLocalDate} from '@cyclepair/product-core';
import type {DailyHistoryEntry} from './CyclePairStore';
import {observedRecordSummary} from './observedRecordSummary';
const today = parseLocalDate('2026-10-25');
const entry = (localDate: string, emotions?: DailyHistoryEntry['checkIn']['emotions'], updatedAt?: string): DailyHistoryEntry => ({
  localDate, checkIn: {symptoms: [], periodStarted: false, periodEnded: false, ...(emotions ? {emotions} : {})}, ...(updatedAt ? {updatedAt} : {}),
});
describe('observed record summary', () => {
  it('shows all seven real dates and no invented mood in an empty week', () => {
    const summary = observedRecordSummary([], today);
    expect(summary.days.map(day => day.localDate)).toEqual(['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25']);
    expect(summary.recordedDays).toBe(0);
    expect(summary.missingDays).toBe(7);
    expect(summary.emotions).toEqual([]);
  });
  it('counts days with records separately from days with selected moods', () => {
    const summary = observedRecordSummary([entry('2026-10-19'),entry('2026-10-21',['calm']),entry('2026-10-25',['drained'])], today);
    expect(summary.recordedDays).toBe(3);
    expect(summary.missingDays).toBe(4);
    expect(summary.moodRecordedDays).toBe(2);
    expect(summary.days[0]).toMatchObject({recorded:true,emotions:[]});
    expect(summary.emotions).toEqual([{code:'calm',days:1},{code:'drained',days:1}]);
  });
  it('counts a multi-choice feeling once per day without interpreting it', () => {
    const summary = observedRecordSummary([entry('2026-10-25',['calm','anxious','calm'])], today);
    expect(summary.moodRecordedDays).toBe(1);
    expect(summary.emotions).toEqual([{code:'calm',days:1},{code:'anxious',days:1}]);
  });
  it('does not turn old, future or invalid dates into current observations', () => {
    const summary = observedRecordSummary([entry('2026-10-18',['happy']),entry('2026-10-26',['happy']),entry('2026-02-30',['happy']),entry('2026-1-2',['happy']),entry('2026-10-25',['calm'])], today);
    expect(summary.recordedDays).toBe(1);
    expect(summary.emotions).toEqual([{code:'calm',days:1}]);
  });
  it('uses the latest updated record for duplicate dates without double counting', () => {
    const summary = observedRecordSummary([entry('2026-10-25',['calm'],'2026-10-25T12:00:00.000Z'),entry('2026-10-25',['anxious'],'2026-10-25T08:00:00.000Z')], today);
    expect(summary.recordedDays).toBe(1);
    expect(summary.emotions).toEqual([{code:'calm',days:1}]);
  });
  it('does not mutate the provided private history or emotion arrays', () => {
    const source = [entry('2026-10-25',['calm','happy'])];
    const before = JSON.stringify(source);
    observedRecordSummary(source,today);
    expect(JSON.stringify(source)).toBe(before);
  });
});
