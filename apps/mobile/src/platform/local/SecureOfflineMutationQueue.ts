import { isLocalDate, parseIsoTimestamp } from '@cyclepair/product-core';
import * as Keychain from 'react-native-keychain';

import type {
  BackendShareSettings,
  PairEventInput,
  PrivateDailyLogRecord,
  PrivateSetupSnapshot,
} from '../backend/CyclePairBackend';
import { PairDataFence } from './PairDataFence';
import {opaqueServiceSegment} from './opaqueServiceSegment';
import { secureUserDataFence } from './SecureUserDataFence';

const SCHEMA_VERSION = 1 as const;
const SERVICE_PREFIX = 'com.seorilabs.cyclepair.offline.v1.';
const MOOD_TAGS = new Set(['very-low', 'low', 'neutral', 'good', 'very-good']);
const SYMPTOM_TAGS = new Set([
  'cramps',
  'headache',
  'fatigue',
  'bloating',
  'sensitive',
  'back-discomfort',
]);
const CONDITION_CODES = new Set([
  'comfortable',
  'tired',
  'low-energy',
  'needs-space',
]);
const CARE_PREFERENCES = new Set([
  'quiet-space',
  'warmth',
  'listen',
  'no-action',
]);
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

interface OfflineMutationBase {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly uid: string;
  readonly mutationId: string;
  readonly createdAt: string;
}

export interface DailyLogOfflineMutation extends OfflineMutationBase {
  readonly type: 'daily-log';
  readonly localDate: string;
  readonly record: PrivateDailyLogRecord;
}

export interface DeleteDailyLogOfflineMutation extends OfflineMutationBase {
  readonly type: 'delete-daily-log';
  readonly localDate: string;
}

export interface PrivateSetupOfflineMutation extends OfflineMutationBase {
  readonly type: 'private-setup';
  readonly setup: PrivateSetupSnapshot;
}

export interface ShareSettingsOfflineMutation extends OfflineMutationBase {
  readonly type: 'share-settings';
  readonly pairId: string;
  readonly settings: BackendShareSettings;
}

export interface UpsertPairEventOfflineMutation extends OfflineMutationBase {
  readonly type: 'upsert-pair-event';
  readonly pairId: string;
  readonly event: PairEventInput;
}

export interface DeletePairEventOfflineMutation extends OfflineMutationBase {
  readonly type: 'delete-pair-event';
  readonly pairId: string;
  readonly eventId: string;
}

export type OfflineMutation =
  | PrivateSetupOfflineMutation
  | ShareSettingsOfflineMutation
  | DailyLogOfflineMutation
  | DeleteDailyLogOfflineMutation
  | UpsertPairEventOfflineMutation
  | DeletePairEventOfflineMutation;

/**
 * 큐 길이 상한.
 *
 * 접기가 같은 대상의 중복을 이미 없애므로, 이 상한은 서로 다른 대상이
 * 오래 쌓였을 때를 위한 안전장치다. 넘으면 가장 오래된 미격리 항목부터
 * 버리고 그 사실을 동기화 리포트로 알린다.
 */
export const OFFLINE_MUTATION_QUEUE_LIMIT = 200;

/**
 * 같은 대상을 가리키는 변경을 하나로 접기 위한 자연 키.
 *
 * `mutationId` 는 저장을 누를 때마다 새로 만들어지므로 신원으로 쓸 수 없다.
 * 오프라인에서 같은 날짜 기록을 다섯 번 고치면 같은 값을 쓰는 항목이 다섯 개
 * 쌓이고, 재생 때도 마지막 하나 말고는 전부 즉시 덮어써질 값이다.
 *
 * `daily-log` 와 `delete-daily-log` 는 같은 키를 쓴다. 같은 날짜에 대해
 * 저장과 삭제가 섞이면 나중 것이 이긴다 — 중간 상태를 서버에 재생하면
 * 파트너에게 삭제 후 재생성이 그대로 보인다.
 */
export function coalesceKeyForOfflineMutation(
  mutation: OfflineMutation,
): string {
  switch (mutation.type) {
    case 'daily-log':
    case 'delete-daily-log':
      return `daily:${mutation.localDate}`;
    case 'private-setup':
      return 'private-setup';
    case 'share-settings':
      return `share-settings:${mutation.pairId}`;
    case 'upsert-pair-event':
      return `pair-event:${mutation.pairId}:${mutation.event.id}`;
    case 'delete-pair-event':
      return `pair-event:${mutation.pairId}:${mutation.eventId}`;
  }
}

export function pairIdForOfflineMutation(
  mutation: OfflineMutation,
): string | null {
  return mutation.type === 'share-settings' ||
    mutation.type === 'upsert-pair-event' ||
    mutation.type === 'delete-pair-event'
    ? mutation.pairId
    : null;
}

type StoredOfflineMutation = OfflineMutation & {
  readonly queueSequence?: number;
  readonly queueState?: 'failed';
  readonly failureCode?: string;
  readonly failedAt?: string;
};

export interface SecureOfflineMutationQueue {
  enqueue(mutation: OfflineMutation): Promise<void>;
  list(uid: string): Promise<readonly OfflineMutation[]>;
  listForReplay(uid: string): Promise<readonly OfflineMutation[]>;
  remove(uid: string, mutationId: string): Promise<void>;
  /**
   * 재시도해도 결과가 달라지지 않는 변경을 종결 상태로 옮긴다.
   *
   * 개인 기록과 페어 기록 모두 받는다. 격리된 항목은 `listForReplay`에서
   * 빠지므로 다음 동기화에서 같은 실패를 되풀이하지 않는다.
   */
  quarantine(
    uid: string,
    mutationId: string,
    failureCode: string,
  ): Promise<void>;
  count(uid: string): Promise<number>;
  countFailed(uid: string): Promise<number>;
  /**
   * 상한 초과로 버린 항목 수를 돌려주고 0으로 되돌린다.
   *
   * 버리는 시점은 enqueue 이고 알리는 시점은 동기화라, 그 사이를 잇는다.
   * 세션 안에서만 유지되므로 다음 동기화 전에 앱이 다시 시작하면 그 회차의
   * 알림은 유실된다. 드롭 카운터 하나를 위해 암호화 저장소 왕복을 늘리지
   * 않기로 한 선택이다.
   */
  takeDiscardedCount(uid: string): number;
  listPairIds(uid: string): Promise<readonly string[]>;
  clearUser(uid: string): Promise<void>;
  clearPair(uid: string, pairId: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalBoundedString(
  value: unknown,
  maxLength: number,
): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' && value.length <= maxLength)
  );
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalStringArray(
  value: unknown,
): value is readonly string[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every(item => typeof item === 'string'))
  );
}

function isCreatedAt(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  try {
    parseIsoTimestamp(value);
    return true;
  } catch {
    return false;
  }
}

function tomorrowDeviceLocalDate(now = new Date()): string {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isReasonableRecordedLocalDate(value: unknown): value is string {
  return (
    isLocalDate(value) &&
    value >= '1900-01-01' &&
    value <= tomorrowDeviceLocalDate()
  );
}

function calendarDayDistance(from: string, to: string): number {
  return (
    (Date.parse(`${to}T12:00:00.000Z`) -
      Date.parse(`${from}T12:00:00.000Z`)) /
    86_400_000
  );
}

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isPrivateSetupSnapshot(value: unknown): value is PrivateSetupSnapshot {
  if (
    !isRecord(value) ||
    typeof value.recordsCycle !== 'boolean' ||
    !isCreatedAt(value.consentAcceptedAt)
  ) {
    return false;
  }
  if (
    value.consentVersion !== undefined &&
    !isNonEmptyString(value.consentVersion)
  ) {
    return false;
  }
  if (value.cycle === undefined) return true;
  if (!value.recordsCycle || !isRecord(value.cycle)) return false;

  const cycle = value.cycle;
  const periodDates = cycle.periodDates;
  const nextPeriodWindow = cycle.nextPeriodWindow;
  const phase = cycle.cyclePhase;
  return (
    isReasonableRecordedLocalDate(cycle.asOfDate) &&
    isIntegerInRange(cycle.averageCycleLength, 15, 60) &&
    isIntegerInRange(cycle.averagePeriodLength, 1, 14) &&
    cycle.averagePeriodLength <= cycle.averageCycleLength &&
    isRecord(periodDates) &&
    isReasonableRecordedLocalDate(periodDates.startDate) &&
    (periodDates.endDate === undefined ||
      (isReasonableRecordedLocalDate(periodDates.endDate) &&
        periodDates.endDate >= periodDates.startDate)) &&
    cycle.asOfDate >= periodDates.startDate &&
    (phase === 'menstrual' ||
      phase === 'follicular' ||
      phase === 'ovulatory' ||
      phase === 'luteal' ||
      phase === 'unknown') &&
    (cycle.cycleStatus === undefined ||
      cycle.cycleStatus === 'period-starting' ||
      cycle.cycleStatus === 'period-in-progress' ||
      cycle.cycleStatus === 'period-ending' ||
      cycle.cycleStatus === 'post-period' ||
      cycle.cycleStatus === 'fertile-window' ||
      cycle.cycleStatus === 'pre-period' ||
      cycle.cycleStatus === 'cycle-in-progress' ||
      cycle.cycleStatus === 'unknown') &&
    isRecord(nextPeriodWindow) &&
    isLocalDate(nextPeriodWindow.startDate) &&
    isLocalDate(nextPeriodWindow.endDate) &&
    nextPeriodWindow.endDate >= nextPeriodWindow.startDate &&
    nextPeriodWindow.startDate >= periodDates.startDate &&
    calendarDayDistance(periodDates.startDate, nextPeriodWindow.endDate) <= 90
  );
}

function isPrivateDailyLogRecord(
  value: unknown,
): value is PrivateDailyLogRecord {
  if (!isRecord(value)) {
    return false;
  }

  const energyLevel = value.energyLevel;
  const moodTag = value.moodTag;
  const symptomTags = value.symptomTags;
  const conditionCode = value.conditionCode;
  const carePreferences = value.carePreferences;
  return (
    isOptionalBoundedString(moodTag, 32) &&
    (moodTag === undefined || MOOD_TAGS.has(moodTag)) &&
    isOptionalStringArray(symptomTags) &&
    (symptomTags === undefined ||
      (symptomTags.length <= 12 &&
        symptomTags.every(tag => SYMPTOM_TAGS.has(tag)))) &&
    (energyLevel === undefined ||
      (typeof energyLevel === 'number' &&
        Number.isInteger(energyLevel) &&
        energyLevel >= 1 &&
        energyLevel <= 5)) &&
    isOptionalBoundedString(conditionCode, 32) &&
    (conditionCode === undefined || CONDITION_CODES.has(conditionCode)) &&
    isOptionalStringArray(carePreferences) &&
    (carePreferences === undefined ||
      (carePreferences.length <= 1 &&
        carePreferences.every(preference =>
          CARE_PREFERENCES.has(preference),
        ))) &&
    isOptionalBoundedString(value.note, 500) &&
    isOptionalBoolean(value.periodStarted) &&
    isOptionalBoolean(value.periodEnded) &&
    !(value.periodStarted === true && value.periodEnded === true)
  );
}

function isPairEventInput(value: unknown): value is PairEventInput {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    value.id.length <= 128 &&
    isNonEmptyString(value.title) &&
    value.title.length <= 80 &&
    isLocalDate(value.date) &&
    (value.startTime === undefined ||
      (typeof value.startTime === 'string' &&
        LOCAL_TIME.test(value.startTime))) &&
    (value.endTime === undefined ||
      (typeof value.endTime === 'string' && LOCAL_TIME.test(value.endTime))) &&
    (value.endTime === undefined ||
      (typeof value.startTime === 'string' &&
        value.endTime >= value.startTime)) &&
    isOptionalBoundedString(value.note, 500)
  );
}

const SHARE_SETTING_KEYS = [
  'cyclePhase',
  'cycleStatus',
  'fertilityStatus',
  'nextPeriodWindow',
  'periodDates',
  'moodTag',
  'symptomTags',
  'energyLevel',
  'conditionCode',
  'carePreferences',
  'note',
] as const satisfies readonly (keyof BackendShareSettings)[];

function isShareSettings(value: unknown): value is BackendShareSettings {
  return (
    isRecord(value) &&
    Object.keys(value).every(key =>
      SHARE_SETTING_KEYS.includes(key as (typeof SHARE_SETTING_KEYS)[number]),
    ) &&
    SHARE_SETTING_KEYS.filter(
      key => key !== 'cycleStatus' && key !== 'fertilityStatus',
    ).every(key => typeof value[key] === 'boolean') &&
    (value.cycleStatus === undefined || typeof value.cycleStatus === 'boolean') &&
    (value.fertilityStatus === undefined ||
      typeof value.fertilityStatus === 'boolean')
  );
}

function isOfflineMutation(value: unknown): value is StoredOfflineMutation {
  const queueSequence = isRecord(value) ? value.queueSequence : undefined;
  const queueState = isRecord(value) ? value.queueState : undefined;
  const failureCode = isRecord(value) ? value.failureCode : undefined;
  const failedAt = isRecord(value) ? value.failedAt : undefined;
  if (
    !isRecord(value) ||
    value.schemaVersion !== SCHEMA_VERSION ||
    !isNonEmptyString(value.uid) ||
    !isNonEmptyString(value.mutationId) ||
    value.uid.length > 128 ||
    value.mutationId.length > 128 ||
    !isCreatedAt(value.createdAt) ||
    (queueSequence !== undefined &&
      (typeof queueSequence !== 'number' ||
        !Number.isSafeInteger(queueSequence) ||
        queueSequence < 1)) ||
    (queueState !== undefined && queueState !== 'failed') ||
    (queueState === 'failed' &&
      (!isNonEmptyString(failureCode) ||
        failureCode.length > 64 ||
        !/^[a-z0-9/_-]+$/.test(failureCode) ||
        !isCreatedAt(failedAt))) ||
    (queueState === undefined &&
      (failureCode !== undefined || failedAt !== undefined))
  ) {
    return false;
  }

  switch (value.type) {
    case 'private-setup':
      return isPrivateSetupSnapshot(value.setup);
    case 'share-settings':
      return isNonEmptyString(value.pairId) && isShareSettings(value.settings);
    case 'daily-log':
      return (
        isReasonableRecordedLocalDate(value.localDate) &&
        isPrivateDailyLogRecord(value.record)
      );
    case 'delete-daily-log':
      return isReasonableRecordedLocalDate(value.localDate);
    case 'upsert-pair-event':
      return isNonEmptyString(value.pairId) && isPairEventInput(value.event);
    case 'delete-pair-event':
      return isNonEmptyString(value.pairId) && isNonEmptyString(value.eventId);
    default:
      return false;
  }
}

function encodeServiceSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function legacyUserServicePrefix(uid: string): string {
  return `${SERVICE_PREFIX}${encodeServiceSegment(uid)}::`;
}

function userServicePrefix(uid: string): string {
  return `${SERVICE_PREFIX}${opaqueServiceSegment(uid)}::`;
}

function serviceFor(uid: string, mutationId: string): string {
  return `${userServicePrefix(uid)}${opaqueServiceSegment(mutationId)}`;
}

function legacyServiceFor(uid: string, mutationId: string): string {
  return `${legacyUserServicePrefix(uid)}${encodeServiceSegment(mutationId)}`;
}

async function removeService(service: string): Promise<void> {
  const services = await Keychain.getAllGenericPasswordServices({
    skipUIAuth: true,
  });
  if (!services.includes(service)) return;
  await Keychain.resetGenericPassword({ service });
}

async function removeServiceStrict(service: string): Promise<void> {
  const removed = await Keychain.resetGenericPassword({ service });
  if (!removed) {
    throw new Error('Unable to remove revoked Pair data from secure storage.');
  }
}

async function removeMutationServicesStrict(
  uid: string,
  mutationId: string,
): Promise<void> {
  const candidates = [
    serviceFor(uid, mutationId),
    legacyServiceFor(uid, mutationId),
  ];
  const services = await Keychain.getAllGenericPasswordServices({
    skipUIAuth: true,
  });
  const existing = candidates.filter(candidate => services.includes(candidate));
  if (existing.length === 0) {
    throw new Error('Unable to remove revoked Pair data from secure storage.');
  }
  for (const service of existing) await removeServiceStrict(service);
}

class KeychainSecureOfflineMutationQueue implements SecureOfflineMutationQueue {
  private readonly enqueueChains = new Map<string, Promise<void>>();
  private readonly pairFence = new PairDataFence();
  private readonly discardedCounts = new Map<string, number>();

  takeDiscardedCount(uid: string): number {
    const count = this.discardedCounts.get(uid) ?? 0;
    this.discardedCounts.delete(uid);
    return count;
  }

  async enqueue(mutation: OfflineMutation): Promise<void> {
    if (!isOfflineMutation(mutation)) {
      throw new Error('Invalid offline mutation.');
    }

    const pairId = pairIdForOfflineMutation(mutation);
    if (pairId && this.pairFence.isBlocked(mutation.uid, pairId)) {
      throw new Error('Pair data is revoked.');
    }
    const persist = () =>
      pairId
        ? this.pairFence.runWrite(mutation.uid, pairId, () =>
            this.persistWithSequence(mutation),
          )
        : this.persistWithSequence(mutation);
    const previous = this.enqueueChains.get(mutation.uid) ?? Promise.resolve();
    const pending = previous.then(
      persist,
      persist,
    );
    this.enqueueChains.set(
      mutation.uid,
      pending.then(
        () => undefined,
        () => undefined,
      ),
    );
    return pending;
  }

  private async persistWithSequence(mutation: OfflineMutation): Promise<void> {
    await secureUserDataFence.runWrite(mutation.uid, async () => {
      const current = await this.listStored(mutation.uid);
      const key = coalesceKeyForOfflineMutation(mutation);
      // 격리된 항목은 접기 대상이 아니다. 진단 이력이므로 그대로 남긴다.
      const existing = current.find(
        item =>
          item.queueState !== 'failed' &&
          coalesceKeyForOfflineMutation(item) === key,
      );
      const maximumSequence = current.reduce(
        (maximum, item) => Math.max(maximum, item.queueSequence ?? 0),
        0,
      );
      const stored: StoredOfflineMutation = {
        ...mutation,
        // 접을 때 기존 순번을 유지한다. 그래야 다른 날짜·다른 종류와의
        // 상대 재생 순서가 바뀌지 않는다.
        queueSequence: existing?.queueSequence ?? maximumSequence + 1,
      };
      const result = await Keychain.setGenericPassword(
        mutation.uid,
        JSON.stringify(stored),
        {
          service: serviceFor(mutation.uid, mutation.mutationId),
          accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
          storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
          cloudSync: false,
        },
      );

      if (!result) {
        throw new Error(
          'Unable to persist offline mutation in secure storage.',
        );
      }
      await removeService(
        legacyServiceFor(mutation.uid, mutation.mutationId),
      );
      // 접힌 항목의 Keychain service 를 지운다. mutationId 가 달라지므로
      // 지우지 않으면 같은 대상의 고아 항목이 남는다.
      if (existing && existing.mutationId !== mutation.mutationId) {
        await Promise.all(
          [
            serviceFor(mutation.uid, existing.mutationId),
            legacyServiceFor(mutation.uid, existing.mutationId),
          ].map(removeService),
        );
      }
      await this.enforceQueueLimit(mutation.uid);
    });
  }

  private async listStored(
    uid: string,
    strictKeychainReads = false,
  ): Promise<readonly StoredOfflineMutation[]> {
    if (!isNonEmptyString(uid)) {
      return [];
    }

    const services = await Keychain.getAllGenericPasswordServices({
      skipUIAuth: true,
    });
    const matchingServices = [
      ...services.filter(service =>
        service.startsWith(userServicePrefix(uid)),
      ),
      ...services.filter(service =>
        service.startsWith(legacyUserServicePrefix(uid)),
      ),
    ];
    const mutations: StoredOfflineMutation[] = [];

    for (const service of matchingServices) {
      let credentials;
      try {
        credentials = await Keychain.getGenericPassword({ service });
      } catch (error) {
        if (strictKeychainReads) throw error;
        // A temporarily unavailable Keychain must not make us delete recoverable data.
        continue;
      }

      if (!credentials) {
        if (strictKeychainReads) {
          throw new Error(
            'Unable to verify revoked Pair data in secure storage.',
          );
        }
        await removeService(service);
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(credentials.password);
      } catch {
        await (strictKeychainReads
          ? removeServiceStrict(service)
          : removeService(service));
        continue;
      }

      if (
        !isOfflineMutation(parsed) ||
        parsed.uid !== uid ||
        credentials.username !== parsed.uid ||
        (service !== serviceFor(parsed.uid, parsed.mutationId) &&
          service !== legacyServiceFor(parsed.uid, parsed.mutationId))
      ) {
        await (strictKeychainReads
          ? removeServiceStrict(service)
          : removeService(service));
        continue;
      }

      if (
        !mutations.some(
          mutation => mutation.mutationId === parsed.mutationId,
        )
      ) {
        // Opaque services are enumerated first and win over legacy copies.
        mutations.push(parsed);
      }
    }

    return mutations.sort((left, right) => {
      if (
        left.queueSequence !== undefined &&
        right.queueSequence !== undefined
      ) {
        return left.queueSequence - right.queueSequence;
      }
      const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
      if (byCreatedAt !== 0) return byCreatedAt;
      return (
        (left.queueSequence ?? Number.MAX_SAFE_INTEGER) -
          (right.queueSequence ?? Number.MAX_SAFE_INTEGER) ||
        left.mutationId.localeCompare(right.mutationId)
      );
    });
  }

  /**
   * 상한을 넘으면 가장 오래된 미격리 항목부터 버린다.
   *
   * 격리 항목은 건드리지 않는다. 진단 이력이고 재생 대상도 아니라 큐를
   * 굶기지 않는다. 버린 수는 다음 동기화 리포트로 나간다 — 조용히 잘라
   * 내지 않는다.
   */
  private async enforceQueueLimit(uid: string): Promise<void> {
    const stored = await this.listStored(uid);
    const active = stored.filter(item => item.queueState !== 'failed');
    const overflow = active.length - OFFLINE_MUTATION_QUEUE_LIMIT;
    if (overflow <= 0) return;

    const discarded = active.slice(0, overflow);
    for (const item of discarded) {
      await Promise.all(
        [
          serviceFor(uid, item.mutationId),
          legacyServiceFor(uid, item.mutationId),
        ].map(removeService),
      );
    }
    this.discardedCounts.set(
      uid,
      (this.discardedCounts.get(uid) ?? 0) + discarded.length,
    );
  }

  async list(uid: string): Promise<readonly OfflineMutation[]> {
    return (await this.listStored(uid))
      .filter(mutation => mutation.queueState !== 'failed')
      .map(
        ({
          queueSequence: _,
          queueState: _queueState,
          failureCode: _failureCode,
          failedAt: _failedAt,
          ...mutation
        }) => mutation as OfflineMutation,
      );
  }

  /**
   * 재생 대상만 돌려준다.
   *
   * 격리된 항목은 제외한다. 격리는 "재시도해도 결과가 달라지지 않는다"는
   * 종결 상태인데, 예전에는 이 목록에 남아 매 동기화마다 같은 실패를
   * 되풀이했다. 진단 이력은 `countFailed`와 저장소에 그대로 남는다.
   */
  async listForReplay(uid: string): Promise<readonly OfflineMutation[]> {
    return (await this.listStored(uid, true))
      .filter(mutation => mutation.queueState !== 'failed')
      .map(
      ({
        queueSequence: _,
        queueState: _queueState,
        failureCode: _failureCode,
        failedAt: _failedAt,
        ...mutation
      }) => mutation as OfflineMutation,
    );
  }

  async remove(uid: string, mutationId: string): Promise<void> {
    if (!isNonEmptyString(uid) || !isNonEmptyString(mutationId)) {
      return;
    }

    await Promise.all(
      [serviceFor(uid, mutationId), legacyServiceFor(uid, mutationId)].map(
        removeService,
      ),
    );
  }

  async quarantine(
    uid: string,
    mutationId: string,
    failureCode: string,
  ): Promise<void> {
    if (
      !isNonEmptyString(uid) ||
      !isNonEmptyString(mutationId) ||
      !/^[a-z0-9/_-]+$/.test(failureCode) ||
      failureCode.length > 64
    ) {
      throw new Error('Invalid offline mutation failure metadata.');
    }

    const persist = () =>
      secureUserDataFence.runWrite(uid, async () => {
        const stored = (await this.listStored(uid, true)).find(
          mutation => mutation.mutationId === mutationId,
        );
        if (!stored) return;
        const pairId = pairIdForOfflineMutation(stored);
        const writeQuarantined = async () => {
          const quarantined: StoredOfflineMutation = {
            ...stored,
            queueState: 'failed',
            failureCode,
            failedAt: new Date().toISOString(),
          };
          const result = await Keychain.setGenericPassword(
            uid,
            JSON.stringify(quarantined),
            {
              service: serviceFor(uid, mutationId),
              accessible:
                Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
              storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
              cloudSync: false,
            },
          );
          if (!result) {
            throw new Error(
              'Unable to quarantine offline mutation in secure storage.',
            );
          }
          await removeService(legacyServiceFor(uid, mutationId));
        };
        // 개인 건강 기록은 페어 fence 를 타지 않는다. 그 fence 는 해지된
        // 페어의 데이터를 막기 위한 것이고, 개인 기록은 페어에 속하지 않는다.
        // 이미 `secureUserDataFence.runWrite` 안이라 사용자 경계는 지켜진다.
        await (pairId
          ? this.pairFence.runWrite(uid, pairId, writeQuarantined)
          : writeQuarantined());
      });
    const previous = this.enqueueChains.get(uid) ?? Promise.resolve();
    const pending = previous.then(persist, persist);
    this.enqueueChains.set(
      uid,
      pending.then(
        () => undefined,
        () => undefined,
      ),
    );
    return pending;
  }

  async count(uid: string): Promise<number> {
    return (await this.listStored(uid, true)).length;
  }

  async countFailed(uid: string): Promise<number> {
    return (await this.listStored(uid, true)).filter(
      mutation => mutation.queueState === 'failed',
    ).length;
  }

  async listPairIds(uid: string): Promise<readonly string[]> {
    return [
      ...new Set(
        (await this.listStored(uid, true)).flatMap(mutation => {
          const pairId = pairIdForOfflineMutation(mutation);
          return pairId ? [pairId] : [];
        }),
      ),
    ].sort();
  }

  async clearUser(uid: string): Promise<void> {
    if (!isNonEmptyString(uid)) {
      return;
    }

    const services = await Keychain.getAllGenericPasswordServices({
      skipUIAuth: true,
    });
    await Promise.all(
      services
        .filter(
          service =>
            service.startsWith(userServicePrefix(uid)) ||
            service.startsWith(legacyUserServicePrefix(uid)),
        )
        .map(service => removeService(service)),
    );
  }

  async clearPair(uid: string, pairId: string): Promise<void> {
    if (!isNonEmptyString(uid) || !isNonEmptyString(pairId)) {
      return;
    }

    await this.pairFence.blockAndDrain(uid, pairId);
    const mutations = await this.listStored(uid, true);
    await Promise.all(
      mutations
        .filter(
          mutation =>
            (mutation.type === 'share-settings' ||
              mutation.type === 'upsert-pair-event' ||
              mutation.type === 'delete-pair-event') &&
            mutation.pairId === pairId,
        )
        .map(mutation =>
          removeMutationServicesStrict(uid, mutation.mutationId),
        ),
    );
  }
}

export const secureOfflineMutationQueue: SecureOfflineMutationQueue =
  new KeychainSecureOfflineMutationQueue();
