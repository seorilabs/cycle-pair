import type {
  DailyLogChange,
  PeriodBoundaryState,
  PrivateDailyLogRecord,
  PrivateSetupSnapshot,
} from './CyclePairBackend';

export function mergePeriodBoundary(
  record: PrivateDailyLogRecord,
  value: PeriodBoundaryState,
): PrivateDailyLogRecord {
  return { ...record, ...value };
}

export function hasDailyLogContent(
  record: Readonly<Record<string, unknown>>,
): boolean {
  if (record.periodStarted === true || record.periodEnded === true) return true;
  const metadata = new Set([
    'schemaVersion',
    'localDate',
    'lastMutationId',
    'updatedAt',
    'periodStarted',
    'periodEnded',
  ]);
  const fields = new Set([
    'emotionTags',
    'symptomTags',
    'energyLevel',
    'conditionCode',
    'carePreferences',
    'note',
  ]);
  return Object.entries(record).some(([key, value]) => {
    if (metadata.has(key)) return false;
    // Unknown user fields must never turn into an implicit delete.
    if (!fields.has(key)) return true;
    if (Array.isArray(value) || typeof value === 'string')
      return value.length > 0;
    return value !== undefined && value !== null;
  });
}

export function sameSetupFacts(
  left: PrivateSetupSnapshot | null,
  right: PrivateSetupSnapshot,
): boolean {
  if (
    !left ||
    left.recordsCycle !== right.recordsCycle ||
    left.consentAcceptedAt !== right.consentAcceptedAt ||
    left.consentVersion !== right.consentVersion
  )
    return false;
  if (!left.cycle || !right.cycle) return !left.cycle && !right.cycle;
  return (
    left.cycle.averageCycleLength === right.cycle.averageCycleLength &&
    left.cycle.averagePeriodLength === right.cycle.averagePeriodLength &&
    left.cycle.periodDates.startDate === right.cycle.periodDates.startDate &&
    left.cycle.periodDates.endDate === right.cycle.periodDates.endDate
  );
}

export function sameDailyLogData(
  left: PrivateDailyLogRecord | null,
  right: PrivateDailyLogRecord | null,
  ignorePeriod = false,
): boolean {
  if (!ignorePeriod && (!left || !right)) return left === right;
  const entries = (value: PrivateDailyLogRecord | null) =>
    Object.entries(value ?? {})
      .filter(
        ([key, v]) =>
          v !== undefined &&
          (!ignorePeriod || !['periodStarted', 'periodEnded'].includes(key)),
      )
      .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries(left)) === JSON.stringify(entries(right));
}

/** Keep already-entered setup dates when an edit removes their summary anchor. */
export function seedBoundaryDates(
  change: DailyLogChange,
  throughDate: string,
): readonly { localDate: string; periodStarted?: true; periodEnded?: true }[] {
  if (change.preservePeriod) return [];
  const result = new Map<
    string,
    { localDate: string; periodStarted?: true; periodEnded?: true }
  >();
  const dates = change.expectedSetup.recordsCycle
    ? change.expectedSetup.cycle?.periodDates
    : undefined;
  const add = (
    date: string | undefined,
    key: 'periodStarted' | 'periodEnded',
  ) => {
    if (date && date !== change.localDate && date <= throughDate)
      result.set(date, { ...result.get(date), localDate: date, [key]: true });
  };
  add(dates?.startDate, 'periodStarted');
  add(dates?.endDate, 'periodEnded');
  return [...result.values()];
}
