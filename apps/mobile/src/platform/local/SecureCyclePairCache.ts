import { parseIsoTimestamp, parseLocalDate } from '@cyclepair/product-core';
import * as Keychain from 'react-native-keychain';

import type {
  ActivePairMembership,
  PairEvent,
  PrivateDailyLogSnapshot,
  PrivateSetupSnapshot,
} from '../backend/CyclePairBackend';
import { PairDataFence } from './PairDataFence';
import {opaqueServiceSegment} from './opaqueServiceSegment';
import { secureUserDataFence } from './SecureUserDataFence';

const SCHEMA_VERSION = 1 as const;
const SERVICE_PREFIX = 'com.seorilabs.cyclepair.private-cache.v1.';

type CacheEntry =
  | {
      readonly schemaVersion: typeof SCHEMA_VERSION;
      readonly type: 'setup';
      readonly uid: string;
      readonly value: PrivateSetupSnapshot;
    }
  | {
      readonly schemaVersion: typeof SCHEMA_VERSION;
      readonly type: 'membership';
      readonly uid: string;
      readonly value: ActivePairMembership;
    }
  | {
      readonly schemaVersion: typeof SCHEMA_VERSION;
      readonly type: 'daily-log';
      readonly uid: string;
      readonly value: PrivateDailyLogSnapshot;
    }
  | {
      readonly schemaVersion: typeof SCHEMA_VERSION;
      readonly type: 'pair-event';
      readonly uid: string;
      readonly value: PairEvent;
    };

export interface SecureCyclePairCache {
  loadSetup(uid: string): Promise<PrivateSetupSnapshot | null>;
  saveSetup(uid: string, setup: PrivateSetupSnapshot): Promise<void>;
  clearSetup(uid: string): Promise<void>;
  loadDailyLogs(
    uid: string,
    fromDate: string,
    toDate: string,
  ): Promise<readonly PrivateDailyLogSnapshot[]>;
  saveDailyLog(uid: string, log: PrivateDailyLogSnapshot): Promise<void>;
  saveDailyLogs(
    uid: string,
    logs: readonly PrivateDailyLogSnapshot[],
  ): Promise<void>;
  loadMembership(uid: string): Promise<ActivePairMembership | null>;
  saveMembership(
    uid: string,
    membership: ActivePairMembership | null,
  ): Promise<void>;
  loadPairEvents(uid: string, pairId: string): Promise<readonly PairEvent[]>;
  savePairEvents(
    uid: string,
    pairId: string,
    events: readonly PairEvent[],
  ): Promise<void>;
  clearPair(uid: string, pairId: string): Promise<void>;
  listPairIds(uid: string): Promise<readonly string[]>;
  clearUser(uid: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    parseLocalDate(value);
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

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  try {
    parseIsoTimestamp(value);
    return true;
  } catch {
    return false;
  }
}

function isOptionalString(value: unknown, maxLength: number): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' && value.length <= maxLength)
  );
}

function isPrivateSetup(value: unknown): value is PrivateSetupSnapshot {
  if (!isRecord(value) || typeof value.recordsCycle !== 'boolean') return false;
  if (!isIsoTimestamp(value.consentAcceptedAt)) return false;
  if (value.cycle === undefined) return true;
  if (!value.recordsCycle || !isRecord(value.cycle)) return false;
  const periodDates = value.cycle.periodDates;
  const nextPeriodWindow = value.cycle.nextPeriodWindow;
  return (
    isReasonableRecordedLocalDate(value.cycle.asOfDate) &&
    isRecord(periodDates) &&
    isReasonableRecordedLocalDate(periodDates.startDate) &&
    (periodDates.endDate === undefined ||
      (isReasonableRecordedLocalDate(periodDates.endDate) &&
        periodDates.endDate >= periodDates.startDate)) &&
    value.cycle.asOfDate >= periodDates.startDate &&
    typeof value.cycle.averageCycleLength === 'number' &&
    Number.isInteger(value.cycle.averageCycleLength) &&
    value.cycle.averageCycleLength >= 15 &&
    value.cycle.averageCycleLength <= 60 &&
    typeof value.cycle.averagePeriodLength === 'number' &&
    Number.isInteger(value.cycle.averagePeriodLength) &&
    value.cycle.averagePeriodLength >= 1 &&
    value.cycle.averagePeriodLength <= 14 &&
    value.cycle.averagePeriodLength <= value.cycle.averageCycleLength &&
    (value.cycle.cyclePhase === 'menstrual' ||
      value.cycle.cyclePhase === 'follicular' ||
      value.cycle.cyclePhase === 'luteal' ||
      value.cycle.cyclePhase === 'unknown') &&
    isRecord(nextPeriodWindow) &&
    isLocalDate(nextPeriodWindow.startDate) &&
    isLocalDate(nextPeriodWindow.endDate) &&
    nextPeriodWindow.endDate >= nextPeriodWindow.startDate &&
    nextPeriodWindow.startDate >= periodDates.startDate &&
    calendarDayDistance(periodDates.startDate, nextPeriodWindow.endDate) <= 90
  );
}

function isDailyLog(value: unknown): value is PrivateDailyLogSnapshot {
  if (
    !isRecord(value) ||
    !isReasonableRecordedLocalDate(value.localDate) ||
    !isRecord(value.record)
  ) {
    return false;
  }
  const record = value.record;
  return (
    isOptionalString(record.moodTag, 32) &&
    (record.symptomTags === undefined ||
      (Array.isArray(record.symptomTags) &&
        record.symptomTags.length <= 12 &&
        record.symptomTags.every(item => isOptionalString(item, 32)))) &&
    (record.energyLevel === undefined ||
      (typeof record.energyLevel === 'number' &&
        Number.isInteger(record.energyLevel) &&
        record.energyLevel >= 1 &&
        record.energyLevel <= 5)) &&
    isOptionalString(record.conditionCode, 32) &&
    (record.carePreferences === undefined ||
      (Array.isArray(record.carePreferences) &&
        record.carePreferences.length <= 4 &&
        record.carePreferences.every(item => isOptionalString(item, 32)))) &&
    isOptionalString(record.note, 500) &&
    (record.periodStarted === undefined ||
      typeof record.periodStarted === 'boolean') &&
    (record.periodEnded === undefined ||
      typeof record.periodEnded === 'boolean') &&
    isOptionalString(value.mutationId, 128) &&
    (value.updatedAt === undefined || isIsoTimestamp(value.updatedAt))
  );
}

function isMembership(value: unknown): value is ActivePairMembership {
  return (
    isRecord(value) && isString(value.pairId) && isString(value.partnerUid)
  );
}

function isPairEvent(value: unknown): value is PairEvent {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.pairId) &&
    isString(value.title) &&
    value.title.length <= 80 &&
    isLocalDate(value.date) &&
    isOptionalString(value.startTime, 5) &&
    isOptionalString(value.endTime, 5) &&
    isOptionalString(value.note, 500) &&
    isString(value.createdBy) &&
    isString(value.updatedBy) &&
    isString(value.mutationId) &&
    (value.createdAt === undefined || isIsoTimestamp(value.createdAt)) &&
    (value.updatedAt === undefined || isIsoTimestamp(value.updatedAt))
  );
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SCHEMA_VERSION ||
    !isString(value.uid)
  ) {
    return false;
  }
  switch (value.type) {
    case 'setup':
      return isPrivateSetup(value.value);
    case 'membership':
      return isMembership(value.value);
    case 'daily-log':
      return isDailyLog(value.value);
    case 'pair-event':
      return isPairEvent(value.value);
    default:
      return false;
  }
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function legacyUserPrefix(uid: string): string {
  return `${SERVICE_PREFIX}${encodeSegment(uid)}::`;
}

function userPrefix(uid: string): string {
  return `${SERVICE_PREFIX}${opaqueServiceSegment(uid)}::`;
}

function setupService(uid: string): string {
  return `${userPrefix(uid)}setup`;
}

function legacySetupService(uid: string): string {
  return `${legacyUserPrefix(uid)}setup`;
}

function membershipService(uid: string): string {
  return `${userPrefix(uid)}membership`;
}

function legacyMembershipService(uid: string): string {
  return `${legacyUserPrefix(uid)}membership`;
}

function dailyService(uid: string, localDate: string): string {
  return `${userPrefix(uid)}daily::${opaqueServiceSegment(localDate)}`;
}

function legacyDailyService(uid: string, localDate: string): string {
  return `${legacyUserPrefix(uid)}daily::${encodeSegment(localDate)}`;
}

function pairEventPrefix(uid: string, pairId: string): string {
  return `${userPrefix(uid)}event::${opaqueServiceSegment(pairId)}::`;
}

function legacyPairEventPrefix(uid: string, pairId: string): string {
  return `${legacyUserPrefix(uid)}event::${encodeSegment(pairId)}::`;
}

function pairEventService(
  uid: string,
  pairId: string,
  eventId: string,
): string {
  return `${pairEventPrefix(uid, pairId)}${opaqueServiceSegment(eventId)}`;
}

function legacyPairEventService(
  uid: string,
  pairId: string,
  eventId: string,
): string {
  return `${legacyPairEventPrefix(uid, pairId)}${encodeSegment(eventId)}`;
}

async function removeService(service: string): Promise<void> {
  await Keychain.resetGenericPassword({ service });
}

async function removeServiceStrict(service: string): Promise<void> {
  const removed = await Keychain.resetGenericPassword({ service });
  if (!removed) {
    throw new Error('Unable to remove revoked Pair data from secure storage.');
  }
}

async function writeEntry(service: string, entry: CacheEntry): Promise<void> {
  if (!isCacheEntry(entry)) {
    throw new Error('Invalid private cache entry.');
  }
  const stored = await Keychain.setGenericPassword(
    entry.uid,
    JSON.stringify(entry),
    {
      service,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
      cloudSync: false,
    },
  );
  if (!stored) throw new Error('Unable to persist private cache entry.');
}

async function readEntry(
  service: string,
  uid: string,
  strictKeychainRead = false,
): Promise<CacheEntry | null> {
  const services = await Keychain.getAllGenericPasswordServices({
    skipUIAuth: true,
  });
  if (!services.includes(service)) return null;
  let credentials;
  try {
    credentials = await Keychain.getGenericPassword({ service });
  } catch (error) {
    if (strictKeychainRead) throw error;
    return null;
  }
  if (!credentials) {
    if (strictKeychainRead) {
      throw new Error(
        'Unable to verify revoked Pair data in secure storage.',
      );
    }
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(credentials.password);
    if (
      !isCacheEntry(parsed) ||
      parsed.uid !== uid ||
      credentials.username !== uid
    ) {
      await (strictKeychainRead
        ? removeServiceStrict(service)
        : removeService(service));
      return null;
    }
    return parsed;
  } catch {
    await (strictKeychainRead
      ? removeServiceStrict(service)
      : removeService(service));
    return null;
  }
}

async function servicesForPrefixes(
  prefixes: readonly string[],
): Promise<readonly string[]> {
  const services = await Keychain.getAllGenericPasswordServices({
    skipUIAuth: true,
  });
  return prefixes.flatMap(prefix =>
    services.filter(service => service.startsWith(prefix)),
  );
}

async function existingServices(
  candidates: readonly string[],
): Promise<readonly string[]> {
  const services = await Keychain.getAllGenericPasswordServices({
    skipUIAuth: true,
  });
  return candidates.filter(candidate => services.includes(candidate));
}

function uniqueCacheEntries(
  entries: readonly (CacheEntry | null)[],
): readonly CacheEntry[] {
  const unique = new Map<string, CacheEntry>();
  for (const entry of entries) {
    if (!entry) continue;
    const key =
      entry.type === 'setup' || entry.type === 'membership'
        ? entry.type
        : entry.type === 'daily-log'
          ? `${entry.type}:${entry.value.localDate}`
          : `${entry.type}:${entry.value.pairId}:${entry.value.id}`;
    // New opaque services are enumerated first and win over legacy copies.
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

class KeychainSecureCyclePairCache implements SecureCyclePairCache {
  private readonly pairFence = new PairDataFence();

  async loadSetup(uid: string): Promise<PrivateSetupSnapshot | null> {
    const entry =
      (await readEntry(setupService(uid), uid)) ??
      (await readEntry(legacySetupService(uid), uid));
    return entry?.type === 'setup' ? entry.value : null;
  }

  saveSetup(uid: string, value: PrivateSetupSnapshot): Promise<void> {
    return secureUserDataFence.runWrite(uid, async () => {
      await writeEntry(setupService(uid), {
        schemaVersion: SCHEMA_VERSION,
        type: 'setup',
        uid,
        value,
      });
      await removeService(legacySetupService(uid));
    });
  }

  async clearSetup(uid: string): Promise<void> {
    await Promise.all(
      [setupService(uid), legacySetupService(uid)].map(removeService),
    );
  }

  async loadDailyLogs(
    uid: string,
    fromDate: string,
    toDate: string,
  ): Promise<readonly PrivateDailyLogSnapshot[]> {
    const entries = uniqueCacheEntries(
      await Promise.all(
        (
          await servicesForPrefixes([
            `${userPrefix(uid)}daily::`,
            `${legacyUserPrefix(uid)}daily::`,
          ])
        ).map(service => readEntry(service, uid)),
      ),
    );
    return entries
      .flatMap(entry =>
        entry?.type === 'daily-log' &&
        entry.value.localDate >= fromDate &&
        entry.value.localDate <= toDate
          ? [entry.value]
          : [],
      )
      .sort((left, right) => right.localDate.localeCompare(left.localDate));
  }

  saveDailyLog(uid: string, value: PrivateDailyLogSnapshot): Promise<void> {
    return secureUserDataFence.runWrite(uid, async () => {
      await writeEntry(dailyService(uid, value.localDate), {
        schemaVersion: SCHEMA_VERSION,
        type: 'daily-log',
        uid,
        value,
      });
      await removeService(legacyDailyService(uid, value.localDate));
    });
  }

  async saveDailyLogs(
    uid: string,
    logs: readonly PrivateDailyLogSnapshot[],
  ): Promise<void> {
    await secureUserDataFence.runWrite(uid, async () => {
      for (const value of logs) {
        await writeEntry(dailyService(uid, value.localDate), {
          schemaVersion: SCHEMA_VERSION,
          type: 'daily-log',
          uid,
          value,
        });
        await removeService(legacyDailyService(uid, value.localDate));
      }
    });
  }

  async loadMembership(uid: string): Promise<ActivePairMembership | null> {
    // Membership is used as durable cleanup evidence after an authoritative
    // revoke. A temporarily unavailable Keychain must surface as an error,
    // rather than being mistaken for proof that no stale Pair exists.
    const entry =
      (await readEntry(membershipService(uid), uid, true)) ??
      (await readEntry(legacyMembershipService(uid), uid, true));
    return entry?.type === 'membership' ? entry.value : null;
  }

  async saveMembership(
    uid: string,
    value: ActivePairMembership | null,
  ): Promise<void> {
    if (!value) {
      await Promise.all(
        [membershipService(uid), legacyMembershipService(uid)].map(
          removeService,
        ),
      );
      return;
    }
    await this.pairFence.runWrite(uid, value.pairId, () =>
      secureUserDataFence.runWrite(uid, async () => {
        await writeEntry(membershipService(uid), {
          schemaVersion: SCHEMA_VERSION,
          type: 'membership',
          uid,
          value,
        });
        await removeService(legacyMembershipService(uid));
      }),
    );
  }

  async loadPairEvents(
    uid: string,
    pairId: string,
  ): Promise<readonly PairEvent[]> {
    const entries = uniqueCacheEntries(
      await Promise.all(
        (
          await servicesForPrefixes([
            pairEventPrefix(uid, pairId),
            legacyPairEventPrefix(uid, pairId),
          ])
        ).map(service => readEntry(service, uid)),
      ),
    );
    return entries
      .flatMap(entry =>
        entry?.type === 'pair-event' && entry.value.pairId === pairId
          ? [entry.value]
          : [],
      )
      .sort((left, right) =>
        `${left.date}:${left.startTime ?? ''}:${left.id}`.localeCompare(
          `${right.date}:${right.startTime ?? ''}:${right.id}`,
        ),
      );
  }

  async savePairEvents(
    uid: string,
    pairId: string,
    events: readonly PairEvent[],
  ): Promise<void> {
    await this.pairFence.runWrite(uid, pairId, () =>
      secureUserDataFence.runWrite(uid, async () => {
        await Promise.all(
          (
            await servicesForPrefixes([
              pairEventPrefix(uid, pairId),
              legacyPairEventPrefix(uid, pairId),
            ])
          ).map(removeService),
        );
        for (const event of events) {
          if (event.pairId !== pairId) continue;
          await writeEntry(pairEventService(uid, pairId, event.id), {
            schemaVersion: SCHEMA_VERSION,
            type: 'pair-event',
            uid,
            value: event,
          });
          await removeService(
            legacyPairEventService(uid, pairId, event.id),
          );
        }
      }),
    );
  }

  async clearPair(uid: string, pairId: string): Promise<void> {
    await this.pairFence.blockAndDrain(uid, pairId);
    const membershipServices = [
      membershipService(uid),
      legacyMembershipService(uid),
    ];
    const membershipEntries = await Promise.all(
      membershipServices.map(service => readEntry(service, uid, true)),
    );
    const services = await servicesForPrefixes([
      pairEventPrefix(uid, pairId),
      legacyPairEventPrefix(uid, pairId),
    ]);
    // Membership is the durable pointer that lets a later authoritative null
    // snapshot retry an interrupted multi-device revoke cleanup. Remove every
    // Pair event first and delete that pointer only after all event removals
    // have succeeded.
    for (const service of services) {
      await removeServiceStrict(service);
    }
    const matchingMembershipServices = membershipServices.filter(
      (_service, index) =>
        membershipEntries[index]?.type === 'membership' &&
        membershipEntries[index].value.pairId === pairId,
    );
    for (const service of await existingServices(
      matchingMembershipServices,
    )) {
      await removeServiceStrict(service);
    }
  }

  async listPairIds(uid: string): Promise<readonly string[]> {
    const entries = await Promise.all(
      (
        await servicesForPrefixes([userPrefix(uid), legacyUserPrefix(uid)])
      ).map(service => readEntry(service, uid, true)),
    );
    return [
      ...new Set(
        entries.flatMap(entry =>
          entry?.type === 'membership' || entry?.type === 'pair-event'
            ? [entry.value.pairId]
            : [],
        ),
      ),
    ].sort();
  }

  async clearUser(uid: string): Promise<void> {
    await Promise.all(
      (
        await servicesForPrefixes([userPrefix(uid), legacyUserPrefix(uid)])
      ).map(removeService),
    );
  }
}

export const secureCyclePairCache: SecureCyclePairCache =
  new KeychainSecureCyclePairCache();
