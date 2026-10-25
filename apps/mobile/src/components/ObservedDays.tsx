import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {EmotionCode} from '../app/emotions';
import {emotionLabel} from '../app/emotions';
import type {ObservedRecordSummary} from '../app/observedRecordSummary';
import {formatDate, useI18n} from '../i18n/I18nProvider';
import {colors, radius, spacing} from '../theme';
import {AppIcon} from './AppArtwork';
import {Body, Card, PrimaryButton} from './Ui';

export const emotionArtwork: Record<EmotionCode, React.ComponentProps<typeof AppIcon>['name']> = {
  calm: 'leaf', happy: 'sun', affectionate: 'heart', anxious: 'cloud',
  irritable: 'cloud', hurt: 'cloud', lonely: 'moon', drained: 'moon', other: 'journal',
};
export function WeekRecordCard({summary}: {summary: ObservedRecordSummary}) {
  const {t, locale, label} = useI18n();
  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>{t('My week')}</Text>
      <Text style={styles.range}>
        {formatDate(summary.days[0].localDate, locale)} – {formatDate(summary.days[6].localDate, locale)}
      </Text>
      <View style={styles.week}>
        {summary.days.map(day => {
          const state = day.recorded
            ? day.emotions.length ? day.emotions.map(code => label(emotionLabel(code))).join(', ') : t('No feeling selected')
            : t('No record');
          return (
            <View key={day.localDate} style={styles.day} accessible accessibilityLabel={`${formatDate(day.localDate, locale)}, ${state}`}>
              <Text style={styles.weekday}>{formatDate(day.localDate, locale, {weekday: 'narrow'})}</Text>
              <View style={[styles.dayMark, day.recorded && styles.dayRecorded]}>
                {day.recorded ? <AppIcon name={day.emotions[0] ? emotionArtwork[day.emotions[0]] : 'journal'} size={20} /> : <Text style={styles.dash}>–</Text>}
              </View>
              <Text style={styles.dayNumber}>{Number(day.localDate.slice(-2))}</Text>
            </View>
          );
        })}
      </View>
      <Body muted>{t('The quiet days are yours, too.')}</Body>
      <Text style={styles.range}>{t('{recorded} of 7 days recorded. {missing} days without records.', {recorded:summary.recordedDays, missing:summary.missingDays})}</Text>
    </Card>
  );
}

export function MoodHistoryCard({summary, onOpenRecord}: {summary: ObservedRecordSummary; onOpenRecord():void}) {
  const {t, locale, label} = useI18n();
  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>{t('Feelings recorded this week')}</Text>
      <Text style={styles.range}>{formatDate(summary.days[0].localDate, locale)} – {formatDate(summary.days[6].localDate, locale)}</Text>
      {summary.recordedDays === 0 ? (
        <View style={styles.empty}>
          <AppIcon name="journal" size={42} />
          <Text style={styles.emptyTitle}>{t('Your story starts here')}</Text>
          <Body muted>{t('Your days will gather here as you record them.')}</Body>
          <PrimaryButton label={t('Write your first note')} onPress={onOpenRecord} />
        </View>
      ) : summary.moodRecordedDays === 0 ? (
        <Body muted>{t('Your records are here. Add a feeling when it feels right.')}</Body>
      ) : (
        <View style={styles.chart}>
          {summary.emotions.map(row => {
            const name = label(emotionLabel(row.code));
            return (
              <View key={row.code} style={styles.row} accessible accessibilityLabel={`${name}, ${row.days === 1 ? t('1 day') : t('{count} days', {count:row.days})}`}>
                <View style={styles.barLabel}><AppIcon name={emotionArtwork[row.code]} size={19}/><Text style={styles.emotion}>{name}</Text></View>
                <View style={styles.barTrack} accessible={false}>
                  <View style={[styles.barFill, {width:`${row.days / summary.moodRecordedDays * 100}%`}]} />
                </View>
                <Text style={styles.count}>{row.days === 1 ? t('1 day') : t('{count} days', {count:row.days})}</Text>
              </View>
            );
          })}
          <Text style={styles.range}>{t('Based on {count} days with a feeling recorded.',{count:summary.moodRecordedDays})}</Text>
          <Text style={styles.range}>{t('You can choose several feelings in a day, so totals may overlap.')}</Text>
        </View>
      )}
      <Text style={styles.range}>{t('{recorded} of 7 days recorded. {missing} days without records.',{recorded:summary.recordedDays,missing:summary.missingDays})}</Text>
    </Card>
  );
}
const styles=StyleSheet.create({
  card:{gap:spacing.md},heading:{fontSize:18,fontWeight:'700',color:colors.text},
  range:{fontSize:13,lineHeight:20,color:colors.textMuted},week:{flexDirection:'row',gap:spacing.xs,justifyContent:'space-between',flexWrap:'wrap'},
  day:{alignItems:'center',minWidth:26,flexGrow:1,flexBasis:26,gap:spacing.xs},weekday:{fontSize:12,color:colors.textMuted},
  dayMark:{alignItems:'center',justifyContent:'center',width:30,minHeight:34,borderRadius:12,backgroundColor:colors.surfaceMuted},
  dayRecorded:{backgroundColor:colors.primarySoft,borderColor:colors.primary,borderWidth:1},dash:{fontSize:17,color:colors.textMuted},
  dayNumber:{fontSize:12,color:colors.textMuted},empty:{gap:spacing.lg,paddingVertical:spacing.lg},emptyTitle:{fontSize:18,fontWeight:'600',color:colors.text},
  chart:{gap:spacing.md},row:{gap:spacing.sm,flexDirection:'row',alignItems:'center',flexWrap:'wrap'},
  barLabel:{flexDirection:'row',gap:spacing.sm,alignItems:'center',minWidth:80,flexShrink:1,flexBasis:80,flexGrow:1},emotion:{fontSize:14,color:colors.text,flexShrink:1},
  barTrack:{height:12,flexGrow:2,flexBasis:60,minWidth:40,borderRadius:radius.pill,backgroundColor:colors.surfaceMuted,overflow:'hidden'},
  barFill:{height:12,borderRadius:radius.pill,backgroundColor:colors.primary},count:{fontSize:13,color:colors.text,minWidth:36},
});
