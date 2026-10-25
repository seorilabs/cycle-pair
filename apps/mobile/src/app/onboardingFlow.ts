import type { CycleSeed } from './CyclePairStore';
import type { SetupDraft } from '../screens/SetupScreen';
export type SetupStep =
  | 'consent'
  | 'date'
  | 'cycle'
  | 'period'
  | 'tutorial'
  | 'share';
export function onboardingSteps(isLogger: boolean): readonly SetupStep[] {
  return [
    'consent',
    ...(isLogger ? (['date', 'cycle', 'period'] as const) : []),
    'tutorial',
    'share',
  ];
}
export function previousSetupStep(draft: SetupDraft): SetupStep | null {
  const steps = onboardingSteps(draft.isLogger);
  return steps[steps.indexOf(draft.step) - 1] ?? null;
}
export function setupCycleSeed(draft: SetupDraft): CycleSeed | undefined {
  return draft.isLogger &&
    draft.dateKnown &&
    draft.cycleKnown &&
    draft.periodKnown
    ? draft.seed
    : undefined;
}
