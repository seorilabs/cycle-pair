import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type ShareField, useCyclePair } from '../app/CyclePairStore';
import { sharingPreview } from '../app/sharingPreview';
import { sharedFields } from '../app/sharedFieldPresentation';
import {
  Body,
  Card,
  PrimaryButton,
  Screen,
  SectionHeader,
  TextButton,
  Title,
  ToggleRow,
} from '../components/Ui';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/language';
import type { RemotePartnerProjection } from '../platform/backend/CyclePairBackend';
import { colors, spacing } from '../theme';
const fields: {
  key: ShareField;
  title: MessageKey;
  projection?: keyof RemotePartnerProjection;
}[] = [
  { key: 'emotions', title: 'How I feel', projection: 'emotionTags' },
  {
    key: 'carePreference',
    title: 'Help I want',
    projection: 'carePreferences',
  },
  { key: 'cyclePhase', title: 'Cycle phase', projection: 'cyclePhase' },
  { key: 'cycleStatus', title: 'Period status', projection: 'cycleStatus' },
  { key: 'fertilityStatus', title: 'Fertility estimate' },
  {
    key: 'predictedPeriod',
    title: 'Estimated next period',
    projection: 'nextPeriodWindow',
  },
  { key: 'periodDates', title: 'Period dates', projection: 'periodDates' },
  { key: 'symptoms', title: 'Symptoms', projection: 'symptomTags' },
  { key: 'energy', title: 'Energy', projection: 'energyLevel' },
  { key: 'condition', title: 'Condition', projection: 'conditionCode' },
  { key: 'note', title: 'Note', projection: 'note' },
];
export function SharingScreen() {
  const {
    state,
    backendBusy,
    backendError,
    goBack,
    toggleShare,
    completeSharing,
  } = useCyclePair();
  const { l, t, locale } = useI18n();
  const submitting = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const values = sharedFields(sharingPreview(state), locale);
  async function save() {
    if (submitting.current || backendBusy) return;
    submitting.current = true;
    setAttempted(true);
    try {
      await completeSharing();
    } finally {
      submitting.current = false;
    }
  }
  const selected = fields.filter(field => state.shareSettings[field.key]);
  return (
    <Screen>
      <TextButton label={t('Back')} disabled={backendBusy} onPress={goBack} />
      <View style={styles.heading}>
        <Title>{t('Choose what to share')}</Title>
        <Body muted>{t('Nothing is shared until you choose.')}</Body>
      </View>
      <Card>
        {fields.map(field => (
          <ToggleRow
            key={field.key}
            testID={`sharing-${field.key}`}
            title={t(field.title)}
            value={state.shareSettings[field.key]}
            disabled={backendBusy}
            onValueChange={() => toggleShare(field.key)}
          />
        ))}
      </Card>
      <SectionHeader title={t('Preview for your partner')} />
      <Card tone="accent" style={styles.preview}>
        {selected.length ? (
          selected.map(field => (
            <View key={field.key} style={styles.value}>
              <Text style={styles.label}>{t(field.title)}</Text>
              <Body>
                {(field.key === 'fertilityStatus'
                  ? values
                      .filter(
                        value =>
                          value.key === 'cyclePhase' ||
                          value.key === 'cycleStatus',
                      )
                      .map(value => value.value)
                      .join(', ')
                  : values.find(value => value.key === field.projection)
                      ?.value) || t('No value recorded today')}
              </Body>
            </View>
          ))
        ) : (
          <Body muted>{t('No items selected')}</Body>
        )}
      </Card>
      {selected.some(field =>
        [
          'cyclePhase',
          'cycleStatus',
          'fertilityStatus',
          'predictedPeriod',
        ].includes(field.key),
      ) ? (
        <Body muted style={styles.notice}>
          {t(
            'Estimates are for reference, not medical advice or contraception.',
          )}
        </Body>
      ) : null}
      {attempted && backendError ? (
        <Body style={styles.error}>{l(backendError)}</Body>
      ) : null}
      <View style={styles.save}>
        <PrimaryButton
          label={t(backendBusy ? 'Saving…' : 'Save sharing choices')}
          disabled={backendBusy}
          testID="sharing-save"
          onPress={() => {
            save().catch(() => undefined);
          }}
        />
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  heading: { marginVertical: spacing.lg, gap: spacing.md },
  preview: { gap: spacing.lg },
  value: { gap: spacing.xs },
  label: { color: colors.textMuted, fontSize: 13 },
  notice: { marginTop: spacing.lg },
  error: { color: colors.danger, marginTop: spacing.lg },
  save: { marginTop: spacing.xl },
});
