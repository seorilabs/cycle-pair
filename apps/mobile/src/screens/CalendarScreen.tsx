import { addDays, daysBetween, localDate, parseLocalDate, type LocalDate } from '@moonmate/product-core';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buildCycleViewModel, formatKoreanDate } from '../app/cycleViewModel';
import { useMoonMate } from '../app/MoonMateStore';
import { Body, Card, Chip, Screen, SectionHeader } from '../components/Ui';
import { colors, radius, spacing } from '../theme';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

function monthGrid(year: number, month: number): LocalDate[] {
  const first = new Date(year, month - 1, 1, 12);
  const start = localDate(year, month, 1);
  const gridStart = addDays(start, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function dateParts(value: LocalDate | string) {
  const [year, month, day] = String(value).split('-').map(Number);
  return { year, month, day };
}

function isBetween(value: LocalDate, start?: LocalDate, end?: LocalDate): boolean {
  if (!start || !end) return false;
  return daysBetween(start, value) >= 0 && daysBetween(value, end) >= 0;
}

export function CalendarScreen() {
  const { state } = useMoonMate();
  const viewModel = buildCycleViewModel(state);
  const todayParts = dateParts(viewModel.today);
  const [cursor, setCursor] = useState({ year: todayParts.year, month: todayParts.month });
  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const actualStart = state.isLogger
    ? parseLocalDate(state.seed.lastPeriodStart)
    : undefined;
  const actualEnd = actualStart
    ? addDays(actualStart, state.seed.averagePeriodLength - 1)
    : undefined;

  function shiftMonth(offset: number) {
    const shifted = new Date(cursor.year, cursor.month - 1 + offset, 1, 12);
    setCursor({ year: shifted.getFullYear(), month: shifted.getMonth() + 1 });
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>함께 보는 일정</Text>
          <Text style={styles.title}>주기 캘린더</Text>
        </View>
        <View style={styles.privateBadge}><Text style={styles.privateBadgeText}>내 원본</Text></View>
      </View>

      <Card style={styles.calendarCard}>
        <View style={styles.monthHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="이전 달" onPress={() => shiftMonth(-1)} style={styles.monthButton}>
            <Text style={styles.monthArrow}>‹</Text>
          </Pressable>
          <Text style={styles.monthTitle}>{cursor.year}년 {cursor.month}월</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="다음 달" onPress={() => shiftMonth(1)} style={styles.monthButton}>
            <Text style={styles.monthArrow}>›</Text>
          </Pressable>
        </View>
        <View style={styles.weekRow}>
          {weekdays.map((weekday, index) => (
            <Text key={weekday} style={[styles.weekday, index === 0 && styles.sunday]}>{weekday}</Text>
          ))}
        </View>
        <View style={styles.grid}>
          {days.map(day => {
            const parts = dateParts(day);
            const inMonth = parts.month === cursor.month;
            const isToday = day === viewModel.today;
            const isActual = isBetween(day, actualStart, actualEnd);
            const isPredicted = isBetween(day, viewModel.predictionStart, viewModel.predictionEnd);
            return (
              <View key={day} style={styles.dayCell}>
                <View style={[
                  styles.dayCircle,
                  isActual && styles.actualDay,
                  isPredicted && !isActual && styles.predictedDay,
                  isToday && styles.today,
                ]}>
                  <Text style={[
                    styles.dayText,
                    !inMonth && styles.dayOutside,
                    isPredicted && !isActual && styles.predictedText,
                    isActual && styles.dayActiveText,
                    isToday && !isActual && styles.todayText,
                  ]}>{parts.day}</Text>
                </View>
              </View>
            );
          })}
        </View>
        <View style={styles.legend}>
          <View style={styles.legendItem}><View style={[styles.legendDot, styles.actualDot]} /><Text style={styles.legendText}>실제 기록</Text></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, styles.predictedDot]} /><Text style={styles.legendText}>예상 범위</Text></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, styles.todayDot]} /><Text style={styles.legendText}>오늘</Text></View>
        </View>
      </Card>

      <SectionHeader title="다가오는 일정" />
      <Card style={styles.eventCard}>
        <View style={styles.eventDate}>
          <Text style={styles.eventMonth}>{viewModel.predictedDate ? dateParts(viewModel.predictedDate).month : '–'}월</Text>
          <Text style={styles.eventDay}>{viewModel.predictedDate ? dateParts(viewModel.predictedDate).day : '–'}</Text>
        </View>
        <View style={styles.eventCopy}>
          <Text style={styles.eventTitle}>
            {state.isLogger ? '다음 생리 예상 기준일' : '내 주기 기록을 사용하지 않아요'}
          </Text>
          <Text style={styles.eventBody}>
            {!state.isLogger
              ? '상대가 직접 공유한 정보만 확인할 수 있어요.'
              : viewModel.predictionStart && viewModel.predictionEnd
              ? `${formatKoreanDate(viewModel.predictionStart)}부터 ${formatKoreanDate(viewModel.predictionEnd)} 사이로 넓게 봐주세요.`
              : '기록이 더 쌓이면 예상 범위를 보여드려요.'}
          </Text>
        </View>
        <Chip label="참고용" />
      </Card>

      <Card tone="mint" style={styles.sharedCalendarCard}>
        <Text style={styles.sharedIcon}>＋</Text>
        <View style={styles.sharedCopy}>
          <Text style={styles.sharedTitle}>기념일·공동 일정</Text>
          <Text style={styles.sharedBody}>Pair 동기화가 연결되면 두 사람이 함께 추가하고 수정할 수 있어요.</Text>
        </View>
      </Card>

      <Body muted style={styles.disclaimer}>가임기·배란일은 표시하지 않으며, 예상 범위는 의료 또는 피임 판단에 사용할 수 없습니다.</Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900', marginBottom: spacing.xs },
  title: { color: colors.text, fontSize: 28, fontWeight: '900' },
  privateBadge: { borderRadius: radius.pill, backgroundColor: colors.primarySoft, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  privateBadgeText: { color: colors.primaryDark, fontSize: 11, fontWeight: '800' },
  calendarCard: { padding: spacing.lg },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  monthButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  monthArrow: { color: colors.primaryDark, fontSize: 28, lineHeight: 32 },
  monthTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  weekRow: { flexDirection: 'row', marginBottom: spacing.sm },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', color: colors.textSubtle, fontSize: 11, fontWeight: '700' },
  sunday: { color: colors.accent },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' },
  dayCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  actualDay: { backgroundColor: colors.accent },
  predictedDay: { backgroundColor: colors.primarySoft },
  today: { borderWidth: 1.5, borderColor: colors.primary },
  dayText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  dayOutside: { color: colors.border },
  predictedText: { color: colors.primaryDark, fontWeight: '800' },
  dayActiveText: { color: '#FFFFFF', fontWeight: '900' },
  todayText: { color: colors.primaryDark, fontWeight: '900' },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  actualDot: { backgroundColor: colors.accent },
  predictedDot: { backgroundColor: colors.primarySoft },
  todayDot: { borderWidth: 1, borderColor: colors.primary },
  legendText: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  eventCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  eventDate: { width: 48, height: 58, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  eventMonth: { color: colors.primary, fontSize: 10, fontWeight: '900' },
  eventDay: { color: colors.primaryDark, fontSize: 22, fontWeight: '900' },
  eventCopy: { flex: 1, gap: spacing.xs },
  eventTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  eventBody: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  sharedCalendarCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  sharedIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, color: colors.mint, textAlign: 'center', lineHeight: 38, fontSize: 25 },
  sharedCopy: { flex: 1, gap: spacing.xs },
  sharedTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  sharedBody: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  disclaimer: { fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: spacing.xl },
});
