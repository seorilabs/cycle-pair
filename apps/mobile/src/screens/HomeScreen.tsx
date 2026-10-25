import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { buildCycleViewModel } from '../app/cycleViewModel';
import { useCyclePair } from '../app/CyclePairStore';
import { getSafePartnerProjectionForToday } from '../app/partnerProjectionPresentation';
import {
  Body,
  Card,
  Chip,
  PrimaryButton,
  Screen,
  SectionHeader,
  TextButton,
  Title,
} from '../components/Ui';
import { formatDate, useI18n } from '../i18n/I18nProvider';
import { colors, spacing } from '../theme';

export function HomeScreen({ onOpenRecord }: { onOpenRecord(): void }) {
  const { state, setTab, dailyHistoryStatus, retryDailyHistory } =
    useCyclePair();
  const { t, label, locale } = useI18n();
  const model = buildCycleViewModel(state);
  const recorded = state.dailyHistory.some(
    entry => entry.localDate === state.currentLocalDate,
  );
  const partner = getSafePartnerProjectionForToday(state.partnerProjection);
  const sync = {
    idle: undefined,
    syncing: t('Syncing'),
    queued: t('Saved offline'),
    synced: t('Synced'),
    error: t('Sync error'),
  }[state.syncStatus];
  return (
    <Screen>
      <View style={styles.heading}>
        <Text style={styles.date}>
          {formatDate(model.today, locale, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
        {sync ? <Chip label={sync} /> : null}
      </View>
      <Title>{t('My day')}</Title>
      <Card tone="primary" style={styles.record}>
        <Text style={styles.status}>
          {dailyHistoryStatus === 'loading'
            ? t('Loading record…')
            : dailyHistoryStatus === 'error'
            ? t('Could not load records')
            : recorded
            ? `✓ ${t('Recorded')}`
            : t('Not recorded yet')}
        </Text>
        {recorded ? (
          <Body>
            {[
              ...(state.checkIn.emotions ?? []).map(label),
              state.checkIn.carePreference
                ? label(state.checkIn.carePreference)
                : undefined,
            ]
              .filter(Boolean)
              .join(', ')}
          </Body>
        ) : null}
        <PrimaryButton
          label={
            dailyHistoryStatus === 'loading'
              ? t('Loading record…')
              : dailyHistoryStatus === 'error'
              ? t('Retry')
              : t(recorded ? 'Edit record' : 'Record today')
          }
          disabled={dailyHistoryStatus === 'loading'}
          onPress={
            dailyHistoryStatus === 'error'
              ? () => {
                  retryDailyHistory().catch(() => undefined);
                }
              : onOpenRecord
          }
          testID={
            dailyHistoryStatus === 'ready'
              ? 'home-record'
              : dailyHistoryStatus === 'loading'
              ? 'home-record-loading'
              : 'home-record-retry'
          }
        />
      </Card>
      {state.isLogger ? (
        <>
          <SectionHeader title={t('My cycle')} />
          <Card style={styles.cycle}>
            {state.hasCycleSeed ? (
              <>
                <Text style={styles.status}>
                  {model.cycleDay
                    ? t('Cycle day {day}', { day: model.cycleDay })
                    : t('More records needed')}
                </Text>
                <View style={styles.range}>
                  <Text style={styles.rangeLabel}>
                    ● {t('Recorded period')}
                  </Text>
                  <Body>
                    {formatDate(state.seed.lastPeriodStart, locale)}
                    {state.seed.lastPeriodEnd
                      ? ` – ${formatDate(state.seed.lastPeriodEnd, locale)}`
                      : ''}
                  </Body>
                </View>
                <View style={styles.range}>
                  <Text style={styles.rangeLabel}>
                    ○ {t('Estimated next period')}
                  </Text>
                  <Body>
                    {model.predictionStart && model.predictionEnd
                      ? `${formatDate(
                          model.predictionStart,
                          locale,
                        )} – ${formatDate(model.predictionEnd, locale)}`
                      : t('More records needed')}
                  </Body>
                </View>
                <Body muted>{t('Reference estimate')}</Body>
              </>
            ) : (
              <>
                <Text style={styles.status}>{t('No cycle records yet')}</Text>
                <Body muted>
                  {t(
                    'Add your last period in cycle settings to see an estimate.',
                  )}
                </Body>
                <TextButton
                  label={t('Cycle settings')}
                  onPress={() => setTab('settings')}
                />
              </>
            )}
          </Card>
        </>
      ) : null}
      <SectionHeader
        title={t('Partner')}
        action={
          <TextButton
            label={t('View partner')}
            onPress={() => setTab('partner')}
          />
        }
      />
      <Card>
        <Text style={styles.status}>
          {state.paired ? `♡ ${t('Connected')}` : t('Recording on my own')}
        </Text>
        {state.paired ? (
          <Body muted>
            {partner?.emotionTags?.map(label).join(', ') ||
              t('No shared update today')}
          </Body>
        ) : null}
      </Card>
    </Screen>
  );
}
const styles = StyleSheet.create({
  heading: {
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  date: { color: colors.textMuted, fontSize: 14 },
  record: { marginTop: spacing.lg, gap: spacing.lg },
  status: { color: colors.text, fontSize: 17, fontWeight: '700' },
  cycle: { gap: spacing.lg },
  range: { gap: spacing.xs },
  rangeLabel: { color: colors.primaryDark, fontSize: 14, fontWeight: '700' },
});
