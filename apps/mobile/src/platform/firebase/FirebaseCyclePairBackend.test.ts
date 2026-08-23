/* eslint-env jest */

jest.mock('@react-native-firebase/app', () => ({
  getApp: jest.fn(() => ({})),
}));

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: null })),
}));

jest.mock('@react-native-firebase/firestore', () => ({
  collection: jest.fn((...path: unknown[]) => ({ path })),
  deleteDoc: jest.fn(),
  doc: jest.fn((...path: unknown[]) => ({ path })),
  documentId: jest.fn(() => ({ documentId: true })),
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

import {
  deleteDoc,
  getDocs,
  onSnapshot,
  setDoc,
} from '@react-native-firebase/firestore';
import { fetch as fetchNetworkState } from '@react-native-community/netinfo';
import { httpsCallable } from '@react-native-firebase/functions';

import { secureOfflineMutationQueue } from '../local/SecureOfflineMutationQueue';
import { firebaseCyclePairBackend } from './FirebaseCyclePairBackend';
import { SENSITIVE_HEALTH_CONSENT_VERSION } from '../../domain/privacy/SensitiveHealthConsent';

const onSnapshotMock = onSnapshot as jest.MockedFunction<typeof onSnapshot>;
const deleteDocMock = deleteDoc as jest.MockedFunction<typeof deleteDoc>;
const getDocsMock = getDocs as jest.MockedFunction<typeof getDocs>;
const setDocMock = setDoc as jest.MockedFunction<typeof setDoc>;
const fetchNetworkStateMock = fetchNetworkState as jest.MockedFunction<
  typeof fetchNetworkState
>;
const httpsCallableMock = httpsCallable as jest.MockedFunction<
  typeof httpsCallable
>;

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

  it('현재 동의 버전만 schema v2 setup으로 저장한다', async () => {
    await expect(
      firebaseCyclePairBackend.savePrivateSetup(
        uid,
        false,
        '2026-08-09T00:00:00.000Z',
        SENSITIVE_HEALTH_CONSENT_VERSION,
      ),
    ).resolves.toEqual({
      status: 'synced',
      mutationId: 'private-setup-current',
    });

    expect(setDocMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        schemaVersion: 2,
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      }),
    );
  });

  it('무버전 동의를 신규 setup 저장 권한으로 승계하지 않는다', async () => {
    await expect(
      firebaseCyclePairBackend.savePrivateSetup(
        uid,
        false,
        '2026-07-14T00:00:00.000Z',
        '',
      ),
    ).rejects.toThrow('Current sensitive health consent is required.');
    expect(setDocMock).not.toHaveBeenCalled();
    await expect(secureOfflineMutationQueue.list(uid)).resolves.toEqual([]);
  });

  it('setup 권한 오류를 오프라인 저장으로 숨기지 않고 암호화 큐에 보존한다', async () => {
    setDocMock.mockRejectedValueOnce({ code: 'firestore/permission-denied' });

    await expect(
      firebaseCyclePairBackend.savePrivateSetup(
        uid,
        false,
        '2026-08-09T00:00:00.000Z',
        SENSITIVE_HEALTH_CONSENT_VERSION,
      ),
    ).rejects.toMatchObject({ code: 'firestore/permission-denied' });

    await expect(secureOfflineMutationQueue.list(uid)).resolves.toEqual([
      expect.objectContaining({
        type: 'private-setup',
        uid,
        mutationId: 'private-setup-current',
      }),
    ]);
  });

  it('기록 권한 오류를 오프라인 저장으로 숨기지 않고 암호화 큐에 보존한다', async () => {
    setDocMock.mockRejectedValueOnce({ code: 'firestore/permission-denied' });

    await expect(
      firebaseCyclePairBackend.saveDailyLog(
        uid,
        '2026-07-14',
        { moodTag: 'neutral', energyLevel: 3 },
        'daily-direct-write',
      ),
    ).rejects.toMatchObject({ code: 'firestore/permission-denied' });

    await expect(secureOfflineMutationQueue.list(uid)).resolves.toEqual([
      expect.objectContaining({
        type: 'daily-log',
        uid,
        mutationId: 'daily-direct-write',
      }),
    ]);
  });

  it('삭제 권한 오류도 오프라인 저장으로 숨기지 않고 암호화 큐에서 재시도한다', async () => {
    deleteDocMock.mockRejectedValueOnce({
      code: 'firestore/permission-denied',
    });

    await expect(
      firebaseCyclePairBackend.deleteDailyLog(
        uid,
        '2026-07-14',
        'daily-delete-direct-write',
      ),
    ).rejects.toMatchObject({ code: 'firestore/permission-denied' });

    await expect(secureOfflineMutationQueue.list(uid)).resolves.toEqual([
      expect.objectContaining({
        type: 'delete-daily-log',
        uid,
        localDate: '2026-07-14',
        mutationId: 'daily-delete-direct-write',
      }),
    ]);
  });

  it('대기 중인 삭제를 원격의 이전 문서로 다시 표시하지 않는다', async () => {
    deleteDocMock.mockRejectedValueOnce({ code: 'firestore/unavailable' });
    getDocsMock.mockResolvedValueOnce({
      docs: [
        {
          id: '2026-07-14',
          data: () => ({
            localDate: '2026-07-14',
            moodTag: 'good',
            lastMutationId: 'older-write',
          }),
        },
      ],
    } as Awaited<ReturnType<typeof getDocs>>);

    await firebaseCyclePairBackend.deleteDailyLog(
      uid,
      '2026-07-14',
      'daily-delete-pending',
    );

    await expect(
      firebaseCyclePairBackend.listDailyLogs(uid, '2026-07-01', '2026-07-31'),
    ).resolves.toEqual([]);
  });

  it('넛지는 오프라인에서 callable이나 재시도 큐에 넣지 않는다', async () => {
    fetchNetworkStateMock.mockResolvedValueOnce({
      isConnected: false,
      isInternetReachable: false,
    } as Awaited<ReturnType<typeof fetchNetworkState>>);

    await expect(
      firebaseCyclePairBackend.sendPartnerNudge(
        uid,
        'pair-offline',
        'check-in-request',
        'nudge-offline-request',
      ),
    ).rejects.toMatchObject({ code: 'network/offline' });

    expect(httpsCallableMock).not.toHaveBeenCalled();
    await expect(secureOfflineMutationQueue.list(uid)).resolves.toEqual([]);
  });
});
