/* eslint-env jest */

jest.mock('@react-native-firebase/app', () => ({
  getApp: jest.fn(() => ({})),
}));

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: null })),
  signInAnonymously: jest.fn(),
}));

jest.mock('@react-native-firebase/firestore', () => ({
  collection: jest.fn((...path: unknown[]) => ({ path })),
  doc: jest.fn((...path: unknown[]) => ({ path })),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  getFirestore: jest.fn(() => ({})),
  initializeFirestore: jest.fn(async () => ({})),
  limit: jest.fn((value: number) => ({ limit: value })),
  onSnapshot: jest.fn(),
  orderBy: jest.fn(),
  query: jest.fn((reference: unknown) => reference),
  serverTimestamp: jest.fn(),
  setDoc: jest.fn(),
  where: jest.fn(),
}));

jest.mock('@react-native-firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(),
}));

import { onSnapshot, setDoc } from '@react-native-firebase/firestore';

import { secureOfflineMutationQueue } from '../local/SecureOfflineMutationQueue';
import { firebaseCyclePairBackend } from './FirebaseCyclePairBackend';

const onSnapshotMock = onSnapshot as jest.MockedFunction<typeof onSnapshot>;
const setDocMock = setDoc as jest.MockedFunction<typeof setDoc>;

describe('firebaseCyclePairBackend Pair membership watch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores local cache snapshots and exposes only server-confirmed state', () => {
    let emitSnapshot: ((snapshot: unknown) => void) | undefined;
    const nativeStop = jest.fn();
    onSnapshotMock.mockImplementation((...args: unknown[]) => {
      emitSnapshot = args[2] as (snapshot: unknown) => void;
      return nativeStop;
    });
    const onValue = jest.fn();
    const onError = jest.fn();

    const stop = firebaseCyclePairBackend.watchActivePair(
      'metadata-user',
      onValue,
      onError,
    );

    expect(onSnapshotMock).toHaveBeenCalledWith(
      expect.anything(),
      { includeMetadataChanges: true },
      expect.any(Function),
      onError,
    );

    emitSnapshot?.({
      metadata: { fromCache: true },
      docs: [
        {
          data: () => ({
            pairId: 'stale-pair',
            partnerUid: 'former-partner',
          }),
        },
      ],
    });
    expect(onValue).not.toHaveBeenCalled();

    emitSnapshot?.({ metadata: { fromCache: false }, docs: [] });
    expect(onValue).toHaveBeenCalledWith(null);

    stop();
    expect(nativeStop).toHaveBeenCalledTimes(1);
  });
});

describe('firebaseCyclePairBackend durable mutation fallback', () => {
  const uid = 'direct-write-user';

  beforeEach(async () => {
    jest.clearAllMocks();
    await secureOfflineMutationQueue.clearUser(uid);
    firebaseCyclePairBackend.resumeSession(uid);
  });

  afterEach(async () => {
    await secureOfflineMutationQueue.clearUser(uid);
  });

  it('권한 오류가 발생해도 유효한 민감 기록을 암호화 큐에 보존한다', async () => {
    setDocMock.mockRejectedValueOnce({ code: 'firestore/permission-denied' });

    await expect(
      firebaseCyclePairBackend.saveDailyLog(
        uid,
        '2026-07-14',
        { moodTag: 'neutral', energyLevel: 3 },
        'daily-direct-write',
      ),
    ).resolves.toEqual({
      status: 'queued',
      mutationId: 'daily-direct-write',
    });

    await expect(secureOfflineMutationQueue.list(uid)).resolves.toEqual([
      expect.objectContaining({
        type: 'daily-log',
        uid,
        mutationId: 'daily-direct-write',
      }),
    ]);
  });
});
