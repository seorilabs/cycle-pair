export const SENSITIVE_HEALTH_CONSENT_VERSION = '2026-08-09-v1' as const;

export function hasCurrentSensitiveHealthConsent(
  consentAcceptedAt: string | undefined,
  consentVersion: string | undefined,
): boolean {
  return (
    consentAcceptedAt !== undefined &&
    consentVersion === SENSITIVE_HEALTH_CONSENT_VERSION
  );
}
