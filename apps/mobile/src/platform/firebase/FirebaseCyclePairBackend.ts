import { getApp } from '@react-native-firebase/app';
import { fetch as fetchNetworkState } from '@react-native-community/netinfo';
import { getAuth } from '@react-native-firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import type {
  ActivePairMembership,
  BackendConditionCode,
  BackendShareSettings,
  BackendWriteResult,
  CacheTombstone,
  CyclePairBackend,
  OfflineSyncReport,
  PairEvent,
  PartnerNudge,
  PartnerNudgeSendResult,
  PartnerNudgeState,
  PartnerNudgeType,
  PrivateCycleRecord,
  PrivateDailyLogRecord,
  PrivateDailyLogSnapshot,
  RemotePartnerProjection,
} from '../backend/CyclePairBackend';
import {
  secureOfflineMutationQueue,
  type OfflineMutation,
} from '../local/SecureOfflineMutationQueue';
import { secureCyclePairCache } from '../local/SecureCyclePairCache';
import { secureUserDataFence } from '../local/SecureUserDataFence';
import {
  buildChangedPrivateDailyLogsQuery,
  buildPrivateDailyLogTombstonesQuery,
  buildPrivateDailyLogsQuery,
  sortDailyLogsNewestFirst,
} from './privateDailyLogsQuery';
import { ActivePairSnapshotCoordinator } from './ActivePairSnapshotCoordinator';
import { replayOfflineMutations } from './replayOfflineMutations';
import { SerializedWriteQueue } from './SerializedWriteQueue';
import { isFirebaseGuestUser } from '../account/FirebaseGuestIdentity';
import { SENSITIVE_HEALTH_CONSENT_VERSION } from '../../domain/privacy/SensitiveHealthConsent';

const FUNCTIONS_REGION = 'asia-northeast3';
const CONDITION_CODES = new Set<BackendConditionCode>([
  'comfortable',
  'tired',
  'low-energy',
  'needs-space',
]);
const DAILY_NOTE_MAX_LENGTH = 500;
const DAILY_LOG_SYNC_EPOCH = '1970-01-01T00:00:00.000Z';

let initialization: Promise<void> | undefined;
const mutationWrites = new SerializedWriteQueue();
const quiescedUids = new Set<string>();
const sessionWatchStops = new Map<string, Set<() => void>>();
const invalidatedPairKeys = new Set<string>();
const lastAuthoritativeMemberships = new Map<string, ActivePairMembership>();
const dailyLogSyncs = new Map<
  string,
  Promise<readonly PrivateDailyLogSnapshot[]>
>();

interface PrivateDailyLogTombstone {
  readonly localDate: string;
  readonly updatedAt: string;
}

function pairKey(uid: string, pairId: string): string {
  return `${uid.length}:${uid}${pairId}`;
}

function isPairInvalidated(uid: string, pairId: string): boolean {
  return invalidatedPairKeys.has(pairKey(uid, pairId));
}

function requirePairActive(uid: string, pairId: string): void {
  if (isPairInvalidated(uid, pairId)) throw new Error('Pair data is revoked.');
}

function requireSessionActive(uid: string): void {
  if (quiescedUids.has(uid) || secureUserDataFence.isBlocked(uid)) {
    throw new Error('Account session is quiesced.');
  }
}

function currentUid(): string {
  const uid = getAuth().currentUser?.uid;
  if (!uid) throw new Error('Account session is unavailable.');
  return uid;
}

function serializeMutationWrite<T>(
  uid: string,
  write: () => Promise<T>,
): Promise<T> {
  return mutationWrites.run(() => requireSessionActive(uid), write);
}

function trackSessionWatch(uid: string, start: () => () => void): () => void {
  requireSessionActive(uid);
  let stopped = false;
  const nativeStop = start();
  const stops = sessionWatchStops.get(uid) ?? new Set<() => void>();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    nativeStop();
    stops.delete(stop);
    if (stops.size === 0) sessionWatchStops.delete(uid);
  };
  stops.add(stop);
  sessionWatchStops.set(uid, stops);
  return stop;
}

async function quiesceBackendSession(uid: string): Promise<void> {
  quiescedUids.add(uid);
  for (const stop of [...(sessionWatchStops.get(uid) ?? [])]) stop();
  await mutationWrites.drain();
  await secureUserDataFence.blockAndDrain(uid);
}

async function quiesceBackendSessionForLogout(
  uid: string,
): Promise<{ flushed: number; remaining: number; failed: number }> {
  // Close admission before waiting so no UI write can enter after the flush.
  // Existing serialized writes finish first and may enqueue their retry safely.
  quiescedUids.add(uid);
  for (const stop of [...(sessionWatchStops.get(uid) ?? [])]) stop();
  await mutationWrites.drain();
  const report = await flushQueuedMutations(uid);
  if (report.remaining === 0) {
    await secureUserDataFence.blockAndDrain(uid);
  }
  return report;
}

function resumeBackendSession(uid: string): void {
  secureUserDataFence.resume(uid);
  quiescedUids.delete(uid);
}

function invalidatePairData(uid: string, pairId: string): void {
  invalidatedPairKeys.add(pairKey(uid, pairId));
}

function clearPendingPairData(uid: string, pairId: string): Promise<void> {
  // Close the Pair epoch synchronously before this cleanup joins the mutation
  // chain. Writes already running finish before clear; queued/future writes
  // re-check the fence and can never recreate data after tombstone ACK.
  invalidatePairData(uid, pairId);
  return serializeMutationWrite(uid, async () => {
    // Keep membership as durable retry evidence until both the queue and every
    // cached Pair event have been removed successfully.
    await secureOfflineMutationQueue.clearPair(uid, pairId);
    await secureCyclePairCache.clearPair(uid, pairId);
  });
}

function ensureFirestoreConfigured(): Promise<void> {
  if (!initialization) {
    initialization = initializeFirestore(getApp(), { persistence: false })
      .then(() => undefined)
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes('already')) throw error;
      });
  }
  return initialization;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asBoundedString(
  value: unknown,
  maxLength: number,
): string | undefined {
  const text = asString(value);
  return text !== undefined && text.length <= maxLength ? text : undefined;
}

function isConditionCode(value: unknown): value is BackendConditionCode {
  return (
    typeof value === 'string' &&
    CONDITION_CODES.has(value as BackendConditionCode)
  );
}

function asStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value
    : undefined;
}

function timestampToIso(value: unknown): string | undefined {
  const maybeTimestamp = value as { toDate?: () => Date } | undefined;
  return maybeTimestamp?.toDate?.().toISOString();
}

function isEnergyLevel(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
  );
}

function parseDailyLog(
  localDate: string,
  value: unknown,
): PrivateDailyLogSnapshot {
  const data = asRecord(value);
  const record: PrivateDailyLogRecord = {
    ...(asString(data?.moodTag) ? { moodTag: asString(data?.moodTag) } : {}),
    ...(asStringArray(data?.symptomTags)
      ? { symptomTags: asStringArray(data?.symptomTags) }
      : {}),
    ...(isEnergyLevel(data?.energyLevel)
      ? { energyLevel: data.energyLevel }
      : {}),
    ...(isConditionCode(data?.conditionCode)
      ? { conditionCode: data.conditionCode }
      : {}),
    ...(asStringArray(data?.carePreferences)
      ? { carePreferences: asStringArray(data?.carePreferences) }
      : {}),
    ...(asBoundedString(data?.note, DAILY_NOTE_MAX_LENGTH)
      ? { note: asBoundedString(data?.note, DAILY_NOTE_MAX_LENGTH) }
      : {}),
    ...(data?.periodStarted === true ? { periodStarted: true } : {}),
    ...(data?.periodEnded === true ? { periodEnded: true } : {}),
  };
  return {
    localDate,
    record,
    ...(asString(data?.lastMutationId)
      ? { mutationId: asString(data?.lastMutationId) }
      : {}),
    ...(timestampToIso(data?.updatedAt)
      ? { updatedAt: timestampToIso(data?.updatedAt) }
      : {}),
  };
}

function parseDailyLogTombstone(
  localDate: string,
  value: unknown,
): PrivateDailyLogTombstone | null {
  const data = asRecord(value);
  const recordedDate = asString(data?.localDate);
  const updatedAt = timestampToIso(data?.updatedAt);
  if (recordedDate !== localDate || !updatedAt) return null;
  return { localDate, updatedAt };
}

function parsePairEvent(
  pairId: string,
  id: string,
  value: unknown,
): PairEvent | null {
  const data = asRecord(value);
  const title = asString(data?.title);
  const date = asString(data?.date);
  const createdBy = asString(data?.createdBy);
  const updatedBy = asString(data?.updatedBy);
  const mutationId = asString(data?.mutationId);
  if (!title || !date || !createdBy || !updatedBy || !mutationId) return null;
  return {
    id,
    pairId,
    title,
    date,
    createdBy,
    updatedBy,
    mutationId,
    ...(asString(data?.startTime)
      ? { startTime: asString(data?.startTime) }
      : {}),
    ...(asString(data?.endTime) ? { endTime: asString(data?.endTime) } : {}),
    ...(asString(data?.note) ? { note: asString(data?.note) } : {}),
    ...(timestampToIso(data?.createdAt)
      ? { createdAt: timestampToIso(data?.createdAt) }
      : {}),
    ...(timestampToIso(data?.updatedAt)
      ? { updatedAt: timestampToIso(data?.updatedAt) }
      : {}),
  };
}

function isPartnerNudgeType(value: unknown): value is PartnerNudgeType {
  return value === 'check-in-request' || value === 'care-acknowledgement';
}

function parsePartnerNudge(
  pairId: string,
  value: unknown,
): PartnerNudge | null {
  const data = asRecord(value);
  const requestId = asString(data?.requestId);
  const senderUid = asString(data?.senderUid);
  const recipientUid = asString(data?.recipientUid);
  const sentAt = timestampToIso(data?.sentAt);
  if (
    !requestId ||
    !senderUid ||
    !recipientUid ||
    !sentAt ||
    !isPartnerNudgeType(data?.type)
  ) {
    return null;
  }
  return {
    requestId,
    pairId,
    senderUid,
    recipientUid,
    type: data.type,
    sentAt,
  };
}

function parsePartnerNudgeCooldowns(
  value: unknown,
): PartnerNudgeState['nextAllowedAt'] {
  const data = asRecord(value);
  const checkIn = timestampToIso(data?.checkInNextAllowedAt);
  const careAcknowledgement = timestampToIso(
    data?.careAcknowledgementNextAllowedAt,
  );
  return {
    ...(checkIn ? { 'check-in-request': checkIn } : {}),
    ...(careAcknowledgement
      ? { 'care-acknowledgement': careAcknowledgement }
      : {}),
  };
}

async function isDefinitelyOffline(): Promise<boolean> {
  try {
    const network = await fetchNetworkState();
    return (
      network.isConnected === false || network.isInternetReachable === false
    );
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code).toLowerCase()
    : '';
}

function isRetryableNetworkError(error: unknown): boolean {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    code.includes('unavailable') ||
    code.includes('network') ||
    code.includes('deadline-exceeded') ||
    code.includes('aborted') ||
    code.includes('resource-exhausted') ||
    code.includes('internal') ||
    code.includes('cancelled') ||
    code.includes('unknown') ||
    message.includes('network') ||
    message.includes('offline')
  );
}

const PRESERVABLE_FAILURE_CODES = new Set([
  'already-exists',
  'cancelled',
  'data-loss',
  'failed-precondition',
  'internal',
  'invalid-argument',
  'not-found',
  'out-of-range',
  'permission-denied',
  'unauthenticated',
  'unimplemented',
  'unknown',
]);

function sanitizedOfflineFailureCode(error: unknown): string {
  const suffix = errorCode(error).split('/').pop() ?? '';
  return PRESERVABLE_FAILURE_CODES.has(suffix) ? suffix : 'non-retryable';
}

function replayWriteResult(
  report: OfflineSyncReport,
  mutationId: string,
): BackendWriteResult {
  if (report.failureCode) {
    const error = new Error(
      '저장 대기 항목을 동기화할 수 없습니다.',
    ) as Error & {
      code: string;
    };
    error.code = `sync/${report.failureCode}`;
    throw error;
  }
  return {
    status: report.remaining > 0 ? 'queued' : 'synced',
    mutationId,
  };
}

async function queueAfterWriteFailure(
  mutation: OfflineMutation,
  error: unknown,
): Promise<BackendWriteResult> {
  await secureOfflineMutationQueue.enqueue(mutation);
  if (!isRetryableNetworkError(error) && !(await isDefinitelyOffline())) {
    throw error;
  }
  return { status: 'queued', mutationId: mutation.mutationId };
}

async function writeDailyLog(
  uid: string,
  localDate: string,
  record: PrivateDailyLogRecord,
  mutationId: string,
): Promise<void> {
  const firestore = getFirestore();
  const batch = writeBatch(firestore);
  batch.set(
    doc(firestore, 'users', uid, 'privateDailyLogs', localDate),
    {
      ...record,
      localDate,
      lastMutationId: mutationId,
      updatedAt: serverTimestamp(),
      schemaVersion: 2,
    },
  );
  batch.delete(
    doc(firestore, 'users', uid, 'privateDailyLogTombstones', localDate),
  );
  await batch.commit();
}

async function deleteDailyLogDocument(
  uid: string,
  localDate: string,
  mutationId: string,
): Promise<void> {
  const firestore = getFirestore();
  const batch = writeBatch(firestore);
  batch.delete(doc(firestore, 'users', uid, 'privateDailyLogs', localDate));
  batch.set(
    doc(firestore, 'users', uid, 'privateDailyLogTombstones', localDate),
    {
      schemaVersion: 1,
      localDate,
      lastMutationId: mutationId,
      updatedAt: serverTimestamp(),
    },
  );
  await batch.commit();
}

async function writePrivateSetup(
  uid: string,
  recordsCycle: boolean,
  consentAcceptedAt: string,
  consentVersion: string,
  cycle?: PrivateCycleRecord,
): Promise<void> {
  if (consentVersion !== SENSITIVE_HEALTH_CONSENT_VERSION) {
    throw new Error('Current sensitive health consent is required.');
  }
  await setDoc(doc(getFirestore(), 'users', uid, 'privateCycles', 'current'), {
    recordsCycle,
    consentAcceptedAt,
    consentVersion,
    ...(recordsCycle && cycle ? cycle : {}),
    updatedAt: serverTimestamp(),
    schemaVersion: 2,
  });
}

async function writeShareSettings(
  uid: string,
  pairId: string,
  settings: BackendShareSettings,
): Promise<void> {
  await setDoc(doc(getFirestore(), 'users', uid, 'shareSettings', pairId), {
    ...settings,
    updatedAt: serverTimestamp(),
    schemaVersion: 1,
  });
}

function optimisticEventFromMutation(
  mutation: OfflineMutation,
): PairEvent | null {
  if (mutation.type !== 'upsert-pair-event') return null;
  return {
    ...mutation.event,
    pairId: mutation.pairId,
    createdBy: mutation.uid,
    updatedBy: mutation.uid,
    mutationId: mutation.mutationId,
    createdAt: mutation.createdAt,
    updatedAt: mutation.createdAt,
  };
}

function parseCycle(value: unknown): PrivateCycleRecord | undefined {
  const data = asRecord(value);
  const periodDates = asRecord(data?.periodDates);
  const nextPeriodWindow = asRecord(data?.nextPeriodWindow);
  const startDate = asString(periodDates?.startDate);
  const asOfDate = asString(data?.asOfDate);
  const averageCycleLength = data?.averageCycleLength;
  const averagePeriodLength = data?.averagePeriodLength;
  const cyclePhase = data?.cyclePhase;
  const safePhase =
    cyclePhase === 'menstrual' ||
    cyclePhase === 'follicular' ||
    cyclePhase === 'ovulatory' ||
    cyclePhase === 'luteal' ||
    cyclePhase === 'unknown'
      ? cyclePhase
      : undefined;
  const cycleStatus = data?.cycleStatus;
  const safeStatus =
    cycleStatus === 'period-starting' ||
    cycleStatus === 'period-in-progress' ||
    cycleStatus === 'period-ending' ||
    cycleStatus === 'post-period' ||
    cycleStatus === 'fertile-window' ||
    cycleStatus === 'pre-period' ||
    cycleStatus === 'cycle-in-progress' ||
    cycleStatus === 'unknown'
      ? cycleStatus
      : undefined;
  if (
    !startDate ||
    !asOfDate ||
    typeof averageCycleLength !== 'number' ||
    typeof averagePeriodLength !== 'number'
  ) {
    return undefined;
  }

  return {
    asOfDate,
    averageCycleLength,
    averagePeriodLength,
    periodDates: {
      startDate,
      ...(asString(periodDates?.endDate)
        ? { endDate: asString(periodDates?.endDate) }
        : {}),
    },
    ...(safePhase ? { cyclePhase: safePhase } : {}),
    ...(safeStatus ? { cycleStatus: safeStatus } : {}),
    ...(asString(nextPeriodWindow?.startDate) &&
    asString(nextPeriodWindow?.endDate)
      ? {
          nextPeriodWindow: {
            startDate: asString(nextPeriodWindow?.startDate)!,
            endDate: asString(nextPeriodWindow?.endDate)!,
          },
        }
      : {}),
  };
}

function parseShareSettings(value: unknown): BackendShareSettings {
  const data = asRecord(value);
  return {
    cyclePhase: data?.cyclePhase === true,
    cycleStatus: data?.cycleStatus === true,
    fertilityStatus: data?.fertilityStatus === true,
    nextPeriodWindow: data?.nextPeriodWindow === true,
    periodDates: data?.periodDates === true,
    moodTag: data?.moodTag === true,
    symptomTags: data?.symptomTags === true,
    energyLevel: data?.energyLevel === true,
    conditionCode: data?.conditionCode === true,
    carePreferences: data?.carePreferences === true,
    note: data?.note === true,
  };
}

function parseProjection(value: unknown): RemotePartnerProjection | null {
  const data = asRecord(value);
  const ownerUid = asString(data?.ownerUid);
  const pairId = asString(data?.pairId);
  if (!data || !ownerUid || !pairId) return null;

  const periodDates = asRecord(data.periodDates);
  const nextPeriodWindow = asRecord(data.nextPeriodWindow);
  const cyclePhase = data.cyclePhase;
  const safePhase =
    cyclePhase === 'menstrual' ||
    cyclePhase === 'follicular' ||
    cyclePhase === 'ovulatory' ||
    cyclePhase === 'luteal' ||
    cyclePhase === 'unknown'
      ? cyclePhase
      : undefined;
  const cycleStatus = data.cycleStatus;
  const safeStatus =
    cycleStatus === 'period-starting' ||
    cycleStatus === 'period-in-progress' ||
    cycleStatus === 'period-ending' ||
    cycleStatus === 'post-period' ||
    cycleStatus === 'fertile-window' ||
    cycleStatus === 'pre-period' ||
    cycleStatus === 'cycle-in-progress' ||
    cycleStatus === 'unknown'
      ? cycleStatus
      : undefined;

  return {
    ownerUid,
    pairId,
    ...(timestampToIso(data.generatedAt)
      ? { generatedAt: timestampToIso(data.generatedAt) }
      : {}),
    ...(asString(data.cycleAsOfDate)
      ? { cycleAsOfDate: asString(data.cycleAsOfDate) }
      : {}),
    ...(asString(data.dailyLogDate)
      ? { dailyLogDate: asString(data.dailyLogDate) }
      : {}),
    ...(asString(periodDates?.startDate)
      ? {
          periodDates: {
            startDate: asString(periodDates?.startDate)!,
            ...(asString(periodDates?.endDate)
              ? { endDate: asString(periodDates?.endDate) }
              : {}),
          },
        }
      : {}),
    ...(safePhase ? { cyclePhase: safePhase } : {}),
    ...(safeStatus ? { cycleStatus: safeStatus } : {}),
    ...(asString(nextPeriodWindow?.startDate) &&
    asString(nextPeriodWindow?.endDate)
      ? {
          nextPeriodWindow: {
            startDate: asString(nextPeriodWindow?.startDate)!,
            endDate: asString(nextPeriodWindow?.endDate)!,
          },
        }
      : {}),
    ...(asStringArray(data.symptomTags)
      ? { symptomTags: asStringArray(data.symptomTags) }
      : {}),
    ...(asString(data.moodTag) ? { moodTag: asString(data.moodTag) } : {}),
    ...(isEnergyLevel(data.energyLevel)
      ? { energyLevel: data.energyLevel }
      : {}),
    ...(isConditionCode(data.conditionCode)
      ? { conditionCode: data.conditionCode }
      : {}),
    ...(asStringArray(data.carePreferences)
      ? { carePreferences: asStringArray(data.carePreferences) }
      : {}),
    ...(asBoundedString(data.note, DAILY_NOTE_MAX_LENGTH)
      ? { note: asBoundedString(data.note, DAILY_NOTE_MAX_LENGTH) }
      : {}),
  };
}

async function call<Request, Response>(
  name: string,
  data: Request,
): Promise<Response> {
  const result = await httpsCallable<Request, Response>(
    getFunctions(getApp(), FUNCTIONS_REGION),
    name,
  )(data);
  return result.data;
}

async function executeQueuedMutation(mutation: OfflineMutation): Promise<void> {
  if (mutation.type === 'private-setup') {
    await writePrivateSetup(
      mutation.uid,
      mutation.setup.recordsCycle,
      mutation.setup.consentAcceptedAt,
      mutation.setup.consentVersion ?? '',
      mutation.setup.cycle,
    );
  } else if (mutation.type === 'share-settings') {
    await writeShareSettings(mutation.uid, mutation.pairId, mutation.settings);
  } else if (mutation.type === 'daily-log') {
    await writeDailyLog(
      mutation.uid,
      mutation.localDate,
      mutation.record,
      mutation.mutationId,
    );
  } else if (mutation.type === 'delete-daily-log') {
    await deleteDailyLogDocument(
      mutation.uid,
      mutation.localDate,
      mutation.mutationId,
    );
  } else if (mutation.type === 'upsert-pair-event') {
    await call('upsertPairEvent', {
      pairId: mutation.pairId,
      event: mutation.event,
      mutationId: mutation.mutationId,
    });
  } else {
    await call('deletePairEvent', {
      pairId: mutation.pairId,
      eventId: mutation.eventId,
      mutationId: mutation.mutationId,
    });
  }
}

async function flushQueuedMutations(uid: string) {
  if (await isDefinitelyOffline()) {
    return {
      flushed: 0,
      remaining: await secureOfflineMutationQueue.count(uid),
      failed: await secureOfflineMutationQueue.countFailed(uid),
    };
  }
  return replayOfflineMutations({
    uid,
    mutations: await secureOfflineMutationQueue.listForReplay(uid),
    queue: secureOfflineMutationQueue,
    execute: executeQueuedMutation,
    isPairInvalidated: pairId => isPairInvalidated(uid, pairId),
    isRetryable: isRetryableNetworkError,
    failureCode: sanitizedOfflineFailureCode,
  });
}

function mergePendingDailyMutations(
  logs: readonly PrivateDailyLogSnapshot[],
  mutations: readonly OfflineMutation[],
): readonly PrivateDailyLogSnapshot[] {
  const byDate = new Map(logs.map(log => [log.localDate, log] as const));
  for (const mutation of mutations) {
    if (mutation.type === 'daily-log') {
      byDate.set(mutation.localDate, {
        localDate: mutation.localDate,
        record: mutation.record,
        mutationId: mutation.mutationId,
        updatedAt: mutation.createdAt,
      });
    } else if (mutation.type === 'delete-daily-log') {
      byDate.delete(mutation.localDate);
    }
  }
  return sortDailyLogsNewestFirst([...byDate.values()]);
}

async function loadCachedDailyLogs(
  uid: string,
): Promise<readonly PrivateDailyLogSnapshot[]> {
  return mergePendingDailyMutations(
    await secureCyclePairCache.loadDailyLogs(uid),
    await secureOfflineMutationQueue.list(uid),
  );
}

type DailyLogRemoteChange =
  | {
      readonly kind: 'log';
      readonly localDate: string;
      readonly updatedAt: string;
      readonly log: PrivateDailyLogSnapshot;
    }
  | {
      readonly kind: 'delete';
      readonly localDate: string;
      readonly updatedAt: string;
    };

function remoteChanges(
  logs: readonly PrivateDailyLogSnapshot[],
  tombstones: readonly PrivateDailyLogTombstone[],
): readonly DailyLogRemoteChange[] {
  return [
    ...logs.map(log => ({
      kind: 'log' as const,
      localDate: log.localDate,
      updatedAt: log.updatedAt ?? DAILY_LOG_SYNC_EPOCH,
      log,
    })),
    ...tombstones.map(tombstone => ({
      kind: 'delete' as const,
      localDate: tombstone.localDate,
      updatedAt: tombstone.updatedAt,
    })),
  ].sort((left, right) => {
    const byTimestamp = left.updatedAt.localeCompare(right.updatedAt);
    if (byTimestamp !== 0) return byTimestamp;
    return left.kind === right.kind ? 0 : left.kind === 'log' ? -1 : 1;
  });
}

async function performDailyLogSync(
  uid: string,
): Promise<readonly PrivateDailyLogSnapshot[]> {
  const [cachedLogs, cursor] = await Promise.all([
    secureCyclePairCache.loadDailyLogs(uid),
    secureCyclePairCache.loadDailyLogSyncCursor(uid),
  ]);
  await ensureFirestoreConfigured();
  try {
    const [logSnapshots, tombstoneSnapshots] = await Promise.all([
      getDocs(
        cursor
          ? buildChangedPrivateDailyLogsQuery(uid, cursor.updatedAt)
          : buildPrivateDailyLogsQuery(uid),
      ),
      getDocs(
        buildPrivateDailyLogTombstonesQuery(uid, cursor?.updatedAt),
      ),
    ]);
    const remoteLogs = logSnapshots.docs.map(snapshot =>
      parseDailyLog(snapshot.id, snapshot.data()),
    );
    const tombstones = tombstoneSnapshots.docs.flatMap(snapshot => {
      const tombstone = parseDailyLogTombstone(
        snapshot.id,
        snapshot.data(),
      );
      return tombstone ? [tombstone] : [];
    });

    if (!cursor) {
      const remoteDates = new Set(remoteLogs.map(log => log.localDate));
      for (const cached of cachedLogs) {
        if (!remoteDates.has(cached.localDate)) {
          await secureCyclePairCache.deleteDailyLog(uid, cached.localDate);
        }
      }
    }

    const changes = remoteChanges(remoteLogs, tombstones);
    for (const change of changes) {
      if (change.kind === 'log') {
        await secureCyclePairCache.saveDailyLog(uid, change.log);
      } else {
        await secureCyclePairCache.deleteDailyLog(uid, change.localDate);
      }
    }
    const nextCursor = changes.reduce(
      (latest, change) =>
        change.updatedAt > latest ? change.updatedAt : latest,
      cursor?.updatedAt ?? DAILY_LOG_SYNC_EPOCH,
    );
    await secureCyclePairCache.saveDailyLogSyncCursor(uid, {
      updatedAt: nextCursor,
    });
  } catch (error) {
    if (!isRetryableNetworkError(error) && !(await isDefinitelyOffline())) {
      throw error;
    }
  }
  return loadCachedDailyLogs(uid);
}

function syncDailyLogs(
  uid: string,
): Promise<readonly PrivateDailyLogSnapshot[]> {
  const existing = dailyLogSyncs.get(uid);
  if (existing) return existing;
  const sync = performDailyLogSync(uid).finally(() => {
    if (dailyLogSyncs.get(uid) === sync) dailyLogSyncs.delete(uid);
  });
  dailyLogSyncs.set(uid, sync);
  return sync;
}

export const firebaseCyclePairBackend: CyclePairBackend = {
  kind: 'firebase',

  async initialize() {
    await ensureFirestoreConfigured();
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) throw new Error('Account session is unavailable.');
    resumeBackendSession(user.uid);
    return {
      uid: user.uid,
      isAnonymous: isFirebaseGuestUser(user),
    };
  },

  quiesceSessionForLogout(uid) {
    return quiesceBackendSessionForLogout(uid);
  },

  quiesceSession(uid) {
    return quiesceBackendSession(uid);
  },

  resumeSession(uid) {
    resumeBackendSession(uid);
  },

  async loadCachedActivePair() {
    // Cached Pair membership is cleanup evidence, never authorization to show
    // partner data after a cold start.
    return null;
  },

  async loadCachedPairEvents() {
    // Pair events are exposed only after a live membership snapshot starts the
    // authorized event listener.
    return [];
  },

  async loadPrivateSetup(uid) {
    if (await isDefinitelyOffline()) {
      return secureCyclePairCache.loadSetup(uid);
    }
    await ensureFirestoreConfigured();
    try {
      const cycle = await getDoc(
        doc(getFirestore(), 'users', uid, 'privateCycles', 'current'),
      );
      if (!cycle.exists()) {
        await secureCyclePairCache.clearSetup(uid);
        return null;
      }
      const cycleData = asRecord(cycle.data());
      const consentAcceptedAt = asString(cycleData?.consentAcceptedAt);
      if (!consentAcceptedAt) return null;
      const consentVersion = asString(cycleData?.consentVersion);
      const recordsCycle = cycleData?.recordsCycle === true;
      const parsedCycle = recordsCycle ? parseCycle(cycle.data()) : undefined;
      const setup = {
        recordsCycle,
        consentAcceptedAt,
        ...(consentVersion ? { consentVersion } : {}),
        ...(parsedCycle ? { cycle: parsedCycle } : {}),
      };
      await secureCyclePairCache.saveSetup(uid, setup);
      return setup;
    } catch (error) {
      if (!isRetryableNetworkError(error)) throw error;
      return secureCyclePairCache.loadSetup(uid);
    }
  },

  async savePrivateSetup(
    uid,
    recordsCycle,
    consentAcceptedAt,
    consentVersion,
    cycle,
  ) {
    return serializeMutationWrite(uid, async () => {
      if (consentVersion !== SENSITIVE_HEALTH_CONSENT_VERSION) {
        throw new Error('Current sensitive health consent is required.');
      }
      const mutationId = 'private-setup-current';
      const setup = {
        recordsCycle,
        consentAcceptedAt,
        consentVersion,
        ...(recordsCycle && cycle ? { cycle } : {}),
      };
      const mutation = {
        schemaVersion: 1 as const,
        type: 'private-setup' as const,
        uid,
        mutationId,
        createdAt: new Date().toISOString(),
        setup,
      };
      await secureCyclePairCache.saveSetup(uid, setup);
      if (await isDefinitelyOffline()) {
        await secureOfflineMutationQueue.enqueue(mutation);
        return { status: 'queued' as const, mutationId };
      }
      try {
        await ensureFirestoreConfigured();
        if (await secureOfflineMutationQueue.count(uid)) {
          await secureOfflineMutationQueue.enqueue(mutation);
          const report = await flushQueuedMutations(uid);
          return replayWriteResult(report, mutationId);
        }
        await writePrivateSetup(
          uid,
          recordsCycle,
          consentAcceptedAt,
          consentVersion,
          cycle,
        );
        return { status: 'synced' as const, mutationId };
      } catch (error) {
        return queueAfterWriteFailure(mutation, error);
      }
    });
  },

  createPairInvite(recordsCycle) {
    requireSessionActive(currentUid());
    return call('createPairInvite', { recordsCycle });
  },

  acceptPairInvite(inviteToken, recordsCycle) {
    requireSessionActive(currentUid());
    return call('acceptPairInvite', {
      inviteToken: inviteToken.trim(),
      recordsCycle,
    });
  },

  loadCachedDailyLogs(uid) {
    return loadCachedDailyLogs(uid);
  },

  syncDailyLogs(uid) {
    return syncDailyLogs(uid);
  },

  async saveDailyLog(uid, localDate, record, mutationId) {
    return serializeMutationWrite(uid, async () => {
      const createdAt = new Date().toISOString();
      const mutation = {
        schemaVersion: 1 as const,
        type: 'daily-log' as const,
        uid,
        localDate,
        record,
        mutationId,
        createdAt,
      };
      await secureCyclePairCache.saveDailyLog(uid, {
        localDate,
        record,
        mutationId,
        updatedAt: createdAt,
      });
      if (await isDefinitelyOffline()) {
        await secureOfflineMutationQueue.enqueue(mutation);
        return { status: 'queued', mutationId };
      }
      try {
        await ensureFirestoreConfigured();
        if (await secureOfflineMutationQueue.count(uid)) {
          await secureOfflineMutationQueue.enqueue(mutation);
          const report = await flushQueuedMutations(uid);
          return replayWriteResult(report, mutationId);
        }
        await writeDailyLog(uid, localDate, record, mutationId);
        return { status: 'synced', mutationId };
      } catch (error) {
        return queueAfterWriteFailure(mutation, error);
      }
    });
  },

  async deleteDailyLog(uid, localDate, mutationId) {
    return serializeMutationWrite(uid, async () => {
      const mutation = {
        schemaVersion: 1 as const,
        type: 'delete-daily-log' as const,
        uid,
        localDate,
        mutationId,
        createdAt: new Date().toISOString(),
      };
      await secureCyclePairCache.deleteDailyLog(uid, localDate);
      if (await isDefinitelyOffline()) {
        await secureOfflineMutationQueue.enqueue(mutation);
        return { status: 'queued' as const, mutationId };
      }
      try {
        await ensureFirestoreConfigured();
        if (await secureOfflineMutationQueue.count(uid)) {
          await secureOfflineMutationQueue.enqueue(mutation);
          const report = await flushQueuedMutations(uid);
          return replayWriteResult(report, mutationId);
        }
        await deleteDailyLogDocument(uid, localDate, mutationId);
        return { status: 'synced' as const, mutationId };
      } catch (error) {
        return queueAfterWriteFailure(mutation, error);
      }
    });
  },

  async saveShareSettings(uid, pairId, settings) {
    return serializeMutationWrite(uid, async () => {
      requirePairActive(uid, pairId);
      const mutationId = 'share-settings-current';
      const mutation = {
        schemaVersion: 1 as const,
        type: 'share-settings' as const,
        uid,
        pairId,
        settings,
        mutationId,
        createdAt: new Date().toISOString(),
      };
      if (await isDefinitelyOffline()) {
        await secureOfflineMutationQueue.enqueue(mutation);
        return { status: 'queued' as const, mutationId };
      }
      try {
        await ensureFirestoreConfigured();
        if (await secureOfflineMutationQueue.count(uid)) {
          await secureOfflineMutationQueue.enqueue(mutation);
          const report = await flushQueuedMutations(uid);
          return replayWriteResult(report, mutationId);
        }
        await writeShareSettings(uid, pairId, settings);
        return { status: 'synced' as const, mutationId };
      } catch (error) {
        return queueAfterWriteFailure(mutation, error);
      }
    });
  },

  async upsertPairEvent(uid, pairId, event, mutationId) {
    return serializeMutationWrite(uid, async () => {
      requirePairActive(uid, pairId);
      const mutation = {
        schemaVersion: 1 as const,
        type: 'upsert-pair-event' as const,
        uid,
        pairId,
        event,
        mutationId,
        createdAt: new Date().toISOString(),
      };
      if (await isDefinitelyOffline()) {
        await secureOfflineMutationQueue.enqueue(mutation);
        return { status: 'queued', mutationId };
      }
      try {
        if (await secureOfflineMutationQueue.count(uid)) {
          await secureOfflineMutationQueue.enqueue(mutation);
          const report = await flushQueuedMutations(uid);
          return replayWriteResult(report, mutationId);
        }
        await call('upsertPairEvent', { pairId, event, mutationId });
        return { status: 'synced', mutationId };
      } catch (error) {
        return queueAfterWriteFailure(mutation, error);
      }
    });
  },

  async deletePairEvent(uid, pairId, eventId, mutationId) {
    return serializeMutationWrite(uid, async () => {
      requirePairActive(uid, pairId);
      const mutation = {
        schemaVersion: 1 as const,
        type: 'delete-pair-event' as const,
        uid,
        pairId,
        eventId,
        mutationId,
        createdAt: new Date().toISOString(),
      };
      if (await isDefinitelyOffline()) {
        await secureOfflineMutationQueue.enqueue(mutation);
        return { status: 'queued', mutationId };
      }
      try {
        if (await secureOfflineMutationQueue.count(uid)) {
          await secureOfflineMutationQueue.enqueue(mutation);
          const report = await flushQueuedMutations(uid);
          return replayWriteResult(report, mutationId);
        }
        await call('deletePairEvent', { pairId, eventId, mutationId });
        return { status: 'synced', mutationId };
      } catch (error) {
        return queueAfterWriteFailure(mutation, error);
      }
    });
  },

  async sendPartnerNudge(uid, pairId, type, requestId) {
    requireSessionActive(uid);
    requirePairActive(uid, pairId);
    if (await isDefinitelyOffline()) {
      const error = new Error(
        '인터넷에 연결한 뒤 넛지를 다시 보내 주세요.',
      ) as Error & { code: string };
      error.code = 'network/offline';
      throw error;
    }
    return call<
      { pairId: string; type: PartnerNudgeType; requestId: string },
      PartnerNudgeSendResult
    >('sendPartnerNudge', { pairId, type, requestId });
  },

  async acknowledgePartnerNudge(pairId, requestId) {
    const uid = currentUid();
    requireSessionActive(uid);
    requirePairActive(uid, pairId);
    if (await isDefinitelyOffline()) {
      const error = new Error(
        '인터넷에 연결한 뒤 다시 확인해 주세요.',
      ) as Error & { code: string };
      error.code = 'network/offline';
      throw error;
    }
    const result = await call<
      { pairId: string; requestId: string },
      { acknowledged: boolean }
    >('acknowledgePartnerNudge', { pairId, requestId });
    return result.acknowledged;
  },

  async flushPendingMutations(uid) {
    return serializeMutationWrite(uid, () => flushQueuedMutations(uid));
  },

  clearPendingPairMutations(uid, pairId) {
    return clearPendingPairData(uid, pairId);
  },

  async revokePair(pairId) {
    requireSessionActive(currentUid());
    await call('revokePair', { pairId });
  },

  async acknowledgeCacheTombstone(tombstoneId) {
    requireSessionActive(currentUid());
    await call('acknowledgeCacheTombstone', { tombstoneId });
  },

  watchActivePair(uid, onValue, onError) {
    const membershipQuery = query(
      collection(getFirestore(), 'users', uid, 'pairMemberships'),
      where('status', '==', 'active'),
      limit(1),
    );
    const initialObservedMembership = lastAuthoritativeMemberships.get(uid);
    const coordinator = new ActivePairSnapshotCoordinator({
      ...(initialObservedMembership ? { initialObservedMembership } : {}),
      loadCachedMembership: () => secureCyclePairCache.loadMembership(uid),
      loadCachedPairIds: async () => [
        ...new Set([
          ...(await secureOfflineMutationQueue.listPairIds(uid)),
          ...(await secureCyclePairCache.listPairIds(uid)),
        ]),
      ],
      saveCachedMembership: membership =>
        secureCyclePairCache.saveMembership(uid, membership),
      clearPairData: pairId => clearPendingPairData(uid, pairId),
      invalidatePair: pairId => invalidatePairData(uid, pairId),
      onValue,
      onError,
      isInactive: () => quiescedUids.has(uid),
    });
    return trackSessionWatch(uid, () =>
      onSnapshot(
        membershipQuery,
        { includeMetadataChanges: true },
        snapshot => {
          if (quiescedUids.has(uid) || snapshot.metadata.fromCache) return;
          const membershipDocument = snapshot.docs[0];
          const data = asRecord(membershipDocument?.data());
          const pairId = asString(data?.pairId);
          const partnerUid = asString(data?.partnerUid);
          const membership =
            pairId && partnerUid ? { pairId, partnerUid } : null;
          const safeMembership =
            membership && isPairInvalidated(uid, membership.pairId)
              ? null
              : membership;
          const previousMembership = lastAuthoritativeMemberships.get(uid);
          if (
            previousMembership &&
            previousMembership.pairId !== safeMembership?.pairId
          ) {
            // Preserve the synchronous fence even when React restarts this
            // watcher while the previous Pair event listener is still closing.
            invalidatePairData(uid, previousMembership.pairId);
          }
          if (safeMembership) {
            lastAuthoritativeMemberships.set(uid, safeMembership);
          } else {
            lastAuthoritativeMemberships.delete(uid);
          }
          coordinator.accept(safeMembership);
        },
        onError,
      ),
    );
  },

  watchPartnerProjection(membership, onValue, onError) {
    const uid = currentUid();
    return trackSessionWatch(uid, () =>
      onSnapshot(
        doc(
          getFirestore(),
          'pairs',
          membership.pairId,
          'projections',
          membership.partnerUid,
        ),
        snapshot => {
          if (
            !quiescedUids.has(uid) &&
            !isPairInvalidated(uid, membership.pairId)
          ) {
            onValue(
              snapshot.exists() ? parseProjection(snapshot.data()) : null,
            );
          }
        },
        onError,
      ),
    );
  },

  watchShareSettings(uid, pairId, onValue, onError) {
    return trackSessionWatch(uid, () =>
      onSnapshot(
        doc(getFirestore(), 'users', uid, 'shareSettings', pairId),
        snapshot => {
          if (!quiescedUids.has(uid) && !isPairInvalidated(uid, pairId)) {
            onValue(
              snapshot.exists() ? parseShareSettings(snapshot.data()) : null,
            );
          }
        },
        onError,
      ),
    );
  },

  watchPairEvents(membership, onValue, onError) {
    const uid = currentUid();
    const eventsQuery = query(
      collection(getFirestore(), 'pairs', membership.pairId, 'events'),
      orderBy('date', 'asc'),
    );
    return trackSessionWatch(uid, () =>
      onSnapshot(
        eventsQuery,
        snapshot => {
          if (
            quiescedUids.has(uid) ||
            isPairInvalidated(uid, membership.pairId)
          )
            return;
          (async () => {
            const byId = new Map<string, PairEvent>();
            for (const item of snapshot.docs) {
              const parsed = parsePairEvent(
                membership.pairId,
                item.id,
                item.data(),
              );
              if (parsed) byId.set(parsed.id, parsed);
            }
            for (const mutation of await secureOfflineMutationQueue.list(uid)) {
              if (
                mutation.type === 'delete-pair-event' &&
                mutation.pairId === membership.pairId
              ) {
                byId.delete(mutation.eventId);
              } else if (
                mutation.type === 'upsert-pair-event' &&
                mutation.pairId === membership.pairId
              ) {
                const event = optimisticEventFromMutation(mutation);
                if (event) byId.set(event.id, event);
              }
            }
            const events = [...byId.values()].sort((left, right) =>
              left.date === right.date
                ? (left.startTime ?? '').localeCompare(right.startTime ?? '')
                : left.date.localeCompare(right.date),
            );
            if (
              quiescedUids.has(uid) ||
              isPairInvalidated(uid, membership.pairId)
            )
              return;
            await secureCyclePairCache.savePairEvents(
              uid,
              membership.pairId,
              events,
            );
            if (
              quiescedUids.has(uid) ||
              isPairInvalidated(uid, membership.pairId)
            )
              return;
            onValue(events);
          })().catch(onError);
        },
        onError,
      ),
    );
  },

  watchPartnerNudgeState(uid, membership, onValue, onError) {
    let received: PartnerNudge | null = null;
    let nextAllowedAt: PartnerNudgeState['nextAllowedAt'] = {};
    const emit = () => onValue({ received, nextAllowedAt });
    return trackSessionWatch(uid, () => {
      const stopInbox = onSnapshot(
        doc(getFirestore(), 'pairs', membership.pairId, 'nudgeInboxes', uid),
        snapshot => {
          if (
            quiescedUids.has(uid) ||
            isPairInvalidated(uid, membership.pairId)
          )
            return;
          received = snapshot.exists()
            ? parsePartnerNudge(membership.pairId, snapshot.data())
            : null;
          emit();
        },
        onError,
      );
      const stopSender = onSnapshot(
        doc(getFirestore(), 'pairs', membership.pairId, 'nudgeSenders', uid),
        snapshot => {
          if (
            quiescedUids.has(uid) ||
            isPairInvalidated(uid, membership.pairId)
          )
            return;
          nextAllowedAt = snapshot.exists()
            ? parsePartnerNudgeCooldowns(snapshot.data())
            : {};
          emit();
        },
        onError,
      );
      return () => {
        stopInbox();
        stopSender();
      };
    });
  },

  watchPendingTombstones(uid, onValue, onError) {
    const tombstoneQuery = query(
      collection(getFirestore(), 'users', uid, 'cacheTombstones'),
      where('status', '==', 'pending'),
    );
    return trackSessionWatch(uid, () =>
      onSnapshot(
        tombstoneQuery,
        snapshot => {
          if (quiescedUids.has(uid)) return;
          const tombstones: CacheTombstone[] = snapshot.docs.flatMap(item => {
            const pairId = asString(asRecord(item.data())?.pairId);
            return pairId ? [{ id: item.id, pairId }] : [];
          });
          onValue(tombstones);
        },
        onError,
      ),
    );
  },
};
