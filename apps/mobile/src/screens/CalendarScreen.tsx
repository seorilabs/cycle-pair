import { sharedFields } from '../app/sharedFieldPresentation';
import { formatDate, useI18n } from '../i18n/I18nProvider';
import {
  daysBetween,
  isLocalDate,
  parseLocalDate,
  type LocalDate,
} from '@cyclepair/product-core';
import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { recordedPeriods } from '../app/periodCalendar';
import { PeriodBoundaryEditor } from '../components/PeriodBoundaryEditor';
import { buildCycleViewModel } from '../app/cycleViewModel';
import { observedRecordSummary } from '../app/observedRecordSummary';
import { MoodHistoryCard } from '../components/ObservedDays';
import { AppIcon } from '../components/AppArtwork';
import { buildCalendarCycleRanges } from '../app/calendarCycleRanges';
import {
  buildCalendarMonthRows,
  shiftCalendarMonth,
} from '../app/calendarMonth';
import { useCyclePair } from '../app/CyclePairStore';
import {
  buildPartnerTodaySummary,
  getSafePartnerProjectionForToday,
} from '../app/partnerProjectionPresentation';
import { LocalDatePickerField } from '../components/LocalDatePickerField';
import type { PairEventInput } from '../platform/backend/CyclePairBackend';
import {
  Card,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextButton,
} from '../components/Ui';
import { colors, radius, spacing } from '../theme';

interface SelectedCycleAgendaItem {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly owner: 'mine' | 'partner';
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

export function CalendarScreen({
  onOpenRecord,
}: {
  onOpenRecord(date?: string): void;
}) {
  const { l, t, label, locale } = useI18n();
  const [recordOpen, setRecordOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const weekdays = Array.from({ length: 7 }, (_, day) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(
      new Date(2026, 9, 18 + day),
    ),
  );
  const weekdayLabels = Array.from({ length: 7 }, (_, day) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(
      new Date(2026, 9, 18 + day),
    ),
  );
  const {
    state,
    backendBusy,
    backendError,
    deleteDailyLog,
    upsertPairEvent,
    deletePairEvent,
    dailyHistoryStatus,
    retryDailyHistory,
    reloadPrivateHistory,
  } = useCyclePair();
  const viewModel = buildCycleViewModel(state);
  const periods = recordedPeriods(state);
  const actualRanges = periods.map(period => ({
    start: period.start ?? period.end!,
    end: period.end ?? period.start!,
  }));
  const observed = observedRecordSummary(
    state.dailyHistory,
    parseLocalDate(state.currentLocalDate),
  );
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
  const monthRows = useMemo(
    () => buildCalendarMonthRows(cursor.year, cursor.month),
    [cursor],
  );
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
  const selectedLocalDate = parseLocalDate(selectedDate);
  const partnerTodaySummary = buildPartnerTodaySummary(safePartnerProjection);
  const selectedCycleAgenda: SelectedCycleAgendaItem[] = [];
  if (
    actualRanges.some(range =>
      isBetween(selectedLocalDate, range.start, range.end),
    )
  ) {
    selectedCycleAgenda.push({
      id: 'own-actual',
      title: l('내 생리 기록'),
      detail: l('직접 기록한 생리 기간에 포함돼요.'),
      owner: 'mine',
    });
  }
  if (
    isBetween(
      selectedLocalDate,
      cycleRanges.ownInferred?.start,
      cycleRanges.ownInferred?.end,
    )
  ) {
    selectedCycleAgenda.push({
      id: 'own-inferred',
      title: l('내 생리 종료 예상 구간 · 참고용'),
      detail: l('평균 생리 기간을 기준으로 계산한 참고 일정이에요.'),
      owner: 'mine',
    });
  }
  if (
    isBetween(
      selectedLocalDate,
      viewModel.predictionStart,
      viewModel.predictionEnd,
    )
  ) {
    selectedCycleAgenda.push({
      id: 'own-prediction',
      title: l('내 다음 생리 예상 범위 · 참고용'),
      detail: l('기록을 바탕으로 계산한 넓은 참고 범위예요.'),
      owner: 'mine',
    });
  }
  if (
    isBetween(
      selectedLocalDate,
      cycleRanges.partnerActual?.start,
      cycleRanges.partnerActual?.end,
    )
  ) {
    selectedCycleAgenda.push({
      id: 'partner-actual',
      title: l('{v0} 님의 생리 기록', {
        v0: state.partnerName === '파트너' ? t('Partner') : state.partnerName,
      }),
      detail: l('파트너가 직접 공유한 생리 기간이에요.'),
      owner: 'partner',
    });
  }
  if (
    isBetween(
      selectedLocalDate,
      cycleRanges.partnerPrediction?.start,
      cycleRanges.partnerPrediction?.end,
    )
  ) {
    selectedCycleAgenda.push({
      id: 'partner-prediction',
      title: l('{v0} 님의 다음 생리 예상 범위 · 참고용', {
        v0: state.partnerName === '파트너' ? t('Partner') : state.partnerName,
      }),
      detail: l('파트너가 공유한 참고용 예상 범위예요.'),
      owner: 'partner',
    });
  }
  if (
    selectedDate === String(viewModel.today) &&
    safePartnerProjection?.cycleStatus &&
    !selectedCycleAgenda.some(item => item.id === 'partner-actual')
  ) {
    selectedCycleAgenda.push({
      id: 'partner-today-status',
      title:
        (locale === 'en'
          ? sharedFields(safePartnerProjection, locale).find(
              field => field.key === 'cycleStatus',
            )?.value
          : partnerTodaySummary.cycleTitle) ??
        l('{v0} 님의 오늘 주기 상태', {
          v0: state.partnerName === '파트너' ? t('Partner') : state.partnerName,
        }),
      detail:
        locale === 'en'
          ? l('파트너가 공유한 오늘의 상태예요.')
          : partnerTodaySummary.cycleDetail ??
            l('파트너가 공유한 오늘의 상태예요.'),
      owner: 'partner',
    });
  }

  function shiftMonth(offset: number) {
    setCursor(current => shiftCalendarMonth(current, offset));
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
      l('기록 삭제'),
      l('{v0}의 컨디션 기록을 삭제할까요? 이 작업은 되돌릴 수 없어요.{v1}', {
        v0: formatDate(selectedHistory.localDate, locale),
        v1: includesCycleBoundary
          ? '\n\n설정에 저장된 주기 시작·종료 기준은 유지돼요.'
          : '',
      }),
      [
        { text: l('취소'), style: 'cancel' },
        {
          text: l('삭제'),
          style: 'destructive',
          onPress: () => {
            removeDailyLog(selectedHistory.localDate).catch(() => undefined);
          },
        },
      ],
    );
  }

  function confirmDeleteEvent(eventId: string, title: string) {
    Alert.alert(
      l('공동 일정 삭제'),
      l('“{v0}” 일정을 삭제할까요?', { v0: title }),
      [
        { text: l('취소'), style: 'cancel' },
        {
          text: l('삭제'),
          style: 'destructive',
          onPress: () => {
            removeEvent(eventId).catch(() => undefined);
          },
        },
      ],
    );
  }

  return (
    <Screen
      contentStyle={styles.content}
      footer={
        <View style={styles.dock}>
          {state.syncStatus === 'queued' ? (
            <Text
              testID="calendar-sync-status"
              accessibilityLiveRegion="polite"
              style={styles.historyStatus}
            >
              {t('Saved here. Waiting to sync.')}
            </Text>
          ) : null}
          <Text style={styles.selectedDayEyebrow}>
            {formatDate(selectedLocalDate, locale)}
          </Text>
          <PrimaryButton
            testID="calendar-log-period"
            label={t(state.isLogger ? 'Log period' : 'Record this date')}
            disabled={
              backendBusy ||
              dailyHistoryStatus !== 'ready' ||
              selectedDate > state.currentLocalDate
            }
            onPress={() => {
              if (state.isLogger) setPeriodOpen(true);
              else onOpenRecord(selectedDate);
            }}
          />
        </View>
      }
    >
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <Text style={styles.eyebrow}>
            {state.paired ? l('함께 보는 일정') : l('나만의 일정')}
          </Text>
          <Text style={styles.title}>{t('Your days, gently reflected')}</Text>
        </View>
        <View style={styles.privateBadge}>
          <Text style={styles.privateBadgeText}>{l('내 원본')}</Text>
        </View>
      </View>

      {dailyHistoryStatus === 'ready' ? (
        !state.isLogger ? (
          <MoodHistoryCard
            summary={observed}
            onOpenRecord={() => onOpenRecord()}
          />
        ) : null
      ) : (
        <Card>
          <AppIcon name="journal" size={28} />
          <Text style={styles.historyStatus}>
            {t(
              dailyHistoryStatus === 'error'
                ? 'Could not load records'
                : dailyHistoryStatus === 'slow'
                ? 'Your records are taking longer to load.'
                : 'Loading record…',
            )}
          </Text>
          {dailyHistoryStatus !== 'loading' ? (
            <TextButton
              label={t('Retry')}
              onPress={() => {
                retryDailyHistory().catch(() => undefined);
              }}
            />
          ) : null}
        </Card>
      )}

      <Card style={styles.calendarCard}>
        <View style={styles.monthHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={l('이전 달')}
            onPress={() => shiftMonth(-1)}
            style={styles.monthButton}
          >
            <Text style={styles.monthArrow}>‹</Text>
          </Pressable>
          <Text style={styles.monthTitle}>
            {new Intl.DateTimeFormat(locale, {
              year: 'numeric',
              month: 'long',
            }).format(new Date(cursor.year, cursor.month - 1, 1))}
          </Text>
          <TextButton
            testID="calendar-today"
            label={t('Today')}
            onPress={() => {
              setSelectedDate(String(viewModel.today));
              setCursor({ year: todayParts.year, month: todayParts.month });
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={l('다음 달')}
            onPress={() => shiftMonth(1)}
            style={styles.monthButton}
          >
            <Text style={styles.monthArrow}>›</Text>
          </Pressable>
        </View>
        <View style={styles.weekRow}>
          {weekdayLabels.map((weekday, index) => (
            <Text
              key={String(index)}
              testID={`calendar-weekday-${index}`}
              accessibilityLabel={weekdays[index]}
              style={[styles.weekday, index === 0 && styles.sunday]}
            >
              {weekday}
            </Text>
          ))}
        </View>
        <View style={styles.grid}>
          {monthRows.map((week, weekIndex) => (
            <View
              key={String(week[0])}
              style={styles.calendarRow}
              testID={`calendar-week-${weekIndex}`}
            >
              {week.map((day, weekdayIndex) => {
                const parts = dateParts(day);
                const inMonth = parts.month === cursor.month;
                const isToday = day === viewModel.today;
                const isOwnActual = actualRanges.some(range =>
                  isBetween(day, range.start, range.end),
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
                  isOwnActual ? l('내 실제 기록') : undefined,
                  isOwnInferred ? l('내 종료일 추정 구간') : undefined,
                  isOwnPredicted ? l('내 다음 예상 범위') : undefined,
                  isPartnerActual ? l('파트너 실제 기록') : undefined,
                  isPartnerPredicted ? l('파트너 다음 예상 범위') : undefined,
                ].filter((value): value is string => Boolean(value));
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={l('{v0}, {v1}요일{v2}{v3}{v4}', {
                      v0: String(day),
                      v1: weekdays[weekdayIndex],
                      v2:
                        rangeLabels.length > 0
                          ? `, ${rangeLabels.join(', ')}`
                          : '',
                      v3: hasRecord ? `, ${l('기록 있음')}` : '',
                      v4: hasEvent ? `, ${l('공동 일정 있음')}` : '',
                    })}
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
          ))}
        </View>
        <View style={styles.legend}>
          {actualRanges.length ? (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.actualDot]} />
              <Text style={styles.legendText}>{t('Actual period')}</Text>
            </View>
          ) : null}
          {cycleRanges.ownInferred ? (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.inferredDot]} />
              <Text style={styles.legendText}>{l('내 종료일 추정')}</Text>
            </View>
          ) : null}
          {viewModel.predictionStart ? (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.predictedDot]} />
              <Text style={styles.legendText}>
                {l('내 예상 범위 · 참고용')}
              </Text>
            </View>
          ) : null}
          {cycleRanges.partnerActual ? (
            <View style={styles.legendItem}>
              <View
                style={[styles.partnerLegendMark, styles.partnerActualMarker]}
              />
              <Text style={styles.legendText}>{l('파트너 실제 기록')}</Text>
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
              <Text style={styles.legendText}>
                {l('파트너 예상 범위 · 참고용')}
              </Text>
            </View>
          ) : null}
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.todayDot]} />
            <Text style={styles.legendText}>{l('오늘')}</Text>
          </View>
        </View>

        <View style={styles.selectedDaySection}>
          <View style={styles.selectedDayHeader}>
            <View style={styles.selectedDayCopy}>
              <Text style={styles.selectedDayEyebrow}>{l('선택한 날짜')}</Text>
              <Text style={styles.selectedDayTitle}>
                {formatDate(selectedLocalDate, locale)}
              </Text>
            </View>
            {state.paired && !eventDraft ? (
              <TextButton
                label={l('일정 추가')}
                onPress={beginCreateEvent}
                disabled={backendBusy}
              />
            ) : null}
          </View>

          <View style={styles.selectedAgendaList}>
            {selectedCycleAgenda.map(item => (
              <View key={item.id} style={styles.agendaRow}>
                <View
                  style={[
                    styles.agendaMarker,
                    item.owner === 'partner' && styles.partnerAgendaMarker,
                  ]}
                />
                <View style={styles.agendaCopy}>
                  <Text style={styles.agendaTitle}>{item.title}</Text>
                  <Text style={styles.agendaBody}>{item.detail}</Text>
                </View>
              </View>
            ))}

            {selectedEvents.map(event => (
              <View key={event.id} style={styles.agendaRow}>
                <View style={[styles.agendaMarker, styles.eventAgendaMarker]} />
                <View style={styles.agendaCopy}>
                  <View style={styles.agendaTitleRow}>
                    <View style={styles.sharedEventCopy}>
                      <Text style={styles.agendaTitle}>{event.title}</Text>
                      <Text style={styles.agendaBody}>
                        {[event.startTime, event.endTime]
                          .filter(Boolean)
                          .join(' – ') || l('종일')}
                      </Text>
                    </View>
                    <View style={styles.compactActions}>
                      <TextButton
                        label={l('수정')}
                        disabled={backendBusy}
                        onPress={() =>
                          setEventDraft({
                            id: event.id,
                            title: event.title,
                            date: event.date,
                            ...(event.startTime
                              ? { startTime: event.startTime }
                              : {}),
                            ...(event.endTime
                              ? { endTime: event.endTime }
                              : {}),
                            ...(event.note ? { note: event.note } : {}),
                          })
                        }
                      />
                      <TextButton
                        label={l('삭제')}
                        disabled={backendBusy}
                        onPress={() =>
                          confirmDeleteEvent(event.id, event.title)
                        }
                      />
                    </View>
                  </View>
                  {event.note ? (
                    <Text style={styles.eventNote}>{event.note}</Text>
                  ) : null}
                </View>
              </View>
            ))}

            {selectedHistory ? (
              <TextButton
                label={t('View record')}
                onPress={() => setRecordOpen(true)}
              />
            ) : null}

            {selectedDate <= state.currentLocalDate ? (
              <TextButton
                label={t(selectedHistory ? 'Edit record' : 'Record this date')}
                disabled={backendBusy || dailyHistoryStatus !== 'ready'}
                onPress={() => onOpenRecord(selectedDate)}
              />
            ) : (
              <Text style={styles.agendaBody}>
                {t(
                  'Future dates are for estimates. Record what happened today or earlier.',
                )}
              </Text>
            )}

            {selectedCycleAgenda.length === 0 &&
            selectedEvents.length === 0 &&
            !selectedHistory ? (
              <Text style={styles.emptyText}>
                {l(
                  '이 날짜에 표시할 주기 구간, 공동 일정, 컨디션 기록이 없어요.',
                )}
              </Text>
            ) : null}
          </View>
        </View>
      </Card>

      {state.isLogger ? (
        <Card style={styles.historyCard}>
          <Text style={styles.editorTitle}>{t('Period history')}</Text>
          {periods.length ? (
            periods
              .slice()
              .reverse()
              .map((period, index) => (
                <Pressable
                  key={`${period.start ?? 'unknown'}-${period.end ?? index}`}
                  testID={`period-history-${index}`}
                  accessibilityRole="button"
                  onPress={() => {
                    const date = period.start ?? period.end!;
                    setSelectedDate(date);
                    const parts = dateParts(date);
                    setCursor({ year: parts.year, month: parts.month });
                  }}
                  style={styles.historyItem}
                >
                  <Text style={styles.agendaTitle}>
                    {period.start
                      ? formatDate(period.start, locale)
                      : t('Start not recorded')}{' '}
                    —{' '}
                    {period.end
                      ? formatDate(period.end, locale)
                      : t('End not recorded')}
                  </Text>
                  {period.lengthDays ? (
                    <Text style={styles.agendaBody}>
                      {t('{count} days', { count: period.lengthDays })}
                    </Text>
                  ) : null}
                </Pressable>
              ))
          ) : (
            <Text style={styles.agendaBody}>
              {t('No period dates recorded yet.')}
            </Text>
          )}
        </Card>
      ) : null}
      {state.isLogger && dailyHistoryStatus === 'ready' ? (
        <MoodHistoryCard
          summary={observed}
          onOpenRecord={() => onOpenRecord()}
        />
      ) : null}
      {periodOpen ? (
        <PeriodBoundaryEditor
          date={selectedDate}
          value={{
            periodStarted: Boolean(
              selectedHistory?.checkIn.periodStarted ||
                (state.hasCycleSeed &&
                  state.seed.lastPeriodStart === selectedDate),
            ),
            periodEnded: Boolean(
              selectedHistory?.checkIn.periodEnded ||
                (state.hasCycleSeed &&
                  state.seed.lastPeriodEnd === selectedDate),
            ),
          }}
          onClose={() => setPeriodOpen(false)}
        />
      ) : null}

      <Modal
        visible={recordOpen}
        onRequestClose={() => {
          if (!backendBusy) setRecordOpen(false);
        }}
        animationType="slide"
      >
        <Screen>
          <TextButton
            label={t('Back')}
            disabled={backendBusy}
            onPress={() => setRecordOpen(false)}
          />
          {backendError && retryOperation?.type === 'delete-record' ? (
            <View accessibilityRole="alert" style={styles.errorCard}>
              <Text style={styles.errorText}>{l(backendError)}</Text>
              <TextButton
                testID="calendar-delete-reload"
                label={t('Reload saved records')}
                disabled={backendBusy}
                onPress={() => {
                  reloadPrivateHistory()
                    .then(() => setRetryOperation(null))
                    .catch(() => undefined);
                }}
              />
            </View>
          ) : null}
          {selectedHistory ? (
            <View style={styles.agendaRow}>
              <View style={[styles.agendaMarker, styles.recordAgendaMarker]} />
              <View style={styles.agendaCopy}>
                <View style={styles.agendaTitleRow}>
                  <Text style={styles.agendaTitle}>{l('내 컨디션 기록')}</Text>
                  <TextButton
                    label={backendBusy ? l('삭제 중…') : l('기록 삭제')}
                    disabled={backendBusy}
                    onPress={confirmDeleteDailyLog}
                  />
                </View>
                <Text style={styles.agendaBody}>
                  {[
                    ...(selectedHistory.checkIn.emotions ?? []).map(label),
                    ...selectedHistory.checkIn.symptoms.map(label),
                    selectedHistory.checkIn.energy
                      ? l('에너지 {v0}', { v0: selectedHistory.checkIn.energy })
                      : undefined,
                    selectedHistory.checkIn.condition
                      ? label(selectedHistory.checkIn.condition)
                      : undefined,
                    selectedHistory.checkIn.carePreference
                      ? label(selectedHistory.checkIn.carePreference)
                      : undefined,
                    selectedHistory.checkIn.periodStarted
                      ? l('주기 시작')
                      : undefined,
                    selectedHistory.checkIn.periodEnded
                      ? l('주기 종료')
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ') || l('선택 항목 없이 기록했어요.')}
                </Text>
                {selectedHistory.checkIn.note ? (
                  <Text style={styles.eventNote}>
                    {selectedHistory.checkIn.note}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}
        </Screen>
      </Modal>

      <Modal
        visible={Boolean(eventDraft)}
        animationType="slide"
        onRequestClose={() => {
          if (!backendBusy) setEventDraft(null);
        }}
      >
        <Screen>
          <TextButton
            label={t('Back')}
            disabled={backendBusy}
            onPress={() => setEventDraft(null)}
          />
          {eventDraft ? (
            <Card style={styles.editorCard}>
              <Text style={styles.editorTitle}>
                {state.sharedEvents.some(event => event.id === eventDraft.id)
                  ? l('공동 일정 수정')
                  : l('공동 일정 추가')}
              </Text>
              <Text style={styles.inputLabel}>{l('제목')}</Text>
              <TextInput
                accessibilityLabel={l('공동 일정 제목')}
                editable={!backendBusy}
                maxLength={80}
                placeholder={l('예: 병원 예약, 기념일')}
                placeholderTextColor={colors.textSubtle}
                value={eventDraft.title}
                onChangeText={title =>
                  setEventDraft(current =>
                    current ? { ...current, title } : null,
                  )
                }
                style={styles.input}
              />
              <Text style={styles.inputLabel}>{l('날짜')}</Text>
              <LocalDatePickerField
                accessibilityLabel={l('공동 일정 날짜')}
                disabled={backendBusy}
                value={parseLocalDate(eventDraft.date)}
                onChange={date =>
                  setEventDraft(current =>
                    current ? { ...current, date } : null,
                  )
                }
                testID="shared-event-date-picker"
              />
              <View style={styles.timeRow}>
                <View style={styles.timeField}>
                  <Text style={styles.inputLabel}>{l('시작 시간')}</Text>
                  <TextInput
                    accessibilityLabel={l('공동 일정 시작 시간')}
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
                  <Text style={styles.inputLabel}>{l('종료 시간')}</Text>
                  <TextInput
                    accessibilityLabel={l('공동 일정 종료 시간')}
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
              <Text style={styles.inputLabel}>{l('메모')}</Text>
              <TextInput
                accessibilityLabel={l('공동 일정 메모')}
                editable={!backendBusy}
                maxLength={500}
                multiline
                placeholder={l('두 사람에게 필요한 메모')}
                placeholderTextColor={colors.textSubtle}
                value={eventDraft.note ?? ''}
                onChangeText={note =>
                  setEventDraft(current =>
                    current ? { ...current, note } : null,
                  )
                }
                style={[styles.input, styles.noteInput]}
                textAlignVertical="top"
              />
              <View style={styles.editorActions}>
                <View style={styles.editorAction}>
                  <SecondaryButton
                    label={l('취소')}
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
                      !isValidEventTimes(
                        eventDraft.startTime,
                        eventDraft.endTime,
                      )
                    }
                    label={backendBusy ? l('저장 중…') : l('저장')}
                    onPress={() => {
                      saveEvent().catch(() => undefined);
                    }}
                  />
                </View>
              </View>
              <Text style={styles.editorPrivacy}>
                {l('제목과 메모는 사용 통계와 잠금화면 알림에 넣지 않아요.')}
              </Text>
            </Card>
          ) : null}

          {backendError && retryOperation ? (
            <View accessibilityRole="alert" style={styles.errorCard}>
              <Text style={styles.errorText}>{l(backendError)}</Text>
              <TextButton
                label={l('다시 시도')}
                disabled={backendBusy}
                onPress={() => {
                  retryLastOperation().catch(() => undefined);
                }}
              />
            </View>
          ) : null}
        </Screen>
      </Modal>

      {backendError && retryOperation && !eventDraft ? (
        <View accessibilityRole="alert" style={styles.errorCard}>
          <Text style={styles.errorText}>{l(backendError)}</Text>
          <TextButton
            label={l('다시 시도')}
            disabled={backendBusy}
            onPress={() => {
              retryLastOperation().catch(() => undefined);
            }}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dock: {
    padding: spacing.md,
    gap: spacing.xs,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  historyCard: { marginTop: spacing.lg },
  historyItem: {
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  historyStatus: { fontSize: 14, lineHeight: 22, color: colors.textMuted },
  content: { paddingBottom: spacing.xl },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  headerTitle: { flexShrink: 1, minWidth: 0 },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: spacing.xs,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: '900' },
  privateBadge: {
    flexShrink: 0,
    maxWidth: '100%',
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
    minWidth: 48,
    minHeight: 48,
    padding: spacing.sm,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  monthArrow: { color: colors.primaryDark, fontSize: 28, lineHeight: 32 },
  monthTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
  },
  weekRow: { flexDirection: 'row', width: '100%', marginBottom: spacing.sm },
  weekday: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '700',
  },
  sunday: { color: colors.accent },
  grid: { width: '100%' },
  calendarRow: { flexDirection: 'row', width: '100%' },
  dayCell: {
    flex: 1,
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
  predictedDay: {
    borderStyle: 'dashed',
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
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
  dayActiveText: { color: colors.text, fontWeight: '900' },
  todayText: { color: colors.primaryDark, fontWeight: '900' },
  dayMarkers: { height: 5, flexDirection: 'row', gap: 2, marginTop: 1 },
  dayMarker: { width: 4, height: 4, borderRadius: 2 },
  recordMarker: { backgroundColor: colors.accent },
  eventMarker: { backgroundColor: colors.mint },
  partnerActualMarker: {
    width: 10,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.mint,
  },
  partnerPredictedMarker: {
    width: 10,
    height: 5,
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
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: '100%',
    flexShrink: 1,
  },
  legendDot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  actualDot: { backgroundColor: colors.accent },
  inferredDot: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    borderStyle: 'dashed',
  },
  predictedDot: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
  },
  partnerLegendMark: { width: 14, flexShrink: 0 },
  todayDot: { borderWidth: 1, borderColor: colors.primary },
  legendText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    minWidth: 0,
    flexShrink: 1,
  },
  selectedDaySection: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  selectedDayHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  selectedDayCopy: { flex: 1, minWidth: 144, gap: 2 },
  selectedDayEyebrow: {
    color: colors.textSubtle,
    fontSize: 10,
    fontWeight: '800',
  },
  selectedDayTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  selectedAgendaList: { gap: 0 },
  agendaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  agendaMarker: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  partnerAgendaMarker: { backgroundColor: colors.accent },
  eventAgendaMarker: { backgroundColor: colors.mint },
  recordAgendaMarker: { backgroundColor: colors.primaryDark },
  agendaCopy: { flex: 1, gap: spacing.xs },
  agendaTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  compactActions: { flexDirection: 'row', alignItems: 'center' },
  agendaTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  agendaBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sharedEventCopy: { flex: 1, gap: spacing.xs },
  eventNote: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
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
});
