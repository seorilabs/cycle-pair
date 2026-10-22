import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useCyclePair } from '../app/CyclePairStore';
import {
  Body,
  Card,
  Chip,
  PrimaryButton,
  Screen,
  Title,
} from '../components/Ui';
import { useI18n } from '../i18n/I18nProvider';
import { colors, spacing } from '../theme';

export function OnboardingScreen() {
  const { completeOnboarding } = useCyclePair();
  const { t } = useI18n();
  return (
    <Screen>
      <Text style={styles.brand}>∞ {t('Cycle Pair')}</Text>
      <Title>{t('My record, my choice')}</Title>
      <Body muted style={styles.intro}>
        {t('Keep track of your day. Share only what you choose.')}
      </Body>
      <Card tone="primary" style={styles.example}>
        <Chip label={t('Example')} />
        <Text style={styles.label}>{t('My day')}</Text>
        <View style={styles.row}>
          <Text style={styles.value}>🙂 {t('Calm')}</Text>
          <Chip label={t('Private')} />
        </View>
        <View style={styles.row}>
          <Text style={styles.value}>♡ {t('Just listen')}</Text>
          <Chip label={t('Shared')} selected />
        </View>
        <Body muted>
          {t('Only selected items are shared with your partner.')}
        </Body>
      </Card>
      <PrimaryButton
        label={t('Start')}
        onPress={completeOnboarding}
        testID="onboarding-next"
      />
      <Body muted style={styles.notice}>
        {t('Estimates are for reference, not medical advice or contraception.')}
      </Body>
    </Screen>
  );
}
const styles = StyleSheet.create({
  brand: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: spacing.xxl,
  },
  intro: { marginTop: spacing.md },
  example: { gap: spacing.lg, marginVertical: spacing.xl },
  label: { color: colors.primaryDark, fontSize: 16, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  value: { color: colors.text, fontSize: 18, fontWeight: '700', flexShrink: 1 },
  notice: { marginTop: spacing.lg },
});
