import type {
  ConditionCode,
  HelpPreference,
} from '../../../packages/product-core/src/domain/models';

export interface ShareOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface ConditionShareDraft {
  readonly condition: ConditionCode | null;
  readonly helpPreference: HelpPreference | null;
}

export const CONDITION_OPTIONS: readonly ShareOption<ConditionCode>[] = [
  { value: 'comfortable', label: '편안해요' },
  { value: 'tired', label: '피곤해요' },
  { value: 'low-energy', label: '기운이 없어요' },
  { value: 'needs-space', label: '공간이 필요해요' },
];

export const HELP_OPTIONS: readonly ShareOption<HelpPreference>[] = [
  { value: 'quiet-space', label: '조용히 쉬게 해줘요' },
  { value: 'warmth', label: '따뜻하게 챙겨줘요' },
  { value: 'listen', label: '그냥 들어줘요' },
  { value: 'no-action', label: '평소처럼 대해줘요' },
];

const conditionValues = new Set(CONDITION_OPTIONS.map(option => option.value));
const helpValues = new Set(HELP_OPTIONS.map(option => option.value));

export const EMPTY_SHARE_DRAFT: ConditionShareDraft = Object.freeze({
  condition: null,
  helpPreference: null,
});

export function isCompleteShareDraft(
  draft: ConditionShareDraft,
): draft is {
  readonly condition: ConditionCode;
  readonly helpPreference: HelpPreference;
} {
  return draft.condition !== null && draft.helpPreference !== null;
}

export function parseShareDraft(value: unknown): ConditionShareDraft {
  if (typeof value !== 'object' || value === null) return EMPTY_SHARE_DRAFT;
  const candidate = value as Record<string, unknown>;
  const condition =
    typeof candidate.condition === 'string' &&
    conditionValues.has(candidate.condition as ConditionCode)
      ? (candidate.condition as ConditionCode)
      : null;
  const helpPreference =
    typeof candidate.helpPreference === 'string' &&
    helpValues.has(candidate.helpPreference as HelpPreference)
      ? (candidate.helpPreference as HelpPreference)
      : null;
  return { condition, helpPreference };
}

function labelFor<T extends string>(
  options: readonly ShareOption<T>[],
  value: T,
): string {
  return options.find(option => option.value === value)?.label ?? value;
}

export function buildConditionShareMessage(
  draft: ConditionShareDraft,
): string {
  if (!isCompleteShareDraft(draft)) {
    throw new Error('condition and help preference are required');
  }
  const condition = labelFor(CONDITION_OPTIONS, draft.condition);
  const help = labelFor(HELP_OPTIONS, draft.helpPreference);
  return [
    `오늘 내 컨디션은 “${condition}”예요.`,
    `지금은 “${help}”`,
    '',
    '사이클 페어에서 내가 선택해 공유했어요.',
  ].join('\n');
}
