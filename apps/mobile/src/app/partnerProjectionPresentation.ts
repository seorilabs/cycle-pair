import { isLocalDate, type LocalDate } from '@cyclepair/product-core';

import type { RemotePartnerProjection } from '../platform/backend/CyclePairBackend';

export const PARTNER_PROJECTION_STALE_AFTER_MS = 36 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export type PartnerSharedFieldKey =
  | 'cyclePhase'
  | 'cycleStatus'
  | 'nextPeriodWindow'
  | 'periodDates'
  | 'moodTag'
  | 'symptomTags'
  | 'energyLevel'
  | 'conditionCode'
  | 'carePreferences'
  | 'note';

export interface PartnerSharedField {
  readonly key: PartnerSharedFieldKey;
  readonly label: string;
  readonly value: string;
}

export interface PartnerProjectionFreshness {
  readonly label: string;
  readonly stale: boolean;
}

export interface PartnerTodaySummary {
  readonly cycleTitle?: string;
  readonly cycleDetail?: string;
  readonly conditionTitle: string;
  readonly conditionDetail: string;
  readonly conditionTags: readonly string[];
}

const hasDailyValues = (projection: RemotePartnerProjection): boolean =>
  projection.moodTag !== undefined ||
  projection.symptomTags !== undefined ||
  projection.energyLevel !== undefined ||
  projection.conditionCode !== undefined ||
  projection.carePreferences !== undefined ||
  projection.note !== undefined;

const hasCycleDerivedValues = (
  projection: RemotePartnerProjection,
): boolean =>
  projection.cyclePhase !== undefined ||
  projection.cycleStatus !== undefined ||
  projection.nextPeriodWindow !== undefined;

function deviceLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Removes source-date-sensitive values before any screen or care rule uses
 * them. Explicit historical period dates remain self-describing, while a
 * daily check-in, phase, or prediction can never be presented as today's
 * state without today's source LocalDate.
 */
export function getSafePartnerProjectionForToday(
  projection?: RemotePartnerProjection | null,
  now = new Date(),
): RemotePartnerProjection | null {
  if (!projection) return null;

  const today = deviceLocalDate(now);
  const hasTodaysDailyLog = projection.dailyLogDate === today;
  const hasTodaysCycleComputation = projection.cycleAsOfDate === today;

  return {
    ownerUid: projection.ownerUid,
    pairId: projection.pairId,
    ...(projection.generatedAt ? { generatedAt: projection.generatedAt } : {}),
    ...(projection.cycleAsOfDate
      ? { cycleAsOfDate: projection.cycleAsOfDate }
      : {}),
    ...(projection.dailyLogDate
      ? { dailyLogDate: projection.dailyLogDate }
      : {}),
    ...(projection.periodDates ? { periodDates: projection.periodDates } : {}),
    ...(hasTodaysCycleComputation && projection.cyclePhase
      ? { cyclePhase: projection.cyclePhase }
      : {}),
    ...(hasTodaysCycleComputation && projection.cycleStatus
      ? { cycleStatus: projection.cycleStatus }
      : {}),
    ...(hasTodaysCycleComputation && projection.nextPeriodWindow
      ? { nextPeriodWindow: projection.nextPeriodWindow }
      : {}),
    ...(hasTodaysDailyLog && projection.symptomTags
      ? { symptomTags: projection.symptomTags }
      : {}),
    ...(hasTodaysDailyLog && projection.moodTag
      ? { moodTag: projection.moodTag }
      : {}),
    ...(hasTodaysDailyLog && projection.energyLevel
      ? { energyLevel: projection.energyLevel }
      : {}),
    ...(hasTodaysDailyLog && projection.conditionCode
      ? { conditionCode: projection.conditionCode }
      : {}),
    ...(hasTodaysDailyLog && projection.carePreferences
      ? { carePreferences: projection.carePreferences }
      : {}),
    ...(hasTodaysDailyLog && projection.note
      ? { note: projection.note }
      : {}),
  };
}

const phaseCopy: Record<
  NonNullable<RemotePartnerProjection['cyclePhase']>,
  string
> = {
  menstrual: '월경 중',
  follicular: '회복하는 시기',
  ovulatory: '가임 가능성이 높은 시기',
  luteal: '변화에 대비하는 시기',
  unknown: '기록이 더 필요함',
};

const cycleStatusCopy: Record<
  NonNullable<RemotePartnerProjection['cycleStatus']>,
  { readonly title: string; readonly detail: string }
> = {
  'period-starting': {
    title: '생리가 시작된 날이에요',
    detail: '오늘 시작 기록을 기준으로 표시해요.',
  },
  'period-in-progress': {
    title: '생리 진행 중이에요',
    detail: '평균 생리 기간을 기준으로 한 참고 상태예요.',
  },
  'period-ending': {
    title: '생리 마무리 시기에 가까워요',
    detail: '평균 생리 기간의 마지막 날로 예상돼요.',
  },
  'post-period': {
    title: '생리가 끝난 직후예요',
    detail: '평균 생리 기간이 지난 뒤의 회복 시기예요.',
  },
  'fertile-window': {
    title: '가임 가능성이 높은 시기예요',
    detail: '주기 기반 예측이며 피임 판단에는 사용할 수 없어요.',
  },
  'pre-period': {
    title: '생리 시작 전이에요',
    detail: '평균 주기를 기준으로 시작이 가까운 시기예요.',
  },
  'cycle-in-progress': {
    title: '주기가 진행 중이에요',
    detail: '공유된 주기 기준으로 오늘의 흐름을 보여줘요.',
  },
  'period-late': {
    title: '예정일이 지났어요',
    detail: '평균 주기로 계산한 예상일보다 늦어지고 있어요.',
  },
  unknown: {
    title: '주기 상태를 더 지켜보고 있어요',
    detail: '기록이 더 쌓이면 오늘 상태를 표시할 수 있어요.',
  },
};

const moodCopy: Readonly<Record<string, string>> = {
  'very-low': '많이 힘들어요',
  low: '조금 지쳐요',
  neutral: '괜찮아요',
  good: '기분이 좋아요',
  'very-good': '아주 좋아요',
};

const symptomCopy: Readonly<Record<string, string>> = {
  cramps: '복통',
  headache: '두통',
  fatigue: '피로',
  bloating: '부종',
  sensitive: '예민함',
  'back-discomfort': '허리 불편',
};

const conditionCopy: Readonly<Record<string, string>> = {
  comfortable: '편안해요',
  tired: '피곤해요',
  'low-energy': '기운이 없어요',
  'needs-space': '공간이 필요해요',
};

const carePreferenceCopy: Readonly<Record<string, string>> = {
  listen: '그냥 들어줘요',
  'quiet-space': '쉬고 싶어요',
  warmth: '따뜻하게 챙겨줘요',
  'meal-support': '식사를 챙겨줘요',
  'schedule-flexibility': '일정을 여유롭게 해줘요',
  'practical-help': '실질적인 도움을 줘요',
  'check-in': '가볍게 상태를 물어봐 줘요',
  'no-action': '평소처럼 대해줘요',
};

const energyCopy: Readonly<Record<1 | 2 | 3 | 4 | 5, string>> = {
  1: '매우 낮음',
  2: '낮음',
  3: '보통',
  4: '좋음',
  5: '매우 좋음',
};

function formatLocalDate(value: LocalDate): string {
  const [, month, day] = value.split('-').map(Number);
  return `${month}월 ${day}일`;
}

function orderedRange(range?: {
  readonly startDate: string;
  readonly endDate: string;
}): { readonly start: LocalDate; readonly end: LocalDate } | undefined {
  if (
    !range ||
    !isLocalDate(range.startDate) ||
    !isLocalDate(range.endDate) ||
    range.endDate < range.startDate
  ) {
    return undefined;
  }
  return { start: range.startDate, end: range.endDate };
}

function knownValues(
  values: readonly string[] | undefined,
  copy: Readonly<Record<string, string>>,
): readonly string[] {
  return [...new Set((values ?? []).map(value => copy[value]).filter(Boolean))];
}

/** Builds rows only from values explicitly present in the server projection. */
export function buildPartnerSharedFields(
  projection?: RemotePartnerProjection | null,
  now = new Date(),
): readonly PartnerSharedField[] {
  const safeProjection = getSafePartnerProjectionForToday(projection, now);
  if (!safeProjection) return [];
  projection = safeProjection;

  const fields: PartnerSharedField[] = [];
  if (projection.cycleStatus) {
    fields.push({
      key: 'cycleStatus',
      label: '오늘의 주기 상태',
      value: cycleStatusCopy[projection.cycleStatus].title,
    });
  } else if (projection.cyclePhase) {
    fields.push({
      key: 'cyclePhase',
      label: '현재 주기 국면',
      value: phaseCopy[projection.cyclePhase],
    });
  }

  const nextPeriodWindow = orderedRange(projection.nextPeriodWindow);
  if (nextPeriodWindow) {
    fields.push({
      key: 'nextPeriodWindow',
      label: '다음 예상 범위',
      value: `${formatLocalDate(nextPeriodWindow.start)} ~ ${formatLocalDate(
        nextPeriodWindow.end,
      )}`,
    });
  }

  const periodStart = projection.periodDates?.startDate;
  if (isLocalDate(periodStart)) {
    const periodEnd = projection.periodDates?.endDate;
    const validEnd =
      isLocalDate(periodEnd) && periodEnd >= periodStart
        ? periodEnd
        : undefined;
    fields.push({
      key: 'periodDates',
      label: '공유한 생리 날짜',
      value: validEnd
        ? `${formatLocalDate(periodStart)} ~ ${formatLocalDate(validEnd)}`
        : `${formatLocalDate(periodStart)} 시작`,
    });
  }

  const mood = projection.moodTag ? moodCopy[projection.moodTag] : undefined;
  if (mood) {
    fields.push({ key: 'moodTag', label: '기분', value: mood });
  }

  const symptoms = knownValues(projection.symptomTags, symptomCopy);
  if (symptoms.length > 0) {
    fields.push({
      key: 'symptomTags',
      label: '증상',
      value: symptoms.join(' · '),
    });
  }

  if (projection.energyLevel) {
    fields.push({
      key: 'energyLevel',
      label: '에너지',
      value: `${projection.energyLevel}/5 · ${
        energyCopy[projection.energyLevel]
      }`,
    });
  }

  const condition = projection.conditionCode
    ? conditionCopy[projection.conditionCode]
    : undefined;
  if (condition) {
    fields.push({ key: 'conditionCode', label: '컨디션', value: condition });
  }

  const preferences = knownValues(
    projection.carePreferences,
    carePreferenceCopy,
  );
  if (preferences.length > 0) {
    fields.push({
      key: 'carePreferences',
      label: '원하는 도움',
      value: preferences.join(' · '),
    });
  }

  const note = projection.note?.trim().slice(0, 500);
  if (note) {
    fields.push({ key: 'note', label: '메모', value: note });
  }

  return fields;
}

export function buildPartnerTodaySummary(
  projection?: RemotePartnerProjection | null,
  now = new Date(),
): PartnerTodaySummary {
  const safeProjection = getSafePartnerProjectionForToday(projection, now);
  const cycleStatus = safeProjection?.cycleStatus
    ? cycleStatusCopy[safeProjection.cycleStatus]
    : undefined;
  const cycleTitle =
    cycleStatus?.title ??
    (safeProjection?.cyclePhase
      ? phaseCopy[safeProjection.cyclePhase]
      : undefined);
  const cycleDetail =
    cycleStatus?.detail ??
    (safeProjection?.cyclePhase
      ? '파트너가 공유한 오늘의 주기 국면이에요.'
      : undefined);
  const fields = buildPartnerSharedFields(safeProjection, now);
  const conditionFields = fields.filter(field =>
    ['moodTag', 'symptomTags', 'energyLevel', 'conditionCode'].includes(
      field.key,
    ),
  );
  const mood = conditionFields.find(field => field.key === 'moodTag');
  const condition = conditionFields.find(
    field => field.key === 'conditionCode',
  );
  const energy = conditionFields.find(field => field.key === 'energyLevel');
  const symptoms = conditionFields.find(field => field.key === 'symptomTags');
  const conditionTags = [
    condition?.value,
    energy?.value,
    symptoms?.value,
  ].filter((value): value is string => Boolean(value));

  return {
    ...(cycleTitle ? { cycleTitle } : {}),
    ...(cycleDetail ? { cycleDetail } : {}),
    conditionTitle:
      mood?.value ?? condition?.value ?? '오늘 컨디션을 기다리고 있어요',
    conditionDetail:
      conditionFields.length > 0
        ? '파트너가 오늘 직접 공유한 컨디션이에요.'
        : '오늘 공유된 기분이나 컨디션이 아직 없어요.',
    conditionTags,
  };
}

function formatSyncedAt(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}년 ${month}월 ${day}일 ${hour}:${minute} 동기화`;
}

export function getPartnerProjectionFreshness(
  projection?: RemotePartnerProjection | null,
  now = new Date(),
): PartnerProjectionFreshness {
  if (!projection) {
    return { label: '업데이트 정보 없음', stale: false };
  }

  const generatedAt = projection.generatedAt
    ? new Date(projection.generatedAt)
    : undefined;
  if (!generatedAt || Number.isNaN(generatedAt.getTime())) {
    return { label: '업데이트 시각 확인 불가', stale: true };
  }

  const age = now.getTime() - generatedAt.getTime();
  const today = deviceLocalDate(now);
  const sourceIsStale =
    (hasDailyValues(projection) && projection.dailyLogDate !== today) ||
    (hasCycleDerivedValues(projection) && projection.cycleAsOfDate !== today);
  return {
    label: formatSyncedAt(generatedAt),
    stale:
      sourceIsStale ||
      age > PARTNER_PROJECTION_STALE_AFTER_MS ||
      age < -MAX_CLOCK_SKEW_MS,
  };
}
