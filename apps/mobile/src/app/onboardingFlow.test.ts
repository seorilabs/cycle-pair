import {
  onboardingSteps,
  previousSetupStep,
  setupCycleSeed,
} from './onboardingFlow';
import type { SetupDraft } from '../screens/SetupScreen';
const draft: SetupDraft = {
  isLogger: true,
  consentAccepted: true,
  purposeChosen: true,
  step: 'consent',
  dateKnown: false,
  cycleKnown: false,
  periodKnown: false,
  seed: {
    lastPeriodStart: '2026-10-20',
    averageCycleLength: 28,
    averagePeriodLength: 5,
  },
};
describe('one question onboarding', () => {
  it('컨디션 분기에는 생리 날짜와 길이 질문이 없다', () => {
    expect(onboardingSteps(false)).toEqual(['consent', 'tutorial', 'share']);
    expect(
      previousSetupStep({ ...draft, isLogger: false, step: 'tutorial' }),
    ).toBe('consent');
  });
  it('주기 분기는 날짜와 간격과 기간을 하나씩 물으며 뒤로 이동한다', () => {
    expect(onboardingSteps(true)).toEqual([
      'consent',
      'date',
      'cycle',
      'period',
      'tutorial',
      'share',
    ]);
    expect(previousSetupStep({ ...draft, step: 'cycle' })).toBe('date');
    expect(previousSetupStep(draft)).toBeNull();
  });
  it('건너뛴 항목이 있으면 기본 날짜와 수치를 예측 자료로 저장하지 않는다', () => {
    expect(setupCycleSeed(draft)).toBeUndefined();
    expect(
      setupCycleSeed({ ...draft, dateKnown: true, cycleKnown: true }),
    ).toBeUndefined();
    expect(
      setupCycleSeed({
        ...draft,
        isLogger: false,
        dateKnown: true,
        cycleKnown: true,
        periodKnown: true,
      }),
    ).toBeUndefined();
    expect(
      setupCycleSeed({
        ...draft,
        dateKnown: true,
        cycleKnown: true,
        periodKnown: true,
      }),
    ).toEqual(draft.seed);
  });
});
