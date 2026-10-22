import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useCyclePair } from '../app/CyclePairStore';
import { getSafePartnerProjectionForToday } from '../app/partnerProjectionPresentation';
import { sharedFields } from '../app/sharedFieldPresentation';
import {
  PartnerNudgeActions,
  PartnerNudgeInbox,
} from '../components/PartnerNudges';
import {
  Body,
  Card,
  PrimaryButton,
  Screen,
  SectionHeader,
  TextButton,
  Title,
} from '../components/Ui';
import { useI18n } from '../i18n/I18nProvider';
import { colors, spacing } from '../theme';
export function PartnerScreen() {
  const { state, openPairing, continueToSharing } = useCyclePair();
  const { t, locale } = useI18n();
  const fields = sharedFields(
    getSafePartnerProjectionForToday(state.partnerProjection),
    locale,
  );
  const primary = fields.filter(
    field => field.key === 'emotionTags' || field.key === 'carePreferences',
  );
  const other = fields.filter(field => !primary.includes(field));
  return (
    <Screen>
      <Title>{t('Partner')}</Title>
      {!state.paired ? (
        <Card tone="primary" style={styles.card}>
          <Text style={styles.mark}>♡</Text>
          <Body>{t('You can keep recording without a partner.')}</Body>
          <Body muted>{t('Nothing is shared until you choose.')}</Body>
          <PrimaryButton label={t('Connect a partner')} onPress={openPairing} />
        </Card>
      ) : (
        <>
          <View style={styles.heading}>
            <Body muted>{t('Shared information only')}</Body>
            <TextButton label={t('Sharing')} onPress={continueToSharing} />
          </View>
          <PartnerNudgeInbox />
          {!state.sharingCompleted ? (
            <Card style={styles.card}>
              <Body>{t('Nothing is shared until you choose.')}</Body>
              <PrimaryButton
                label={t('Choose what to share')}
                onPress={continueToSharing}
              />
            </Card>
          ) : (
            <>
              <Card tone="accent" style={styles.card}>
                <Text style={styles.headingText}>
                  {t('Today’s shared update')}
                </Text>
                {primary.length ? (
                  primary.map(field => (
                    <View key={field.key} style={styles.field}>
                      <Text style={styles.label}>{field.label}</Text>
                      <Text style={styles.value}>{field.value}</Text>
                    </View>
                  ))
                ) : (
                  <Body muted>{t('No shared update today')}</Body>
                )}
                <PartnerNudgeActions canAcknowledgeCare={fields.length > 0} />
              </Card>
              {other.length ? (
                <>
                  <SectionHeader title={t('Other shared items')} />
                  <Card style={styles.card}>
                    {other.map(field => (
                      <View key={field.key} style={styles.field}>
                        <Text style={styles.label}>{field.label}</Text>
                        <Body>{field.value}</Body>
                      </View>
                    ))}
                  </Card>
                </>
              ) : null}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  card: { marginTop: spacing.lg, gap: spacing.lg },
  mark: { fontSize: 42, color: colors.primary },
  heading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginVertical: spacing.lg,
  },
  headingText: { fontSize: 18, fontWeight: '700', color: colors.text },
  field: { gap: spacing.xs },
  label: { fontSize: 13, color: colors.textMuted },
  value: { fontSize: 22, fontWeight: '700', color: colors.primaryDark },
});
