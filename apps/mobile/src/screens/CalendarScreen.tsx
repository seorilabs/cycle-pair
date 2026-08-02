import {
  addDays,
  daysBetween,
  isLocalDate,
  localDate,
  parseLocalDate,
  type LocalDate,
} from '@cyclepair/product-core';
import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { buildCycleViewModel, formatKoreanDate } from '../app/cycleViewModel';
import { buildCalendarCycleRanges } from '../app/calendarCycleRanges';
import { useCyclePair } from '../app/CyclePairStore';
import { getSafePartnerProjectionForToday } from '../app/partnerProjectionPresentation';
import type { PairEventInput } from '../platform/backend/CyclePairBackend';
import {
  Body,
  Card,
  Chip,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  TextButton,
} from '../components/Ui';
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

function isBetween(
  value: LocalDate,
  start?: LocalDate,
  end?: LocalDate,
): boolean {
  if (!start || !end) return false;
  return daysBetween(start, value) >= 0 && daysBetween(value, end) >= 0;
}

function isValidOptionalTime(value?: string): boolean {
  if (!value) return true;
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isValidEventTimes(start?: string, end?: string): boolean {
  return (
    isValidOptionalTime(start) &&
    isValidOptionalTime(end) &&
    (!end || Boolean(start)) &&
    (!start || !end || end >= start)
  );
}

export function CalendarScreen() {
  const {
    state,
    backendBusy,
    backendError,
    deleteDailyLog,
    upsertPairEvent,
    deletePairEvent,
  } = useCyclePair();
  const viewModel = buildCycleViewModel(state);
  const todayParts = dateParts(viewModel.today);
  const [cursor, setCursor] = useState({
    year: todayParts.year,
    month: todayParts.month,
  });
  const [selectedDate, setSelectedDate] = useState(String(viewModel.today));
  const [eventDraft, setEventDraft] = useState<PairEventInput | null>(null);
  const [retryOperation, setRetryOperation] = useState<
    | { readonly type: 'save'; readonly event: PairEventInput }
    | { readonly type: 'delete'; readonly eventId: string }
    | { readonly type: 'delete-record'; readonly localDate: string }
    | null
  >(null);
  const operationRef = useRef(false);
  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const recordDates = useMemo(
    () => new Set(state.dailyHistory.map(entry => entry.localDate)),
    [state.dailyHistory],
  );
  const eventDates = useMemo(
    () => new Set(state.sharedEvents.map(event => event.date)),
    [state.sharedEvents],
  );
  const selectedHistory = state.dailyHistory.find(
    entry => entry.localDate === selectedDate,
  );
  const selectedEvents = state.sharedEvents.filter(
    event => event.date === selectedDate,
  );
  const safePartnerProjection = getSafePartnerProjectionForToday(
    state.partnerProjection,
  );
  const cycleRanges = buildCalendarCycleRanges({
    recordsOwnCycle: state.isLogger && state.hasCycleSeed,
    ownPeriodStart: state.seed.lastPeriodStart,
    ...(state.seed.lastPeriodEnd
      ? { ownPeriodEnd: state.seed.lastPeriodEnd }
      : {}),
    averagePeriodLength: state.seed.averagePeriodLength,
    paired: state.paired,
    ...(safePartnerProjection?.periodDates
      ? { partnerPeriodDates: safePartnerProjection.periodDates }
      : {}),
    ...(safePartnerProjection?.nextPeriodWindow
      ? { partnerNextPeriodWindow: safePartnerProjection.nextPeriodWindow }
      : {}),
  });

  function shiftMonth(offset: number) {
    const shifted = new Date(cursor.year, cursor.month - 1 + offset, 1, 12);
    setCursor({ year: shifted.getFullYear(), month: shifted.getMonth() + 1 });
  }

  function beginCreateEvent() {
    setEventDraft({
      id: `event-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      title: '',
      date: selectedDate,
    });
  }

  async function persistEvent(event: PairEventInput) {
    if (operationRef.current || backendBusy) return;
    operationRef.current = true;
    setRetryOperation({ type: 'save', event });
    try {
      const saved = await upsertPairEvent(event);
      if (saved) {
        setSelectedDate(event.date);
        setEventDraft(null);
        setRetryOperation(null);
      }
    } finally {
      operationRef.current = false;
    }
  }

  async function saveEvent() {
    const normalizedDate = eventDraft?.date.trim() ?? '';
    if (
      !eventDraft?.title.trim() ||
      !isLocalDate(normalizedDate) ||
      !isValidEventTimes(eventDraft.startTime, eventDraft.endTime)
    ) {
      return;
    }
    await persistEvent({
      id: eventDraft.id,
      title: eventDraft.title.trim().slice(0, 80),
      date: normalizedDate,
      ...(eventDraft.startTime?.trim()
        ? { startTime: eventDraft.startTime.trim() }
        : {}),
      ...(eventDraft.endTime?.trim()
        ? { endTime: eventDraft.endTime.trim() }
        : {}),
      ...(eventDraft.note?.trim()
        ? { note: eventDraft.note.trim().slice(0, 500) }
        : {}),
    });
  }

  async function removeEvent(eventId: string) {
    if (operationRef.current || backendBusy) return;
    operationRef.current = true;
    setRetryOperation({ type: 'delete', eventId });
    try {
      if (await deletePairEvent(eventId)) setRetryOperation(null);
    } finally {
      operationRef.current = false;
    }
  }

  async function removeDailyLog(recordDate: string) {
    if (operationRef.current || backendBusy) return;
    operationRef.current = true;
    setRetryOperation({ type: 'delete-record', localDate: recordDate });
    try {
      if (await deleteDailyLog(recordDate)) setRetryOperation(null);
    } finally {
      operationRef.current = false;
    }
  }

  async function retryLastOperation() {
    if (!retryOperation) return;
    if (retryOperation.type === 'save') {
      if (eventDraft) {
        await saveEvent();
      } else {
        await persistEvent(retryOperation.event);
      }
      return;
    }
    if (retryOperation.type === 'delete-record') {
      await removeDailyLog(retryOperation.localDate);
      return;
    }
    await removeEvent(retryOperation.eventId);
  }

  function confirmDeleteDailyLog() {
    if (!selectedHistory) return;
    const includesCycleBoundary =
      selectedHistory.checkIn.periodStarted ||
      selectedHistory.checkIn.periodEnded;
    Alert.alert(
      '기록 삭제',
      `${formatKoreanDate(parseLocalDate(selectedHistory.localDate))}의 컨디션 기록을 삭제할까요? 이 작업은 되돌릴 수 없어요.${
        includesCycleBoundary
          ? '\n\n설정에 저장된 주기 시작·종료 기준은 유지돼요.'
          : ''
      }`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            removeDailyLog(selectedHistory.localDate).catch(() => undefined);
          },
        },
      ],
    );
  }

  function confirmDeleteEvent(eventId: string, title: string) {
    Alert.alert('공동 일정 삭제', `“${title}” 일정을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          removeEvent(eventId).catch(() => undefined);
        },
      },
    ]);
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>
            {state.paired ? '함께 보는 일정' : '나만의 일정'}
          </Text>
          <Text style={styles.title}>주기 캘린더</Text>
        </View>
        <View style={styles.privateBadge}>
          <Text style={styles.privateBadgeText}>내 원본</Text>
        </View>
      </View>

      <Card style={styles.calendarCard}>
        <View style={styles.monthHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="이전 달"
            onPress={() => shiftMonth(-1)}
            style={styles.monthButton}
          >
            <Text style={styles.monthArrow}>‹</Text>
          </Pressable>
          <Text style={styles.monthTitle}>
            {cursor.year}년 {cursor.month}월
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="다음 달"
            onPress={() => shiftMonth(1)}
            style={styles.monthButton}
          >
            <Text style={styles.monthArrow}>›</Text>
          </Pressable>
        </View>
        <View style={styles.weekRow}>
          {weekdays.map((weekday, index) => (
            <Text
              key={weekday}
              style={[styles.weekday, index === 0 && styles.sunday]}
            >
              {weekday}
            </Text>
          ))}
        </View>
        <View style={styles.grid}>
          {days.map(day => {
            const parts = dateParts(day);
            const inMonth = parts.month === cursor.month;
            const isToday = day === viewModel.today;
            const isOwnActual = isBetween(
              day,
              cycleRanges.ownActual?.start,
              cycleRanges.ownActual?.end,
            );
            const isOwnInferred = isBetween(
              day,
              cycleRanges.ownInferred?.start,
              cycleRanges.ownInferred?.end,
            );
            const isOwnPredicted = isBetween(
              day,
              viewModel.predictionStart,
              viewModel.predictionEnd,
            );
            const isPartnerActual = isBetween(
              day,
              cycleRanges.partnerActual?.start,
              cycleRanges.partnerActual?.end,
            );
            const isPartnerPredicted = isBetween(
              day,
              cycleRanges.partnerPrediction?.start,
              cycleRanges.partnerPrediction?.end,
            );
            const isSelected = String(day) === selectedDate;
            const hasRecord = recordDates.has(String(day));
            const hasEvent = eventDates.has(String(day));
            const rangeLabels = [
              isOwnActual ? '내 실제 기록' : undefined,
              isOwnInferred ? '내 종료일 추정 구간' : undefined,
              isOwnPredicted ? '내 다음 예상 범위' : undefined,
              isPartnerActual ? '파트너 실제 기록' : undefined,
              isPartnerPredicted ? '파트너 다음 예상 범위' : undefined,
            ].filter((value): value is string => Boolean(value));
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${String(day)}${
                  rangeLabels.length > 0 ? `, ${rangeLabels.join(', ')}` : ''
                }${hasRecord ? ', 기록 있음' : ''}${
                  hasEvent ? ', 공동 일정 있음' : ''
                }`}
                accessibilityState={{ selected: isSelected }}
                key={day}
                onPress={() => setSelectedDate(String(day))}
                style={styles.dayCell}
              >
                <View
                  style={[
                    styles.dayCircle,
                    isOwnPredicted && styles.predictedDay,
                    isOwnInferred && styles.inferredDay,
                    isOwnActual && styles.actualDay,
                    isToday && styles.today,
                    isSelected && styles.selectedDay,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      !inMonth && styles.dayOutside,
                      isOwnPredicted && styles.predictedText,
                      isOwnInferred && styles.inferredText,
                      isOwnActual && styles.dayActiveText,
                      isToday && !isOwnActual && styles.todayText,
                    ]}
                  >
                    {parts.day}
                  </Text>
                </View>
                <View style={styles.dayMarkers}>
                  {hasRecord ? (
                    <View style={[styles.dayMarker, styles.recordMarker]} />
                  ) : null}
                  {hasEvent ? (
                    <View style={[styles.dayMarker, styles.eventMarker]} />
                  ) : null}
                  {isPartnerActual ? (
                    <View style={styles.partnerActualMarker} />
                  ) : null}
                  {isPartnerPredicted ? (
                    <View style={styles.partnerPredictedMarker} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.legend}>
          {cycleRanges.ownActual ? (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.actualDot]} />
              <Text style={styles.legendText}>내 실제 기록</Text>
            </View>
          ) : null}
          {cycleRanges.ownInferred ? (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.inferredDot]} />
              <Text style={styles.legendText}>내 종료일 추정</Text>
            </View>
          ) : null}
          {viewModel.predictionStart ? (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.predictedDot]} />
              <Text style={styles.legendText}>내 예상 범위</Text>
            </View>
          ) : null}
          {cycleRanges.partnerActual ? (
            <View style={styles.legendItem}>
              <View
                style={[styles.partnerLegendMark, styles.partnerActualMarker]}
              />
              <Text style={styles.legendText}>파트너 실제 기록</Text>
            </View>
          ) : null}
          {cycleRanges.partnerPrediction ? (
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.partnerLegendMark,
                  styles.partnerPredictedMarker,
                ]}
              />
              <Text style={styles.legendText}>파트너 예상 범위</Text>
            </View>
          ) : null}
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.todayDot]} />
            <Text style={styles.legendText}>오늘</Text>
          </View>
        </View>
      </Card>

      <SectionHeader title="다가오는 일정" />
      <Card style={styles.eventCard}>
        <View style={styles.eventDate}>
          <Text style={styles.eventMonth}>
            {viewModel.predictedDate
              ? dateParts(viewModel.predictedDate).month
              : '–'}
            월
          </Text>
          <Text style={styles.eventDay}>
            {viewModel.predictedDate
              ? dateParts(viewModel.predictedDate).day
              : '–'}
          </Text>
        </View>
        <View style={styles.eventCopy}>
          <Text style={styles.eventTitle}>
            {state.isLogger && state.hasCycleSeed
              ? '다음 생리 예상 기준일'
              : state.isLogger
              ? '내 주기 예측 기준이 없어요'
              : '내 주기 기록을 사용하지 않아요'}
          </Text>
          <Text style={styles.eventBody}>
            {!state.isLogger
              ? state.paired
                ? '상대가 직접 공유한 정보만 확인할 수 있어요.'
                : '주기 예측 없이 오늘의 컨디션 기록을 사용할 수 있어요.'
              : !state.hasCycleSeed
              ? '최근 시작일과 평균을 설정하면 참고용 범위를 계산해요.'
              : viewModel.predictionStart && viewModel.predictionEnd
              ? `${formatKoreanDate(
                  viewModel.predictionStart,
                )}부터 ${formatKoreanDate(
                  viewModel.predictionEnd,
                )} 사이로 넓게 봐주세요.`
              : '기록이 더 쌓이면 예상 범위를 보여드려요.'}
          </Text>
        </View>
        <Chip label="참고용" />
      </Card>

      <SectionHeader
        title={`${formatKoreanDate(parseLocalDate(selectedDate))} 기록`}
      />
      {selectedHistory ? (
        <Card style={styles.historyCard}>
          <Text style={styles.historyTitle}>내 컨디션 기록</Text>
          <Text style={styles.historyBody}>
            {[
              selectedHistory.checkIn.mood,
              ...selectedHistory.checkIn.symptoms,
              selectedHistory.checkIn.energy
                ? `에너지 ${selectedHistory.checkIn.energy}`
                : undefined,
              selectedHistory.checkIn.condition,
              selectedHistory.checkIn.carePreference,
              selectedHistory.checkIn.periodStarted ? '주기 시작' : undefined,
              selectedHistory.checkIn.periodEnded ? '주기 종료' : undefined,
            ]
              .filter(Boolean)
              .join(' · ') || '선택 항목 없이 기록했어요.'}
          </Text>
          {selectedHistory.checkIn.note ? (
            <Text style={styles.historyNote}>
              {selectedHistory.checkIn.note}
            </Text>
          ) : null}
          <View style={styles.historyActions}>
            <SecondaryButton
              compact
              danger
              label={backendBusy ? '삭제 중…' : '기록 삭제'}
              disabled={backendBusy}
              onPress={confirmDeleteDailyLog}
            />
          </View>
        </Card>
      ) : (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            이 날짜에 저장된 내 기록이 없어요.
          </Text>
        </Card>
      )}

      <SectionHeader
        title="기념일·공동 일정"
        action={
          state.paired && !eventDraft ? (
            <TextButton
              label="추가"
              onPress={beginCreateEvent}
              disabled={backendBusy}
            />
          ) : undefined
        }
      />
      {!state.paired ? (
        <Card tone="mint" style={styles.sharedCalendarCard}>
          <Text style={styles.sharedIcon}>＋</Text>
          <View style={styles.sharedCopy}>
            <Text style={styles.sharedTitle}>파트너 연결은 선택 사항</Text>
            <Text style={styles.sharedBody}>
              혼자 기록을 계속 사용하다가 필요할 때 공동 일정을 켤 수 있어요.
            </Text>
          </View>
        </Card>
      ) : null}

      {state.paired && selectedEvents.length === 0 && !eventDraft ? (
        <Card tone="mint" style={styles.emptyCard}>
          <Text style={styles.emptyText}>이 날짜에 공동 일정이 없어요.</Text>
        </Card>
      ) : null}

      {selectedEvents.map(event => (
        <Card key={event.id} tone="mint" style={styles.sharedEventCard}>
          <View style={styles.sharedEventHeader}>
            <View style={styles.sharedEventCopy}>
              <Text style={styles.sharedTitle}>{event.title}</Text>
              <Text style={styles.sharedBody}>
                {[event.startTime, event.endTime].filter(Boolean).join(' – ') ||
                  '종일'}
              </Text>
            </View>
            <TextButton
              label="수정"
              disabled={backendBusy}
              onPress={() =>
                setEventDraft({
                  id: event.id,
                  title: event.title,
                  date: event.date,
                  ...(event.startTime ? { startTime: event.startTime } : {}),
                  ...(event.endTime ? { endTime: event.endTime } : {}),
                  ...(event.note ? { note: event.note } : {}),
                })
              }
            />
          </View>
          {event.note ? (
            <Text style={styles.eventNote}>{event.note}</Text>
          ) : null}
          <View style={styles.eventActions}>
            <SecondaryButton
              compact
              danger
              label="삭제"
              disabled={backendBusy}
              onPress={() => confirmDeleteEvent(event.id, event.title)}
            />
          </View>
        </Card>
      ))}

      {eventDraft ? (
        <Card style={styles.editorCard}>
          <Text style={styles.editorTitle}>
            {state.sharedEvents.some(event => event.id === eventDraft.id)
              ? '공동 일정 수정'
              : '공동 일정 추가'}
          </Text>
          <Text style={styles.inputLabel}>제목</Text>
          <TextInput
            accessibilityLabel="공동 일정 제목"
            editable={!backendBusy}
            maxLength={80}
            placeholder="예: 병원 예약, 기념일"
            placeholderTextColor={colors.textSubtle}
            value={eventDraft.title}
            onChangeText={title =>
              setEventDraft(current => (current ? { ...current, title } : null))
            }
            style={styles.input}
          />
          <Text style={styles.inputLabel}>날짜</Text>
          <TextInput
            accessibilityLabel="공동 일정 날짜"
            autoCapitalize="none"
            editable={!backendBusy}
            maxLength={10}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSubtle}
            value={eventDraft.date}
            onChangeText={date =>
              setEventDraft(current => (current ? { ...current, date } : null))
            }
            style={[
              styles.input,
              eventDraft.date.trim().length > 0 &&
                !isLocalDate(eventDraft.date.trim()) &&
                styles.inputInvalid,
            ]}
          />
          {eventDraft.date.trim().length > 0 &&
          !isLocalDate(eventDraft.date.trim()) ? (
            <Text style={styles.inputError}>
              실제 달력 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.
            </Text>
          ) : null}
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.inputLabel}>시작 시간</Text>
              <TextInput
                accessibilityLabel="공동 일정 시작 시간"
                editable={!backendBusy}
                maxLength={5}
                placeholder="09:00"
                placeholderTextColor={colors.textSubtle}
                value={eventDraft.startTime ?? ''}
                onChangeText={startTime =>
                  setEventDraft(current =>
                    current ? { ...current, startTime } : null,
                  )
                }
                style={styles.input}
              />
            </View>
            <View style={styles.timeField}>
              <Text style={styles.inputLabel}>종료 시간</Text>
              <TextInput
                accessibilityLabel="공동 일정 종료 시간"
                editable={!backendBusy}
                maxLength={5}
                placeholder="10:00"
                placeholderTextColor={colors.textSubtle}
                value={eventDraft.endTime ?? ''}
                onChangeText={endTime =>
                  setEventDraft(current =>
                    current ? { ...current, endTime } : null,
                  )
                }
                style={styles.input}
              />
            </View>
          </View>
          <Text style={styles.inputLabel}>메모</Text>
          <TextInput
            accessibilityLabel="공동 일정 메모"
            editable={!backendBusy}
            maxLength={500}
            multiline
            placeholder="두 사람에게 필요한 메모"
            placeholderTextColor={colors.textSubtle}
            value={eventDraft.note ?? ''}
            onChangeText={note =>
              setEventDraft(current => (current ? { ...current, note } : null))
            }
            style={[styles.input, styles.noteInput]}
            textAlignVertical="top"
          />
          <View style={styles.editorActions}>
            <View style={styles.editorAction}>
              <SecondaryButton
                label="취소"
                disabled={backendBusy}
                onPress={() => setEventDraft(null)}
              />
            </View>
            <View style={styles.editorAction}>
              <PrimaryButton
                disabled={
                  backendBusy ||
                  !eventDraft.title.trim() ||
                  !isLocalDate(eventDraft.date.trim()) ||
                  !isValidEventTimes(eventDraft.startTime, eventDraft.endTime)
                }
                label={backendBusy ? '저장 중…' : '저장'}
                onPress={() => {
                  saveEvent().catch(() => undefined);
                }}
              />
            </View>
          </View>
          <Text style={styles.editorPrivacy}>
            제목과 메모는 Analytics·잠금화면 알림에 포함하지 않아요.
          </Text>
        </Card>
      ) : null}

      {backendError && retryOperation ? (
        <View accessibilityRole="alert" style={styles.errorCard}>
          <Text style={styles.errorText}>{backendError}</Text>
          <TextButton
            label="다시 시도"
            disabled={backendBusy}
            onPress={() => {
              retryLastOperation().catch(() => undefined);
            }}
          />
        </View>
      ) : null}

      <Body muted style={styles.disclaimer}>
        가임기·배란일은 표시하지 않으며, 예상 범위는 의료 또는 피임 판단에
        사용할 수 없습니다.
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: spacing.xs,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: '900' },
  privateBadge: {
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  privateBadgeText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: '800',
  },
  calendarCard: { padding: spacing.lg },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  monthButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  monthArrow: { color: colors.primaryDark, fontSize: 28, lineHeight: 32 },
  monthTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  weekRow: { flexDirection: 'row', marginBottom: spacing.sm },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '700',
  },
  sunday: { color: colors.accent },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actualDay: { backgroundColor: colors.accent },
  inferredDay: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    borderStyle: 'dashed',
  },
  predictedDay: { backgroundColor: colors.primarySoft },
  today: { borderWidth: 1.5, borderColor: colors.primary },
  selectedDay: {
    borderWidth: 2,
    borderColor: colors.primaryDark,
    borderStyle: 'solid',
  },
  dayText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  dayOutside: { color: colors.border },
  predictedText: { color: colors.primaryDark, fontWeight: '800' },
  inferredText: { color: colors.text, fontWeight: '800' },
  dayActiveText: { color: '#FFFFFF', fontWeight: '900' },
  todayText: { color: colors.primaryDark, fontWeight: '900' },
  dayMarkers: { height: 4, flexDirection: 'row', gap: 2, marginTop: 1 },
  dayMarker: { width: 4, height: 4, borderRadius: 2 },
  recordMarker: { backgroundColor: colors.accent },
  eventMarker: { backgroundColor: colors.mint },
  partnerActualMarker: {
    width: 8,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.mint,
  },
  partnerPredictedMarker: {
    width: 8,
    height: 4,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.mint,
    backgroundColor: colors.surface,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  actualDot: { backgroundColor: colors.accent },
  inferredDot: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    borderStyle: 'dashed',
  },
  predictedDot: { backgroundColor: colors.primarySoft },
  partnerLegendMark: { width: 10 },
  todayDot: { borderWidth: 1, borderColor: colors.primary },
  legendText: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  eventCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  eventDate: {
    width: 48,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventMonth: { color: colors.primary, fontSize: 10, fontWeight: '900' },
  eventDay: { color: colors.primaryDark, fontSize: 22, fontWeight: '900' },
  eventCopy: { flex: 1, gap: spacing.xs },
  eventTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  eventBody: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  historyCard: { gap: spacing.sm },
  historyTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  historyBody: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  historyNote: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  historyActions: { alignItems: 'flex-end', marginTop: spacing.xs },
  emptyCard: { alignItems: 'center', justifyContent: 'center', minHeight: 72 },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  sharedCalendarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  sharedIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    color: colors.mint,
    textAlign: 'center',
    lineHeight: 38,
    fontSize: 25,
  },
  sharedCopy: { flex: 1, gap: spacing.xs },
  sharedTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  sharedBody: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  sharedEventCard: { gap: spacing.sm, marginBottom: spacing.sm },
  sharedEventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  sharedEventCopy: { flex: 1, gap: spacing.xs },
  eventNote: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  eventActions: { alignItems: 'flex-end' },
  editorCard: { gap: spacing.sm },
  editorTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: spacing.sm,
  },
  inputLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  input: {
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputInvalid: { borderColor: colors.danger },
  inputError: { color: colors.danger, fontSize: 10, lineHeight: 15 },
  timeRow: { flexDirection: 'row', gap: spacing.sm },
  timeField: { flex: 1 },
  noteInput: { minHeight: 96 },
  editorActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  editorAction: { flex: 1 },
  editorPrivacy: {
    color: colors.textSubtle,
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
  },
  errorCard: {
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  errorText: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  disclaimer: {
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
