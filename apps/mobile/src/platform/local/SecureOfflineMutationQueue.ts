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
  quarantine(
    uid: string,
    mutationId: string,
    failureCode: string,
  ): Promise<void>;
  count(uid: string): Promise<number>;
  countFailed(uid: string): Promise<number>;
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
      const existing = current.find(
        item => item.mutationId === mutation.mutationId,
      );
      const maximumSequence = current.reduce(
        (maximum, item) => Math.max(maximum, item.queueSequence ?? 0),
        0,
      );
      const stored: StoredOfflineMutation = {
        ...mutation,
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

  async listForReplay(uid: string): Promise<readonly OfflineMutation[]> {
    return (await this.listStored(uid, true)).map(
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
        if (!pairId) {
          throw new Error('Private offline mutations cannot be quarantined.');
        }
        await this.pairFence.runWrite(uid, pairId, async () => {
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
        });
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
