import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useCyclePair } from '../app/CyclePairStore';
import type { PeriodBoundaryState } from '../platform/backend/CyclePairBackend';
import { formatDate, useI18n } from '../i18n/I18nProvider';
import {
  Body,
  Card,
  PrimaryButton,
  Screen,
  TextButton,
  Title,
  ToggleRow,
} from './Ui';
import { colors, spacing } from '../theme';

export function PeriodBoundaryEditor({
  date,
  value,
  onClose,
}: {
  date: string;
  value: PeriodBoundaryState;
  onClose(): void;
}) {
  const {
    savePeriodBoundary,
    reloadPrivateHistory,
    recoverDailyDraft,
    backendBusy,
    backendError,
  } = useCyclePair();
  const { t, l, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(value),
    [attempted, setAttempted] = useState(false),
    [recovered, setRecovered] = useState(false);
  const changed = useRef(false),
    submitting = useRef(false);
  useEffect(() => {
    let active = true;
    recoverDailyDraft(date)
      .then(saved => {
        if (active && !changed.current && saved?.periodEdited) {
          setDraft({
            periodStarted: saved.checkIn.periodStarted,
            periodEnded: saved.checkIn.periodEnded,
          });
          setRecovered(true);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [date, recoverDailyDraft]);
  async function save() {
    if (submitting.current || backendBusy) return;
    submitting.current = true;
    setAttempted(true);
    try {
      if (await savePeriodBoundary(date, draft)) onClose();
    } finally {
      submitting.current = false;
    }
  }
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        if (!backendBusy) onClose();
      }}
    >
      <Screen
        footer={
          <View
            style={[
              styles.footer,
              { paddingBottom: spacing.md + insets.bottom },
            ]}
          >
            <PrimaryButton
              testID="period-save"
              label={t(backendBusy ? 'Saving…' : 'Save period')}
              disabled={backendBusy}
              onPress={() => {
                save().catch(() => undefined);
              }}
            />
          </View>
        }
      >
        <TextButton
          label={t('Cancel')}
          disabled={backendBusy}
          onPress={onClose}
        />
        <Title>{t('Log period')}</Title>
        <Body muted>{formatDate(date, locale)}</Body>
        <Body style={styles.intro}>
          {t(
            'Mark what happened on this date. Your note and feelings stay as they are.',
          )}
        </Body>
        {recovered ? (
          <Body>
            {t('Your unsaved changes are here. Review them before saving.')}
          </Body>
        ) : null}
        <Card>
          <ToggleRow
            testID="period-start"
            title={t('Period started on this date')}
            value={draft.periodStarted}
            disabled={backendBusy}
            onValueChange={periodStarted => {
              changed.current = true;
              setDraft({ ...draft, periodStarted });
            }}
          />
          <ToggleRow
            testID="period-end"
            title={t('Period ended on this date')}
            value={draft.periodEnded}
            disabled={backendBusy}
            onValueChange={periodEnded => {
              changed.current = true;
              setDraft({ ...draft, periodEnded });
            }}
          />
        </Card>
        <Body muted style={styles.intro}>
          {t(
            'You can mark both for a one-day period. Leave the end off until you know it.',
          )}
        </Body>
        {attempted && backendError ? (
          <View accessibilityRole="alert">
            <Body style={styles.error}>{l(backendError)}</Body>
            <TextButton
              label={t('Reload saved records')}
              disabled={backendBusy}
              onPress={() => {
                reloadPrivateHistory().catch(() => undefined);
              }}
            />
          </View>
        ) : null}
      </Screen>
    </Modal>
  );
}
const styles = StyleSheet.create({
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  intro: { marginVertical: spacing.lg },
  error: { color: colors.danger },
});
