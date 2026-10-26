import { fetch as fetchNetworkState } from '@react-native-community/netinfo';
import { secureOfflineMutationQueue } from '../local/SecureOfflineMutationQueue';
import { firebaseCyclePairBackend } from './FirebaseCyclePairBackend';
import { secureCyclePairCache } from '../local/SecureCyclePairCache';
import type { DailyLogChange } from '../backend/CyclePairBackend';
import { SENSITIVE_HEALTH_CONSENT_VERSION } from '../../domain/privacy/SensitiveHealthConsent';

// Use the same native boundary mocks as the adapter's existing tests.
jest.mock('@react-native-firebase/app', () => ({ getApp: () => ({}) }));
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: null }),
}));
jest.mock('@react-native-firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: jest.fn(),
}));
jest.mock('@react-native-firebase/firestore', () => ({
  getFirestore: () => ({}),
  initializeFirestore: jest.fn(async () => ({})),
  doc: (_db: unknown, ...parts: string[]) => ({
    path: parts.join('/'),
    id: parts.at(-1),
  }),
  collection: jest.fn(),
  query: jest.fn(),
  orderBy: jest.fn(),
  where: jest.fn(),
  limit: jest.fn(),
  documentId: jest.fn(),
  runTransaction: jest.fn(),
  getDocs: jest.fn(),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(),
  setDoc: jest.fn(),
  writeBatch: jest.fn(),
  serverTimestamp: () => ({
    toDate: () => new Date('2026-10-26T00:00:00.000Z'),
  }),
}));
import { getDocs, runTransaction } from '@react-native-firebase/firestore';

const uid = 'atomic-period-test',
  date = '2026-10-01';
const setup = {
  recordsCycle: true,
  consentAcceptedAt: '2026-10-01T00:00:00.000Z',
  consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
};
const change: DailyLogChange = {
  localDate: date,
  expected: { periodStarted: false, periodEnded: false },
  value: { periodStarted: true, periodEnded: true },
  expectedSetup: setup,
  setup: {
    ...setup,
    cycle: {
      asOfDate: '2026-10-26',
      averageCycleLength: 28,
      averagePeriodLength: 1,
      periodDates: { startDate: date, endDate: date },
      cyclePhase: 'luteal',
      nextPeriodWindow: { startDate: '2026-10-25', endDate: '2026-11-02' },
    },
  },
};
let documents: Map<string, Record<string, unknown>>;
const key = `users/${uid}/privateDailyLogs/${date}`,
  setupKey = `users/${uid}/privateCycles/current`,
  tombstoneKey = `users/${uid}/privateDailyLogTombstones/${date}`;

beforeEach(async () => {
  await secureCyclePairCache.clearUser(uid);
  await secureOfflineMutationQueue.clearUser(uid);
  firebaseCyclePairBackend.resumeSession(uid);
  documents = new Map([
    [
      key,
      {
        schemaVersion: 3,
        localDate: date,
        note: 'newest server note',
        emotionTags: ['calm'],
      },
    ],
    [setupKey, { schemaVersion: 2, ...setup }],
  ]);
  jest.mocked(runTransaction).mockImplementation(async (_db, callback) => {
    const writes: Array<() => void> = [];
    const transaction = {
      get: jest.fn(async (ref: { path: string; id: string }) => ({
        id: ref.id,
        exists: () => documents.has(ref.path),
        data: () => documents.get(ref.path),
      })),
      set: jest.fn((ref: { path: string }, data: Record<string, unknown>) => {
        writes.push(() => documents.set(ref.path, data));
      }),
      delete: jest.fn((ref: { path: string }) => {
        writes.push(() => documents.delete(ref.path));
      }),
    };
    const result = await callback(transaction as never);
    for (const write of writes) write();
    return result;
  });
});
afterEach(async () => {
  await secureCyclePairCache.clearUser(uid);
  await secureOfflineMutationQueue.clearUser(uid);
  jest.mocked(fetchNetworkState).mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  } as never);
  jest.clearAllMocks();
});

it('updates a one-day period and its cycle summary atomically while keeping the latest server note', async () => {
  const result = await firebaseCyclePairBackend.saveDailyLogChange(
    uid,
    change,
    'atomic-start',
  );
  expect(result.log?.record.note).toBe('newest server note');
  expect(result.log?.record.emotionTags).toEqual(['calm']);
  expect(documents.get(key)).toMatchObject({
    periodStarted: true,
    periodEnded: true,
    note: 'newest server note',
  });
  expect(documents.get(setupKey)).toMatchObject({
    periodDates: { startDate: date, endDate: date },
  });
  expect(documents.has(tombstoneKey)).toBe(false);
  expect(runTransaction).toHaveBeenCalledTimes(1);
});

it('refuses changed period facts without overwriting either document', async () => {
  documents.set(key, { ...documents.get(key), periodEnded: true });
  const before = JSON.stringify([...documents]);
  await expect(
    firebaseCyclePairBackend.saveDailyLogChange(uid, change, 'atomic-conflict'),
  ).rejects.toMatchObject({ code: 'record-conflict' });
  expect(JSON.stringify([...documents])).toBe(before);
});

it('clears only the markers and preserves other content, but tombstones an empty date', async () => {
  documents.set(key, {
    schemaVersion: 3,
    localDate: date,
    periodStarted: true,
    periodEnded: true,
  });
  documents.set(setupKey, {
    schemaVersion: 2,
    ...setup,
    ...change.setup.cycle,
  });
  const clear = {
    ...change,
    expected: change.value,
    value: change.expected,
    expectedSetup: change.setup,
    setup,
  };
  await firebaseCyclePairBackend.saveDailyLogChange(uid, clear, 'atomic-clear');
  expect(documents.has(key)).toBe(false);
  expect(documents.get(tombstoneKey)).toMatchObject({
    localDate: date,
    lastMutationId: 'atomic-clear',
  });
  expect(documents.get(setupKey)?.periodDates).toBeUndefined();
});

it('does not let an earlier history read erase a newly confirmed write', async () => {
  let release!: (value: unknown) => void;
  const oldRead = new Promise(resolve => {
    release = resolve;
  });
  jest
    .mocked(getDocs)
    .mockImplementationOnce(() => oldRead as never)
    .mockResolvedValueOnce({
      metadata: { fromCache: false },
      docs: [],
    } as never);
  await secureCyclePairCache.saveDailyLog(uid, {
    localDate: date,
    record: { note: 'old cached note' },
    updatedAt: '2026-10-01T00:00:00.000Z',
  });
  const reading = firebaseCyclePairBackend.syncDailyLogs(uid);
  await new Promise(resolve => setTimeout(resolve, 20));
  await firebaseCyclePairBackend.saveDailyLogChange(
    uid,
    change,
    'atomic-during-read',
  );
  release({
    metadata: { fromCache: false },
    docs: [
      {
        id: date,
        data: () => ({
          localDate: date,
          note: 'old cached note',
          updatedAt: { toDate: () => new Date('2026-10-01T00:00:00.000Z') },
        }),
      },
    ],
  });
  const logs = await reading;
  expect(logs.find(log => log.localDate === date)?.record.periodStarted).toBe(
    true,
  );
  expect(
    (await secureCyclePairCache.loadDailyLogs(uid)).find(
      log => log.localDate === date,
    )?.record.note,
  ).toBe('newest server note');
});
it('keeps current server period facts when only feelings change', async () => {
  documents.set(key, { ...documents.get(key), periodStarted: true });
  documents.set(setupKey, {
    schemaVersion: 2,
    ...setup,
    ...change.setup.cycle,
  });
  const result = await firebaseCyclePairBackend.saveDailyLogChange(
    uid,
    {
      ...change,
      preservePeriod: true,
      record: { emotionTags: ['happy'], note: 'new note' },
      expectedRecord: { emotionTags: ['calm'], note: 'newest server note' },
    },
    'atomic-mood',
  );
  expect(result.log?.record).toMatchObject({
    periodStarted: true,
    note: 'new note',
    emotionTags: ['happy'],
  });
  expect(result.setup.cycle?.periodDates).toEqual({
    startDate: date,
    endDate: date,
  });
});
it('retains the other setup boundary when its start is cleared', async () => {
  const end = '2026-10-05';
  const prior = {
    ...change.setup,
    cycle: {
      ...change.setup.cycle!,
      periodDates: { startDate: date, endDate: end },
    },
  };
  documents.set(key, { localDate: date, periodStarted: true, note: 'keep' });
  documents.set(setupKey, { schemaVersion: 2, ...setup, ...prior.cycle });
  const result = await firebaseCyclePairBackend.saveDailyLogChange(
    uid,
    {
      ...change,
      expected: { periodStarted: true, periodEnded: false },
      value: { periodStarted: false, periodEnded: false },
      expectedSetup: prior,
      setup,
    },
    'atomic-clear-start',
  );
  expect(
    result.related.find(log => log.localDate === end)?.log?.record.periodEnded,
  ).toBe(true);
  expect(
    documents.get(`users/${uid}/privateDailyLogs/${end}`)?.periodEnded,
  ).toBe(true);
  expect(result.log?.record.note).toBe('keep');
});
it('rejects stale full content without losing the server note', async () => {
  await expect(
    firebaseCyclePairBackend.saveDailyLogChange(
      uid,
      {
        ...change,
        record: { note: 'desired' },
        expectedRecord: { note: 'old' },
      },
      'atomic-stale',
    ),
  ).rejects.toMatchObject({ code: 'record-conflict' });
  expect(documents.get(key)?.note).toBe('newest server note');
});

it('replays an encrypted offline period change once and restores a quarantined draft only to its owner', async () => {
  jest.mocked(fetchNetworkState).mockResolvedValue({
    isConnected: false,
    isInternetReachable: false,
  } as never);
  await secureCyclePairCache.saveSetup(uid, setup);
  await secureCyclePairCache.saveDailyLog(uid, {
    localDate: date,
    record: { note: 'newest server note', emotionTags: ['calm'] },
  });
  const queued = await firebaseCyclePairBackend.saveDailyLogChange(
    uid,
    change,
    'offline-period',
  );
  expect(queued.status).toBe('queued');
  expect(runTransaction).not.toHaveBeenCalled();
  expect(
    (await firebaseCyclePairBackend.loadCachedDailyLogs(uid))[0]?.record
      .periodStarted,
  ).toBe(true);
  expect(await secureOfflineMutationQueue.count(uid)).toBe(1);
  jest.mocked(fetchNetworkState).mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  } as never);
  await firebaseCyclePairBackend.flushPendingMutations(uid);
  expect(documents.get(key)?.periodStarted).toBe(true);
  expect(await secureOfflineMutationQueue.count(uid)).toBe(0);
  await firebaseCyclePairBackend.flushPendingMutations(uid);
  expect(runTransaction).toHaveBeenCalledTimes(1);
  await secureOfflineMutationQueue.enqueue({
    schemaVersion: 1,
    type: 'daily-log-change',
    uid,
    change,
    mutationId: 'failed-period',
    createdAt: new Date().toISOString(),
  });
  await secureOfflineMutationQueue.quarantine(
    uid,
    'failed-period',
    'record-conflict',
  );
  expect(
    await firebaseCyclePairBackend.loadFailedDailyDraft(uid, date),
  ).toEqual({ value: change.value, periodEdited: true });
  expect(
    await firebaseCyclePairBackend.loadFailedDailyDraft('another-owner', date),
  ).toBeNull();
});
it('recognizes the same mutation without rewriting a later server note', async () => {
  await firebaseCyclePairBackend.saveDailyLogChange(uid, change, 'idempotent');
  documents.set(key, { ...documents.get(key), note: 'later note' });
  const result = await firebaseCyclePairBackend.saveDailyLogChange(
    uid,
    change,
    'idempotent',
  );
  expect(result.log?.record.note).toBe('later note');
  expect(documents.get(key)?.note).toBe('later note');
});
