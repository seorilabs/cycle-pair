import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCyclePair } from '../app/CyclePairStore';
import { AppIcon } from '../components/AppArtwork';
import { Body, PrimaryButton, Screen, Title } from '../components/Ui';
import { useI18n } from '../i18n/I18nProvider';
import { colors, radius, spacing } from '../theme';
import type { SetupDraft } from './SetupScreen';

export function OnboardingScreen({
  draft,
  onDraftChange,
}: {
  draft: SetupDraft;
  onDraftChange(draft: SetupDraft): void;
}) {
  const { completeOnboarding, backendBusy } = useCyclePair();
  const { t } = useI18n();
  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.brand}>∞ {t('Cycle Pair')}</Text>
      <Title>{t('What would you like to track?')}</Title>
      <Body muted>
        {t('Start with what you need. Your records are private by default.')}
      </Body>
      {([true, false] as const).map(isLogger => (
        <Pressable
          key={String(isLogger)}
          accessibilityRole="radio"
          accessibilityState={{
            checked: draft.purposeChosen && draft.isLogger === isLogger,
            disabled: backendBusy,
          }}
          disabled={backendBusy}
          testID={isLogger ? 'purpose-cycle' : 'purpose-condition'}
          onPress={() =>
            onDraftChange({ ...draft, isLogger, purposeChosen: true })
          }
          style={[
            styles.choice,
            draft.purposeChosen &&
              draft.isLogger === isLogger &&
              styles.selected,
          ]}
        >
          <AppIcon name={isLogger ? 'cycle' : 'leaf'} size={34} />
          <View style={styles.copy}>
            <Text style={styles.label}>
              {t(isLogger ? 'Cycle and condition' : 'Condition only')}
            </Text>
            <Body muted>
              {t(
                isLogger
                  ? 'Period dates, body and mood'
                  : 'Body and mood, without cycle questions',
              )}
            </Body>
          </View>
        </Pressable>
      ))}
      <PrimaryButton
        label={t('Continue')}
        disabled={backendBusy || !draft.purposeChosen}
        onPress={completeOnboarding}
        testID="onboarding-next"
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  brand: { color: colors.primaryDark, fontSize: 18, fontWeight: '800' },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    minHeight: 104,
  },
  selected: {
    borderColor: colors.primaryDark,
    backgroundColor: colors.primarySoft,
  },
  copy: { flex: 1, gap: spacing.sm },
  label: { color: colors.text, fontSize: 18, fontWeight: '700' },
});
