import {
  EMOTION_CODES,
  MAX_EMOTIONS_PER_LOG,
  type EmotionCode,
} from '@cyclepair/product-core';

export { EMOTION_CODES, MAX_EMOTIONS_PER_LOG };
export type { EmotionCode };

export function isEmotionCode(value: unknown): value is EmotionCode {
  return (
    typeof value === 'string' &&
    (EMOTION_CODES as readonly string[]).includes(value)
  );
}

/** 이미 고른 감정을 다시 누르면 빼고, 아니면 상한 안에서 더한다. */
export function toggleEmotion(
  current: readonly EmotionCode[] | undefined,
  code: EmotionCode,
): readonly EmotionCode[] | undefined {
  const selected = current ?? [];
  if (selected.includes(code)) {
    const next = selected.filter(value => value !== code);
    return next.length > 0 ? next : undefined;
  }
  if (selected.length >= MAX_EMOTIONS_PER_LOG) return selected;
  return [...selected, code];
}
