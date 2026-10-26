import {
  mergePeriodBoundary,
  hasDailyLogContent,
  sameSetupFacts,
} from './periodBoundaryChange';
import { SENSITIVE_HEALTH_CONSENT_VERSION } from '../../domain/privacy/SensitiveHealthConsent';
const setup = {
  recordsCycle: true,
  consentAcceptedAt: '2026-10-01T00:00:00.000Z',
  consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
};

it('changes only period markers and keeps the server note and emotions', () => {
  expect(
    mergePeriodBoundary(
      { note: 'server note', emotionTags: ['calm'], periodStarted: true },
      { periodStarted: false, periodEnded: true },
    ),
  ).toEqual({
    note: 'server note',
    emotionTags: ['calm'],
    periodStarted: false,
    periodEnded: true,
  });
});
it('does not delete a note or an unknown field when both markers are cleared', () => {
  expect(
    hasDailyLogContent({
      note: 'saved note',
      periodStarted: false,
      periodEnded: false,
    }),
  ).toBe(true);
  expect(hasDailyLogContent({ futureUserField: null })).toBe(true);
  expect(
    hasDailyLogContent({
      schemaVersion: 3,
      localDate: '2026-10-01',
      periodStarted: false,
      periodEnded: false,
      symptomTags: [],
    }),
  ).toBe(false);
});
it('accepts presentation-only changes but detects changed cycle facts or consent', () => {
  const cycle = {
    asOfDate: '2026-10-01',
    averageCycleLength: 28,
    averagePeriodLength: 5,
    periodDates: { startDate: '2026-10-01' },
  };
  expect(
    sameSetupFacts(
      { ...setup, cycle: { ...cycle, asOfDate: '2026-10-26' } },
      { ...setup, cycle },
    ),
  ).toBe(true);
  expect(
    sameSetupFacts(
      {
        ...setup,
        cycle: { ...cycle, periodDates: { startDate: '2026-10-02' } },
      },
      { ...setup, cycle },
    ),
  ).toBe(false);
  expect(sameSetupFacts({ ...setup, consentVersion: 'old' }, setup)).toBe(
    false,
  );
});
