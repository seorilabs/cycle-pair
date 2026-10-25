import {addDays, isLocalDate, type LocalDate} from '@cyclepair/product-core';
import type {DailyHistoryEntry} from './CyclePairStore';
import {EMOTION_CODES, isEmotionCode, type EmotionCode} from './emotions';

export interface ObservedDay {
  readonly localDate: LocalDate;
  readonly recorded: boolean;
  readonly emotions: readonly EmotionCode[];
}
export interface ObservedRecordSummary {
  readonly days: readonly ObservedDay[];
  readonly recordedDays: number;
  readonly missingDays: number;
  readonly moodRecordedDays: number;
  readonly emotions: readonly {readonly code: EmotionCode; readonly days: number}[];
}
/** Summarizes only the signed-in user's explicitly recorded local dates. */
export function observedRecordSummary(
  history: readonly DailyHistoryEntry[],
  through: LocalDate,
): ObservedRecordSummary {
  const start = addDays(through, -6);
  const byDate = new Map<string, DailyHistoryEntry>();
  for (const entry of history) {
    if (!isLocalDate(entry.localDate) || entry.localDate < start || entry.localDate > through) continue;
    const previous = byDate.get(entry.localDate);
    const incomingTime = entry.updatedAt ? Date.parse(entry.updatedAt) : NaN;
    const previousTime = previous?.updatedAt ? Date.parse(previous.updatedAt) : NaN;
    if (!previous || !Number.isFinite(previousTime) ||
      !Number.isFinite(incomingTime) || incomingTime >= previousTime) {
      byDate.set(entry.localDate, entry);
    }
  }
  const days = Array.from({length: 7}, (_, offset): ObservedDay => {
    const localDate = addDays(start, offset);
    const entry = byDate.get(localDate);
    return {
      localDate,
      recorded: entry !== undefined,
      emotions: [...new Set(entry?.checkIn.emotions?.filter(isEmotionCode) ?? [])],
    };
  });
  const recordedDays = days.filter(day => day.recorded).length;
  const moodRecordedDays = days.filter(day => day.emotions.length > 0).length;
  const emotions = EMOTION_CODES.flatMap(code => {
    const count = days.filter(day => day.emotions.includes(code)).length;
    return count ? [{code, days: count}] : [];
  });
  return {days, recordedDays, missingDays: 7 - recordedDays, moodRecordedDays, emotions};
}
