import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {parseLocalDate} from '@cyclepair/product-core';
import {buildCycleViewModel} from '../app/cycleViewModel';
import {useCyclePair} from '../app/CyclePairStore';
import {observedRecordSummary} from '../app/observedRecordSummary';
import {AppIcon} from '../components/AppArtwork';
import {WeekRecordCard} from '../components/ObservedDays';
import {Body, Card, Chip, PrimaryButton, Screen, TextButton, Title} from '../components/Ui';
import {formatDate, useI18n} from '../i18n/I18nProvider';
import {colors, spacing} from '../theme';

export function HomeScreen({onOpenRecord}: {onOpenRecord():void}) {
  const {state, setTab, dailyHistoryStatus, retryDailyHistory} = useCyclePair();
  const {t, label, locale} = useI18n();
  const model = buildCycleViewModel(state);
  const today = parseLocalDate(state.currentLocalDate);
  const todayRecord = state.dailyHistory.find(entry => entry.localDate === today);
  const summary = observedRecordSummary(state.dailyHistory, today);
  const sync = {idle:undefined,syncing:t('Syncing'),queued:t('Saved offline'),synced:t('Synced'),error:t('Sync error')}[state.syncStatus];
  return (
    <Screen>
      <View style={styles.heading}>
        <Text style={styles.date}>{formatDate(today,locale,{weekday:'long',month:'long',day:'numeric'})}</Text>
        {sync ? <Chip label={sync}/> : null}
      </View>
      <Title>{t('A moment for you')}</Title>
      <Body muted>{t('There is room for a slower day.')}</Body>
      <Card tone="primary" style={styles.record}>
        <View style={styles.recordHeading}><AppIcon name="journal" size={22}/><Text style={styles.eyebrow}>{t('Today’s note')}</Text></View>
        <Text style={styles.status}>
          {dailyHistoryStatus === 'loading' ? t('Loading record…') :
            dailyHistoryStatus === 'error' ? t('Could not load records') :
            todayRecord ? t('Recorded') : t('How are you feeling today?')}
        </Text>
        {dailyHistoryStatus === 'ready' ? (
          todayRecord ? <Body>{[
            ...(todayRecord.checkIn.emotions ?? []).map(label),
            todayRecord.checkIn.carePreference ? label(todayRecord.checkIn.carePreference) : undefined,
          ].filter(Boolean).join(', ')}</Body> : <Body muted>{t('Start with one feeling.')}</Body>
        ) : null}
        <PrimaryButton
          label={dailyHistoryStatus === 'loading' ? t('Loading record…') : dailyHistoryStatus === 'error' ? t('Retry') : t(todayRecord ? 'Edit today’s note' : 'Record my day')}
          disabled={dailyHistoryStatus === 'loading'}
          onPress={dailyHistoryStatus === 'error' ? () => {retryDailyHistory().catch(() => undefined);} : onOpenRecord}
          testID={dailyHistoryStatus === 'ready' ? 'home-record' : dailyHistoryStatus === 'loading' ? 'home-record-loading' : 'home-record-retry'}
        />
      </Card>
      <View style={styles.private}><AppIcon name="lock" size={19}/><Text style={styles.privateText}>{t('Records are private by default.')}</Text></View>
      {dailyHistoryStatus === 'ready' ? <WeekRecordCard summary={summary}/> : null}
      {state.isLogger ? (
        <Card style={styles.cycle}>
          <View style={styles.recordHeading}><AppIcon name="cycle" size={22}/><Text style={styles.status}>{t('My cycle')}</Text></View>
          {state.hasCycleSeed ? (
            <>
              <Body>{model.cycleDay ? t('Cycle day {day}',{day:model.cycleDay}) : t('More records needed')}</Body>
              <Text style={styles.rangeLabel}>{t('Estimated next period')}</Text>
              <Body>{model.predictionStart && model.predictionEnd ? `${formatDate(model.predictionStart,locale)} – ${formatDate(model.predictionEnd,locale)}` : t('More records needed')}</Body>
              <Body muted>{t('Reference estimate')}</Body>
              <TextButton label={t('Calendar')} onPress={() => setTab('calendar')}/>
            </>
          ) : (
            <>
              <Body muted>{t('No cycle records yet')}</Body>
              <TextButton label={t('Cycle settings')} onPress={() => setTab('settings')}/>
            </>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}
const styles=StyleSheet.create({
  heading:{gap:spacing.sm,alignItems:'flex-start',marginBottom:spacing.lg},date:{color:colors.textMuted,fontSize:14},
  record:{marginTop:spacing.xl,gap:spacing.lg},recordHeading:{flexDirection:'row',alignItems:'center',gap:spacing.sm},
  eyebrow:{fontSize:13,color:colors.primaryDark},status:{color:colors.text,fontSize:18,fontWeight:'700'},
  private:{flexDirection:'row',alignItems:'center',gap:spacing.sm,marginVertical:spacing.lg},privateText:{fontSize:13,lineHeight:21,color:colors.primaryDark,flex:1},
  cycle:{marginTop:spacing.lg,gap:spacing.md},rangeLabel:{color:colors.primaryDark,fontSize:14,fontWeight:'600'},
});
