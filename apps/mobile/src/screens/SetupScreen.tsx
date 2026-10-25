import React, { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { parseLocalDate } from '@cyclepair/product-core';
import {
  type CycleSeed,
  type CyclePairState,
  useCyclePair,
} from '../app/CyclePairStore';
import {
  onboardingSteps,
  setupCycleSeed,
  type SetupStep,
} from '../app/onboardingFlow';
import { AppIcon } from '../components/AppArtwork';
import { LocalDatePickerField } from '../components/LocalDatePickerField';
import {
  Body,
  Card,
  Chip,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Stepper,
  TextButton,
  Title,
} from '../components/Ui';
import {
  hasCurrentSensitiveHealthConsent,
  SENSITIVE_HEALTH_CONSENT_VERSION,
} from '../domain/privacy/SensitiveHealthConsent';
import { useI18n } from '../i18n/I18nProvider';
import { colors, radius, spacing } from '../theme';

export interface SetupDraft {
  readonly isLogger: boolean;
  readonly seed: CycleSeed;
  readonly consentAccepted: boolean;
  readonly purposeChosen: boolean;
  readonly dateKnown: boolean;
  readonly cycleKnown: boolean;
  readonly periodKnown: boolean;
  readonly step: SetupStep;
}
export function createSetupDraft(state: CyclePairState): SetupDraft {
  return {
    isLogger: state.isLogger,
    seed: { ...state.seed },
    consentAccepted: hasCurrentSensitiveHealthConsent(
      state.sensitiveDataConsentAcceptedAt,
      state.sensitiveDataConsentVersion,
    ),
    purposeChosen: false,
    dateKnown: state.hasCycleSeed,
    cycleKnown: state.hasCycleSeed,
    periodKnown: state.hasCycleSeed,
    step: 'consent',
  };
}
export function SetupScreen({
  draft,
  onDraftChange,
  onBack,
  onStartPairing,
}: {
  draft: SetupDraft;
  onDraftChange(draft: SetupDraft): void;
  onBack(): void;
  onStartPairing(direction: 'send' | 'receive'): void;
}) {
  const { t, l, locale } = useI18n();
  const { backendBusy, backendError, completeSetup } = useCyclePair();
  const [saveAttempted, setSaveAttempted] = useState(false);
  const submitting = useRef(false);
  const steps = onboardingSteps(draft.isLogger);
  const position = steps.indexOf(draft.step);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(now.getDate()).padStart(2, '0')}`;
  const futureDate = draft.seed.lastPeriodStart > today;
  function next(change: Partial<SetupDraft> = {}) {
    onDraftChange({
      ...draft,
      ...change,
      step: steps[position + 1] ?? 'share',
    });
  }
  async function finish(direction?: 'send' | 'receive') {
    if (submitting.current || backendBusy || !draft.consentAccepted) return;
    submitting.current = true;
    setSaveAttempted(true);
    try {
      const seed = setupCycleSeed(draft);
      const saved = await completeSetup({
        isLogger: draft.isLogger,
        ...(seed ? { seed } : {}),
        consentAcceptedAt: new Date().toISOString(),
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      });
      if (saved && direction) onStartPairing(direction);
    } finally {
      submitting.current = false;
    }
  }
  const titles = {
    consent: 'Your records, your choice',
    date: 'When did your last period start?',
    cycle: 'How long is your usual cycle?',
    period: 'How many days does your period last?',
    tutorial: 'One small note is enough',
    share: draft.isLogger
      ? 'Someone you would like to share with?'
      : 'Do you have a partner code?',
  } as const;
  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <TextButton label={t('Back')} disabled={backendBusy} onPress={onBack} />
        <Text style={styles.progress}>
          {t('Make it yours')} {position + 1} / {steps.length}
        </Text>
      </View>
      <View
        style={styles.steps}
        accessible
        accessibilityLabel={t('Step {current} of {total}', {
          current: position + 1,
          total: steps.length,
        })}
      >
        {steps.map((step, index) => (
          <View
            key={step}
            style={[styles.segment, index <= position && styles.segmentDone]}
          />
        ))}
      </View>
      <Title>{t(titles[draft.step])}</Title>
      {draft.step === 'consent' ? (
        <>
          <View style={styles.quiet}>
            <AppIcon name="lock" />
            <Body muted style={styles.flex}>
              {t('Nothing is shared with a partner by default.')}
            </Body>
          </View>
          <Card style={styles.card}>
            <Text style={styles.label}>{t('Health information consent')}</Text>
            <Body>
              {t(
                draft.isLogger
                  ? 'Period dates, cycle details, the condition, mood and notes you enter are used to store your records and provide reference estimates.'
                  : 'The condition, mood and notes you enter are used to store and display your records. No period dates are requested.',
              )}
            </Body>
            <Body>
              {t(
                'Records are kept until you delete them. In Settings, request account deletion to stop health data use and delete your records. Partner sharing can be turned off for each item.',
              )}
            </Body>
            <Body muted>
              {t('Partner sharing is optional. Notes are shared only when you turn on note sharing.')}
            </Body>
            <TextButton
              label={t('Read the privacy policy')}
              onPress={() =>
                Linking.openURL(
                  `https://www.seorilabs.com${
                    locale === 'en' ? '/en' : ''
                  }/apps/cycle-pair/privacy/`,
                ).catch(() => undefined)
              }
            />
          </Card>
          <Body muted>{t('For people aged 17 and over.')}</Body>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={l('주기·컨디션 정보 이용 동의')}
            accessibilityState={{
              checked: draft.consentAccepted,
              disabled: backendBusy,
            }}
            disabled={backendBusy}
            testID="setup-consent"
            onPress={() =>
              onDraftChange({
                ...draft,
                consentAccepted: !draft.consentAccepted,
              })
            }
            style={[styles.consent, draft.consentAccepted && styles.selected]}
          >
            <Text style={styles.check}>
              {draft.consentAccepted ? '✓' : '□'}
            </Text>
            <Text style={[styles.label, styles.flex]}>
              {t('I consent to the health information use described above.')}
            </Text>
          </Pressable>
          <PrimaryButton
            testID="setup-next"
            label={t('Agree and continue')}
            disabled={backendBusy || !draft.consentAccepted}
            onPress={() => next()}
          />
          <TextButton
            label={t('Go back without agreeing')}
            onPress={onBack}
            disabled={backendBusy}
          />
        </>
      ) : null}
      {draft.step === 'date' ||
      draft.step === 'cycle' ||
      draft.step === 'period' ? (
        <>
          <Body muted>{t('It is okay to skip if you are unsure.')}</Body>
          <Card style={styles.card}>
            <AppIcon
              name={draft.step === 'date' ? 'calendar' : 'cycle'}
              size={36}
            />
            {draft.step === 'date' ? (
              <LocalDatePickerField
                accessibilityLabel={l('최근 생리 시작일')}
                maximumDate={parseLocalDate(today)}
                disabled={backendBusy}
                value={parseLocalDate(draft.seed.lastPeriodStart)}
                testID="last-period-start-date-picker"
                onChange={lastPeriodStart =>
                  onDraftChange({
                    ...draft,
                    dateKnown: true,
                    seed: { ...draft.seed, lastPeriodStart },
                  })
                }
              />
            ) : (
              <Stepper
                label={l(
                  draft.step === 'cycle' ? '다음 생리까지 보통' : '생리가 보통',
                )}
                value={
                  draft.step === 'cycle'
                    ? draft.seed.averageCycleLength
                    : draft.seed.averagePeriodLength
                }
                suffix={l('일')}
                min={draft.step === 'cycle' ? 21 : 2}
                max={draft.step === 'cycle' ? 45 : 10}
                disabled={backendBusy}
                onChange={value =>
                  onDraftChange({
                    ...draft,
                    seed: {
                      ...draft.seed,
                      ...(draft.step === 'cycle'
                        ? { averageCycleLength: value }
                        : { averagePeriodLength: value }),
                    },
                  })
                }
              />
            )}
          </Card>
          {draft.step === 'date' && futureDate ? (
            <Body style={styles.error}>
              {l('최근 생리 시작일은 오늘 이후로 설정할 수 없어요.')}
            </Body>
          ) : null}
          <Body muted>
            {t(
              'Reference estimates appear only when enough information is available.',
            )}
          </Body>
          <PrimaryButton
            label={t('Continue')}
            testID="setup-next"
            disabled={backendBusy || (draft.step === 'date' && futureDate)}
            onPress={() =>
              next({
                [draft.step === 'date'
                  ? 'dateKnown'
                  : draft.step === 'cycle'
                  ? 'cycleKnown'
                  : 'periodKnown']: true,
              })
            }
          />
          <TextButton
            label={t('Not sure, skip')}
            disabled={backendBusy}
            onPress={() =>
              next({
                [draft.step === 'date'
                  ? 'dateKnown'
                  : draft.step === 'cycle'
                  ? 'cycleKnown'
                  : 'periodKnown']: false,
              })
            }
          />
        </>
      ) : null}
      {draft.step === 'tutorial' ? (
        <>
          <Body muted>
            {t('Take a moment for yourself, at your own pace.')}
          </Body>
          <Card tone="primary" style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.label}>{t('Today’s note')}</Text>
              <Chip label={t('Example')} />
            </View>
            <View style={styles.quiet}>
              <AppIcon name="leaf" size={32} />
              <Text style={styles.label}>{t('Feeling calm')}</Text>
            </View>
            <Body>{t('I would love someone to listen today.')}</Body>
            <View style={styles.quiet}>
              <AppIcon name="lock" />
              <Body>{t('Only me')}</Body>
            </View>
          </Card>
          <Body muted>
            {t('Choose the body, mood or care details you want to record.')}
          </Body>
          <PrimaryButton
            testID="setup-next"
            label={t('Got it')}
            disabled={backendBusy}
            onPress={() => next()}
          />
        </>
      ) : null}
      {draft.step === 'share' ? (
        <>
          <Body muted>
            {t('Connecting is optional. You can keep this space for yourself.')}
          </Body>
          <Card tone="mint" style={styles.card}>
            <AppIcon name="pair" size={40} />
            <Text style={styles.label}>
              {t('Your own records. Your own choices.')}
            </Text>
            <Body>
              {t('Both people accept the connection and choose what to share.')}
            </Body>
          </Card>
          <PrimaryButton
            testID="setup-pair"
            disabled={backendBusy}
            label={t(
              backendBusy
                ? 'Saving…'
                : draft.isLogger
                ? 'See how to invite'
                : 'Enter a partner code',
            )}
            onPress={() => {
              finish(draft.isLogger ? 'send' : 'receive').catch(
                () => undefined,
              );
            }}
          />
          <SecondaryButton
            disabled={backendBusy}
            label={t(backendBusy ? 'Saving…' : 'Start on my own for now')}
            onPress={() => {
              finish().catch(() => undefined);
            }}
          />
        </>
      ) : null}
      {saveAttempted && backendError ? (
        <View accessibilityRole="alert" style={styles.card}>
          <Text style={styles.error}>{l(backendError)}</Text>
          <Body muted>
            {t('Your choices are still here. Try again when you are ready.')}
          </Body>
        </View>
      ) : null}
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingTop: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  progress: { color: colors.primaryDark, fontSize: 13 },
  steps: { flexDirection: 'row', gap: spacing.xs },
  segment: {
    height: 4,
    flex: 1,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  segmentDone: { backgroundColor: colors.primaryDark },
  quiet: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
  card: { gap: spacing.lg },
  label: { color: colors.text, fontSize: 16, fontWeight: '700' },
  consent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    minHeight: 60,
  },
  selected: {
    borderColor: colors.primaryDark,
    backgroundColor: colors.primarySoft,
  },
  check: { fontSize: 24, color: colors.primaryDark },
  error: { color: colors.danger },
});
