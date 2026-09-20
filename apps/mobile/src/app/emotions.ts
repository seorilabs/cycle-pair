import {
  EMOTION_CODES,
  MAX_EMOTIONS_PER_LOG,
  type EmotionCode,
} from '@cyclepair/product-core';

export { EMOTION_CODES, MAX_EMOTIONS_PER_LOG };
export type { EmotionCode };

/**
 * 표시 문구는 여기 한 곳에만 둔다. 기록은 코드로 저장한다.
 *
 * 이전에는 화면이 한국어 라벨을 그대로 저장해서, 라벨을 코드로 되돌리는 표가
 * cycleViewModel 과 backendPayloads 양쪽에 중복돼 있었다. 저장값을 코드로 옮겨
 * 그 표를 없앴다.
 */
export const EMOTION_LABELS: Readonly<Record<EmotionCode, string>> =
  Object.freeze({
    calm: '평온',
    happy: '기쁨',
    affectionate: '애정',
    anxious: '불안',
    irritable: '예민',
    hurt: '서운',
    lonely: '외로움',
    drained: '지침',
    other: '그 외',
  });

export function emotionLabel(code: EmotionCode): string {
  return EMOTION_LABELS[code];
}

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
