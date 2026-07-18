/* eslint-env jest */

jest.mock('react-native-keychain', () => ({
  __esModule: true,
  ACCESSIBLE: {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
      'AccessibleAfterFirstUnlockThisDeviceOnly',
  },
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  getAllGenericPasswordServices: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

import * as Keychain from 'react-native-keychain';

import { secureCyclePairCache } from './SecureCyclePairCache';

interface MockCredential {
  readonly username: string;
  readonly password: string;
}

const setPassword = Keychain.setGenericPassword as jest.MockedFunction<
  typeof Keychain.setGenericPassword
>;
const getPassword = Keychain.getGenericPassword as jest.MockedFunction<
  typeof Keychain.getGenericPassword
>;
const getServices =
  Keychain.getAllGenericPasswordServices as jest.MockedFunction<
    typeof Keychain.getAllGenericPasswordServices
  >;
const resetPassword = Keychain.resetGenericPassword as jest.MockedFunction<
  typeof Keychain.resetGenericPassword
>;

let stored: Map<string, MockCredential>;

beforeEach(() => {
  jest.clearAllMocks();
  stored = new Map();
  setPassword.mockImplementation(async (username, password, options) => {
    const service = options?.service ?? 'default';
    stored.set(service, { username, password });
    return { service, storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH };
  });
  getPassword.mockImplementation(async options => {
    const service = options?.service ?? 'default';
    const value = stored.get(service);
    return value
      ? { service, storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH, ...value }
      : false;
  });
  getServices.mockImplementation(async () => [...stored.keys()]);
  resetPassword.mockImplementation(async options =>
    stored.delete(options?.service ?? 'default'),
  );
});

describe('secureCyclePairCache', () => {
  it('restores owner setup and daily logs from device-only encrypted storage', async () => {
    const setup = {
      recordsCycle: true,
      consentAcceptedAt: '2026-07-14T00:00:00.000Z',
      cycle: {
        asOfDate: '2026-07-14',
        averageCycleLength: 28,
        averagePeriodLength: 5,
        periodDates: { startDate: '2026-07-01' },
        cyclePhase: 'follicular' as const,
        nextPeriodWindow: {
          startDate: '2026-07-22',
          endDate: '2026-08-05',
        },
      },
    };
    const daily = {
      localDate: '2026-07-14',
      record: { moodTag: 'good', note: '민감한 기록' },
      mutationId: 'daily-1',
      updatedAt: '2026-07-14T01:00:00.000Z',
    };

    await secureCyclePairCache.saveSetup('user-a', setup);
    await secureCyclePairCache.saveDailyLog('user-a', daily);

    await expect(secureCyclePairCache.loadSetup('user-a')).resolves.toEqual(
      setup,
    );
    await expect(
      secureCyclePairCache.loadDailyLogs('user-a', '2026-07-01', '2026-07-31'),
    ).resolves.toEqual([daily]);
    expect(setPassword).toHaveBeenCalledWith(
      'user-a',
      expect.any(String),
      expect.objectContaining({
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        cloudSync: false,
      }),
    );
    for (const service of stored.keys()) {
      expect(service).not.toContain('user-a');
      expect(service).not.toContain('2026-07-14');
    }
  });

  it('기존 raw service cache를 읽되 다음 저장부터 원문 식별자를 제거한다', async () => {
    const setup = {
      recordsCycle: false,
      consentAcceptedAt: '2026-07-14T00:00:00.000Z',
    };
    const legacyService =
      'com.seorilabs.cyclepair.private-cache.v1.user-a::setup';
    stored.set(legacyService, {
      username: 'user-a',
      password: JSON.stringify({
        schemaVersion: 1,
        type: 'setup',
        uid: 'user-a',
        value: setup,
      }),
    });

    await expect(secureCyclePairCache.loadSetup('user-a')).resolves.toEqual(
      setup,
    );
    await secureCyclePairCache.saveSetup('user-a', setup);

    expect(stored.has(legacyService)).toBe(false);
    expect([...stored.keys()].every(service => !service.includes('user-a'))).toBe(
      true,
    );
  });

  it('stores a cycle-recording role without inventing a prediction seed', async () => {
    const setup = {
      recordsCycle: true,
      consentAcceptedAt: '2026-07-14T00:00:00.000Z',
    };

    await secureCyclePairCache.saveSetup('user-a', setup);

    await expect(secureCyclePairCache.loadSetup('user-a')).resolves.toEqual(
      setup,
    );
  });

  it('caches Pair shell and events, then removes only that Pair on revoke', async () => {
    const membership = { pairId: 'pair-a', partnerUid: 'user-b' };
    const event = {
      id: 'event-a',
      pairId: 'pair-a',
      title: '공동 일정',
      date: '2026-07-20',
      createdBy: 'user-a',
      updatedBy: 'user-a',
      mutationId: 'event-mutation-a',
    };
    await secureCyclePairCache.saveSetup('user-a', {
      recordsCycle: false,
      consentAcceptedAt: '2026-07-14T00:00:00.000Z',
    });
    await secureCyclePairCache.saveMembership('user-a', membership);
    await secureCyclePairCache.savePairEvents('user-a', 'pair-a', [event]);

    for (const service of stored.keys()) {
      expect(service).not.toContain('user-a');
      expect(service).not.toContain('pair-a');
      expect(service).not.toContain('event-a');
    }

    await expect(
      secureCyclePairCache.loadMembership('user-a'),
    ).resolves.toEqual(membership);
    await expect(
      secureCyclePairCache.loadPairEvents('user-a', 'pair-a'),
    ).resolves.toEqual([event]);
    await expect(secureCyclePairCache.listPairIds('user-a')).resolves.toEqual([
      'pair-a',
    ]);

    await secureCyclePairCache.clearPair('user-a', 'pair-a');

    await expect(
      secureCyclePairCache.loadMembership('user-a'),
    ).resolves.toBeNull();
    await expect(
      secureCyclePairCache.loadPairEvents('user-a', 'pair-a'),
    ).resolves.toEqual([]);
    await expect(secureCyclePairCache.listPairIds('user-a')).resolves.toEqual(
      [],
    );
    await expect(
      secureCyclePairCache.loadSetup('user-a'),
    ).resolves.not.toBeNull();
  });

  it('drains an in-flight Pair cache writer before revoke clear and blocks late rewrites', async () => {
    const event = {
      id: 'event-race',
      pairId: 'pair-race-cache',
      title: '지연 일정',
      date: '2026-07-22',
      createdBy: 'user-a',
      updatedBy: 'user-a',
      mutationId: 'event-race-mutation',
    };
    let releaseWrite: (() => void) | undefined;
    setPassword.mockImplementationOnce(
      (username, password, options) =>
        new Promise(resolve => {
          releaseWrite = () => {
            const service = options?.service ?? 'default';
            stored.set(service, { username, password });
            resolve({
              service,
              storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
            });
          };
        }),
    );

    const save = secureCyclePairCache.savePairEvents(
      'user-a',
      'pair-race-cache',
      [event],
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(setPassword).toHaveBeenCalledTimes(1);

    const clear = secureCyclePairCache.clearPair(
      'user-a',
      'pair-race-cache',
    );
    let cleared = false;
    clear.then(() => {
      cleared = true;
    });
    await Promise.resolve();
    expect(cleared).toBe(false);

    releaseWrite?.();
    await save;
    await clear;
    await expect(
      secureCyclePairCache.loadPairEvents('user-a', 'pair-race-cache'),
    ).resolves.toEqual([]);
    await expect(
      secureCyclePairCache.savePairEvents('user-a', 'pair-race-cache', [event]),
    ).rejects.toThrow('Pair data is revoked.');
  });

  it('revoke clear는 membership Keychain read 실패 시 ACK 가능한 성공을 반환하지 않는다', async () => {
    const membership = {
      pairId: 'pair-strict-cache-read',
      partnerUid: 'user-b',
    };
    await secureCyclePairCache.saveMembership('user-a', membership);
    getPassword.mockRejectedValueOnce(
      new Error('Keychain temporarily unavailable'),
    );

    await expect(
      secureCyclePairCache.clearPair('user-a', 'pair-strict-cache-read'),
    ).rejects.toThrow('Keychain temporarily unavailable');
    expect(stored).toHaveProperty('size', 1);

    await expect(
      secureCyclePairCache.clearPair('user-a', 'pair-strict-cache-read'),
    ).resolves.toBeUndefined();
    expect(stored).toHaveProperty('size', 0);
  });

  it('does not mistake a failed membership Keychain read for an empty cache', async () => {
    const membership = {
      pairId: 'pair-strict-membership-load',
      partnerUid: 'user-b',
    };
    await secureCyclePairCache.saveMembership('user-a', membership);
    getPassword.mockRejectedValueOnce(
      new Error('Keychain temporarily unavailable'),
    );

    await expect(
      secureCyclePairCache.loadMembership('user-a'),
    ).rejects.toThrow('Keychain temporarily unavailable');
    await expect(
      secureCyclePairCache.loadMembership('user-a'),
    ).resolves.toEqual(membership);
  });

  it('keeps membership retry evidence when Pair event removal fails', async () => {
    const membership = {
      pairId: 'pair-partial-clear',
      partnerUid: 'user-b',
    };
    const event = {
      id: 'event-partial-clear',
      pairId: membership.pairId,
      title: '삭제 재시도 일정',
      date: '2026-07-22',
      createdBy: 'user-a',
      updatedBy: 'user-a',
      mutationId: 'event-partial-clear-mutation',
    };
    await secureCyclePairCache.saveMembership('user-a', membership);
    await secureCyclePairCache.savePairEvents('user-a', membership.pairId, [
      event,
    ]);
    resetPassword.mockResolvedValueOnce(false);

    await expect(
      secureCyclePairCache.clearPair('user-a', membership.pairId),
    ).rejects.toThrow('Unable to remove revoked Pair data');
    await expect(
      secureCyclePairCache.loadMembership('user-a'),
    ).resolves.toEqual(membership);

    await expect(
      secureCyclePairCache.clearPair('user-a', membership.pairId),
    ).resolves.toBeUndefined();
    await expect(
      secureCyclePairCache.loadMembership('user-a'),
    ).resolves.toBeNull();
  });

  it('isolates users and purges every private entry after account deletion', async () => {
    const setup = {
      recordsCycle: false,
      consentAcceptedAt: '2026-07-14T00:00:00.000Z',
    };
    await secureCyclePairCache.saveSetup('user-a', setup);
    await secureCyclePairCache.saveSetup('user-b', setup);

    await secureCyclePairCache.clearUser('user-a');

    await expect(secureCyclePairCache.loadSetup('user-a')).resolves.toBeNull();
    await expect(secureCyclePairCache.loadSetup('user-b')).resolves.toEqual(
      setup,
    );
  });

  it('drops corrupted entries instead of exposing unvalidated cached data', async () => {
    await secureCyclePairCache.saveSetup('user-a', {
      recordsCycle: false,
      consentAcceptedAt: '2026-07-14T00:00:00.000Z',
    });
    const [service] = [...stored.keys()];
    stored.set(service!, { username: 'user-a', password: '{broken' });

    await expect(secureCyclePairCache.loadSetup('user-a')).resolves.toBeNull();
    expect(resetPassword).toHaveBeenCalledWith({ service });
  });

  it('rejects normalized-but-impossible ISO timestamps in cached records', async () => {
    await expect(
      secureCyclePairCache.saveDailyLog('user-a', {
        localDate: '2026-07-14',
        record: { moodTag: 'good' },
        updatedAt: '2026-02-30T00:00:00.000Z',
      }),
    ).rejects.toThrow('Invalid private cache entry.');
    expect(setPassword).not.toHaveBeenCalled();
  });
});
