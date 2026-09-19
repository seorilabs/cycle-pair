/* eslint-env jest */

jest.mock('react-native-keychain', () => ({
  __esModule: true,
  ACCESSIBLE: {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
      'AccessibleAfterFirstUnlockThisDeviceOnly',
  },
  STORAGE_TYPE: {
    AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth',
  },
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  getAllGenericPasswordServices: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

import * as Keychain from 'react-native-keychain';

import {
  type DailyLogOfflineMutation,
  type DeleteDailyLogOfflineMutation,
  type DeletePairEventOfflineMutation,
  type PrivateSetupOfflineMutation,
  type ShareSettingsOfflineMutation,
  type UpsertPairEventOfflineMutation,
  OFFLINE_MUTATION_QUEUE_LIMIT,
  secureOfflineMutationQueue,
} from './SecureOfflineMutationQueue';
import { SENSITIVE_HEALTH_CONSENT_VERSION } from '../../domain/privacy/SensitiveHealthConsent';

interface MockCredential {
  readonly username: string;
  readonly password: string;
}

const setGenericPasswordMock =
  Keychain.setGenericPassword as jest.MockedFunction<
    typeof Keychain.setGenericPassword
  >;
const getGenericPasswordMock =
  Keychain.getGenericPassword as jest.MockedFunction<
    typeof Keychain.getGenericPassword
  >;
const getAllServicesMock =
  Keychain.getAllGenericPasswordServices as jest.MockedFunction<
    typeof Keychain.getAllGenericPasswordServices
  >;
const resetGenericPasswordMock =
  Keychain.resetGenericPassword as jest.MockedFunction<
    typeof Keychain.resetGenericPassword
  >;

let storedCredentials: Map<string, MockCredential>;

function dailyMutation(
  overrides: Partial<DailyLogOfflineMutation> = {},
): DailyLogOfflineMutation {
  return {
    schemaVersion: 1,
    type: 'daily-log',
    uid: 'user-a',
    mutationId: 'daily-2026-07-14',
    createdAt: '2026-07-14T01:00:00.000Z',
    localDate: '2026-07-14',
    record: {
      moodTag: 'neutral',
      symptomTags: ['cramps'],
      energyLevel: 3,
      carePreferences: ['quiet-space'],
      note: '민감한 기록',
    },
    ...overrides,
  };
}

function deleteDailyLogMutation(
  overrides: Partial<DeleteDailyLogOfflineMutation> = {},
): DeleteDailyLogOfflineMutation {
  return {
    schemaVersion: 1,
    type: 'delete-daily-log',
    uid: 'user-a',
    mutationId: 'daily-delete-2026-07-14',
    createdAt: '2026-07-14T01:01:00.000Z',
    localDate: '2026-07-14',
    ...overrides,
  };
}

function setupMutation(
  overrides: Partial<PrivateSetupOfflineMutation> = {},
): PrivateSetupOfflineMutation {
  return {
    schemaVersion: 1,
    type: 'private-setup',
    uid: 'user-a',
    mutationId: 'private-setup-current',
    createdAt: '2026-07-14T00:30:00.000Z',
    setup: {
      recordsCycle: true,
      consentAcceptedAt: '2026-07-14T00:00:00.000Z',
      consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      cycle: {
        asOfDate: '2026-07-14',
        averageCycleLength: 28,
        averagePeriodLength: 5,
        periodDates: { startDate: '2026-07-01' },
        cyclePhase: 'follicular',
        nextPeriodWindow: {
          startDate: '2026-07-22',
          endDate: '2026-08-05',
        },
      },
    },
    ...overrides,
  };
}

function upsertPairEventMutation(
  overrides: Partial<UpsertPairEventOfflineMutation> = {},
): UpsertPairEventOfflineMutation {
  return {
    schemaVersion: 1,
    type: 'upsert-pair-event',
    uid: 'user-a',
    mutationId: 'event-upsert-1',
    createdAt: '2026-07-14T02:00:00.000Z',
    pairId: 'pair-a',
    event: {
      id: 'event-1',
      title: '병원 일정',
      date: '2026-07-20',
      startTime: '10:00',
    },
    ...overrides,
  };
}

function shareSettingsMutation(
  overrides: Partial<ShareSettingsOfflineMutation> = {},
): ShareSettingsOfflineMutation {
  return {
    schemaVersion: 1,
    type: 'share-settings',
    uid: 'user-a',
    mutationId: 'share-settings-current',
    createdAt: '2026-07-14T01:30:00.000Z',
    pairId: 'pair-a',
    settings: {
      cyclePhase: false,
      nextPeriodWindow: false,
      periodDates: false,
      moodTag: true,
      symptomTags: false,
      energyLevel: false,
      conditionCode: true,
      carePreferences: true,
      note: false,
    },
    ...overrides,
  };
}

function deletePairEventMutation(
  overrides: Partial<DeletePairEventOfflineMutation> = {},
): DeletePairEventOfflineMutation {
  return {
    schemaVersion: 1,
    type: 'delete-pair-event',
    uid: 'user-a',
    mutationId: 'event-delete-1',
    createdAt: '2026-07-14T03:00:00.000Z',
    pairId: 'pair-a',
    eventId: 'event-1',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  storedCredentials = new Map();

  setGenericPasswordMock.mockImplementation(
    async (username, password, options) => {
      const service = options?.service ?? 'default';
      storedCredentials.set(service, { username, password });
      return {
        service,
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
      };
    },
  );
  getGenericPasswordMock.mockImplementation(async options => {
    const service = options?.service ?? 'default';
    const credential = storedCredentials.get(service);
    return credential
      ? {
          service,
          storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
          ...credential,
        }
      : false;
  });
  getAllServicesMock.mockImplementation(async () => [
    ...storedCredentials.keys(),
  ]);
  resetGenericPasswordMock.mockImplementation(async options => {
    const service = options?.service ?? 'default';
    return storedCredentials.delete(service);
  });
});

describe('secureOfflineMutationQueue', () => {
  it('무버전 setup은 보존하고 같은 ID의 재동의 setup으로 교체한다', async () => {
    const legacy = setupMutation({
      setup: {
        recordsCycle: false,
        consentAcceptedAt: '2026-07-14T00:00:00.000Z',
      },
    });
    await secureOfflineMutationQueue.enqueue(legacy);

    await expect(secureOfflineMutationQueue.list(legacy.uid)).resolves.toEqual([
      legacy,
    ]);

    const current = setupMutation({
      setup: {
        recordsCycle: false,
        consentAcceptedAt: '2026-08-09T00:00:00.000Z',
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      },
    });
    await secureOfflineMutationQueue.enqueue(current);

    await expect(secureOfflineMutationQueue.list(current.uid)).resolves.toEqual([
      current,
    ]);
  });

  it('민감 mutation을 기기 한정 Keychain/Keystore 옵션으로 저장한다', async () => {
    const mutation = dailyMutation();

    await secureOfflineMutationQueue.enqueue(mutation);

    expect(setGenericPasswordMock).toHaveBeenCalledWith(
      mutation.uid,
      expect.stringContaining('"queueSequence":1'),
      expect.objectContaining({
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        cloudSync: false,
      }),
    );
    await expect(
      secureOfflineMutationQueue.list(mutation.uid),
    ).resolves.toEqual([mutation]);
    const service = setGenericPasswordMock.mock.calls[0]?.[2]?.service ?? '';
    expect(service).not.toContain(mutation.uid);
    expect(service).not.toContain(mutation.mutationId);
  });

  it('기존 raw service mutation을 보존하고 다음 enqueue에서 opaque service로 전환한다', async () => {
    const mutation = dailyMutation({mutationId: 'legacy-daily-write'});
    const legacyService =
      'com.seorilabs.cyclepair.offline.v1.user-a::legacy-daily-write';
    storedCredentials.set(legacyService, {
      username: mutation.uid,
      password: JSON.stringify({...mutation, queueSequence: 1}),
    });

    await expect(secureOfflineMutationQueue.list(mutation.uid)).resolves.toEqual(
      [mutation],
    );
    await secureOfflineMutationQueue.enqueue(mutation);

    expect(storedCredentials.has(legacyService)).toBe(false);
    expect(
      [...storedCredentials.keys()].every(
        service =>
          !service.includes(mutation.uid) &&
          !service.includes(mutation.mutationId),
      ),
    ).toBe(true);
  });

  it('같은 uid와 mutationId를 다시 넣으면 하나의 service를 덮어쓴다', async () => {
    const first = dailyMutation();
    const latest = dailyMutation({
      record: { moodTag: 'good', energyLevel: 5 },
    });

    await secureOfflineMutationQueue.enqueue(first);
    await secureOfflineMutationQueue.enqueue(latest);

    await expect(secureOfflineMutationQueue.count(first.uid)).resolves.toBe(1);
    await expect(secureOfflineMutationQueue.list(first.uid)).resolves.toEqual([
      latest,
    ]);
  });

  it('실패한 Pair mutation은 암호화된 격리 상태로 보존하고 자동 재생에서 제외한다', async () => {
    const mutation = upsertPairEventMutation({
      pairId: 'pair-quarantine',
      mutationId: 'pair-quarantine-write',
    });
    await secureOfflineMutationQueue.enqueue(mutation);

    await secureOfflineMutationQueue.quarantine(
      mutation.uid,
      mutation.mutationId,
      'failed-precondition',
    );

    await expect(secureOfflineMutationQueue.list(mutation.uid)).resolves.toEqual(
      [],
    );
    // 이름이 말하던 "자동 재생에서 제외" 를 실제로 단언한다. 예전에는 격리
    // 항목이 재생 목록에 남아 매 동기화마다 같은 실패를 되풀이했다.
    await expect(
      secureOfflineMutationQueue.listForReplay(mutation.uid),
    ).resolves.toEqual([]);
    await expect(secureOfflineMutationQueue.count(mutation.uid)).resolves.toBe(
      1,
    );
    await expect(
      secureOfflineMutationQueue.countFailed(mutation.uid),
    ).resolves.toBe(1);
    const stored = JSON.parse(
      [...storedCredentials.values()][0].password,
    ) as Record<string, unknown>;
    expect(stored).toMatchObject({
      queueState: 'failed',
      failureCode: 'failed-precondition',
    });
    expect(stored.failedAt).toEqual(expect.any(String));
  });

  it('같은 mutationId를 다시 저장하면 격리를 해제하고 Pair 정리 시 실패 항목도 제거한다', async () => {
    const first = upsertPairEventMutation({
      pairId: 'pair-quarantine-retry',
      mutationId: 'pair-quarantine-retry-write',
    });
    await secureOfflineMutationQueue.enqueue(first);
    await secureOfflineMutationQueue.quarantine(
      first.uid,
      first.mutationId,
      'permission-denied',
    );

    const retry = upsertPairEventMutation({
      pairId: first.pairId,
      mutationId: first.mutationId,
      event: {...first.event, title: '수정된 일정'},
    });
    await secureOfflineMutationQueue.enqueue(retry);
    await expect(secureOfflineMutationQueue.list(first.uid)).resolves.toEqual([
      retry,
    ]);
    await expect(
      secureOfflineMutationQueue.countFailed(first.uid),
    ).resolves.toBe(0);

    await secureOfflineMutationQueue.quarantine(
      first.uid,
      first.mutationId,
      'not-found',
    );
    await secureOfflineMutationQueue.clearPair(first.uid, first.pairId);
    await expect(secureOfflineMutationQueue.count(first.uid)).resolves.toBe(0);
  });

  it('개인 건강 기록도 격리해 자동 재생에서 뺀다', async () => {
    const mutation = dailyMutation({mutationId: 'private-quarantine'});
    await secureOfflineMutationQueue.enqueue(mutation);

    await secureOfflineMutationQueue.quarantine(
      mutation.uid,
      mutation.mutationId,
      'invalid-argument',
    );

    await expect(secureOfflineMutationQueue.list(mutation.uid)).resolves.toEqual(
      [],
    );
    await expect(
      secureOfflineMutationQueue.listForReplay(mutation.uid),
    ).resolves.toEqual([]);
    // 진단 이력은 남는다. 조용히 지우지 않는다.
    await expect(
      secureOfflineMutationQueue.countFailed(mutation.uid),
    ).resolves.toBe(1);
    const stored = JSON.parse(
      [...storedCredentials.values()][0].password,
    ) as Record<string, unknown>;
    expect(stored).toMatchObject({
      queueState: 'failed',
      failureCode: 'invalid-argument',
    });
    expect(stored.failedAt).toEqual(expect.any(String));
  });

  it('사용자별로 격리하고 clearUser는 해당 사용자의 항목만 지운다', async () => {
    const userA = dailyMutation();
    const userB = dailyMutation({ uid: 'user-b' });
    await secureOfflineMutationQueue.enqueue(userA);
    await secureOfflineMutationQueue.enqueue(userB);

    await secureOfflineMutationQueue.clearUser('user-a');

    await expect(secureOfflineMutationQueue.list('user-a')).resolves.toEqual(
      [],
    );
    await expect(secureOfflineMutationQueue.list('user-b')).resolves.toEqual([
      userB,
    ]);
  });

  it('remove는 uid와 mutationId가 모두 일치하는 항목만 지운다', async () => {
    const userA = dailyMutation();
    const userB = dailyMutation({ uid: 'user-b' });
    await secureOfflineMutationQueue.enqueue(userA);
    await secureOfflineMutationQueue.enqueue(userB);

    await secureOfflineMutationQueue.remove('user-a', userA.mutationId);

    await expect(secureOfflineMutationQueue.list('user-a')).resolves.toEqual(
      [],
    );
    await expect(secureOfflineMutationQueue.list('user-b')).resolves.toEqual([
      userB,
    ]);
  });

  it('clearPair는 그 Pair의 공유·event mutation만 지우고 개인 기록과 다른 Pair는 보존한다', async () => {
    const setup = setupMutation();
    const daily = dailyMutation();
    const pairASharing = shareSettingsMutation({ pairId: 'pair-clear' });
    const pairAUpsert = upsertPairEventMutation({ pairId: 'pair-clear' });
    const pairADelete = deletePairEventMutation({ pairId: 'pair-clear' });
    const pairBUpsert = upsertPairEventMutation({
      mutationId: 'event-upsert-2',
      pairId: 'pair-b',
      event: { id: 'event-2', title: '다른 일정', date: '2026-07-21' },
    });

    await Promise.all(
      [setup, daily, pairASharing, pairAUpsert, pairADelete, pairBUpsert].map(
        mutation => secureOfflineMutationQueue.enqueue(mutation),
      ),
    );
    await expect(
      secureOfflineMutationQueue.listPairIds('user-a'),
    ).resolves.toEqual(['pair-b', 'pair-clear']);
    await secureOfflineMutationQueue.clearPair('user-a', 'pair-clear');

    await expect(secureOfflineMutationQueue.list('user-a')).resolves.toEqual([
      setup,
      daily,
      pairBUpsert,
    ]);
    await expect(
      secureOfflineMutationQueue.listPairIds('user-a'),
    ).resolves.toEqual(['pair-b']);
    await expect(
      secureOfflineMutationQueue.enqueue(
        upsertPairEventMutation({ pairId: 'pair-clear' }),
      ),
    ).rejects.toThrow('Pair data is revoked.');
  });

  it('clearPair는 진행 중인 Pair enqueue를 drain한 뒤 제거하고 재생성을 차단한다', async () => {
    const mutation = upsertPairEventMutation({
      pairId: 'pair-race',
      mutationId: 'pair-race-write',
    });
    let releaseWrite: (() => void) | undefined;
    setGenericPasswordMock.mockImplementationOnce(
      (username, password, options) =>
        new Promise(resolve => {
          releaseWrite = () => {
            const service = options?.service ?? 'default';
            storedCredentials.set(service, { username, password });
            resolve({
              service,
              storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
            });
          };
        }),
    );

    const enqueue = secureOfflineMutationQueue.enqueue(mutation);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(setGenericPasswordMock).toHaveBeenCalledTimes(1);

    const clear = secureOfflineMutationQueue.clearPair(
      'user-a',
      'pair-race',
    );
    let cleared = false;
    clear.then(() => {
      cleared = true;
    });
    await Promise.resolve();
    expect(cleared).toBe(false);

    releaseWrite?.();
    await enqueue;
    await clear;
    await expect(secureOfflineMutationQueue.list('user-a')).resolves.toEqual(
      [],
    );
    await expect(secureOfflineMutationQueue.enqueue(mutation)).rejects.toThrow(
      'Pair data is revoked.',
    );
  });

  it('clearPair는 Keychain read 실패 시 삭제 성공으로 처리하지 않는다', async () => {
    const mutation = upsertPairEventMutation({
      pairId: 'pair-strict-read',
      mutationId: 'pair-strict-read-mutation',
    });
    await secureOfflineMutationQueue.enqueue(mutation);
    getGenericPasswordMock.mockRejectedValueOnce(
      new Error('Keychain temporarily unavailable'),
    );

    await expect(
      secureOfflineMutationQueue.clearPair('user-a', 'pair-strict-read'),
    ).rejects.toThrow('Keychain temporarily unavailable');
    expect(storedCredentials).toHaveProperty('size', 1);

    await expect(
      secureOfflineMutationQueue.clearPair('user-a', 'pair-strict-read'),
    ).resolves.toBeUndefined();
    expect(storedCredentials).toHaveProperty('size', 0);
  });

  it('count는 Keychain read 실패를 빈 큐로 오인하지 않는다', async () => {
    const mutation = dailyMutation({mutationId: 'strict-count-write'});
    await secureOfflineMutationQueue.enqueue(mutation);
    getGenericPasswordMock.mockRejectedValueOnce(
      new Error('Keychain temporarily unavailable'),
    );

    await expect(
      secureOfflineMutationQueue.count(mutation.uid),
    ).rejects.toThrow('Keychain temporarily unavailable');
    await expect(secureOfflineMutationQueue.count(mutation.uid)).resolves.toBe(
      1,
    );
  });

  it('list는 단말 시계가 역행해도 실제 enqueue 순서로 반환한다', async () => {
    const later = upsertPairEventMutation();
    const earlier = dailyMutation();

    await secureOfflineMutationQueue.enqueue(later);
    await secureOfflineMutationQueue.enqueue(earlier);

    await expect(secureOfflineMutationQueue.list('user-a')).resolves.toEqual([
      later,
      earlier,
    ]);
  });

  it('같은 timestamp의 upsert 다음 delete도 실제 enqueue 순서를 보존한다', async () => {
    const createdAt = '2026-07-14T02:00:00.000Z';
    // 서로 다른 이벤트다. 같은 이벤트는 이제 접힌다.
    const upsert = upsertPairEventMutation({
      mutationId: 'z-upsert',
      createdAt,
    });
    const remove = deletePairEventMutation({
      mutationId: 'a-delete',
      createdAt,
      eventId: 'event-2',
    });

    await secureOfflineMutationQueue.enqueue(upsert);
    await secureOfflineMutationQueue.enqueue(remove);

    await expect(secureOfflineMutationQueue.list('user-a')).resolves.toEqual([
      upsert,
      remove,
    ]);
  });

  it('오프라인 일일 기록 저장 다음 삭제 순서를 보존한다', async () => {
    // 서로 다른 날짜다. 같은 날짜는 접히므로 순서 보존은 다른 대상 사이에서
    // 확인해야 한다.
    const createdAt = '2026-07-14T02:00:00.000Z';
    const save = dailyMutation({mutationId: 'z-save', createdAt});
    const remove = deleteDailyLogMutation({
      mutationId: 'a-delete',
      createdAt,
      localDate: '2026-07-15',
    });

    await secureOfflineMutationQueue.enqueue(save);
    await secureOfflineMutationQueue.enqueue(remove);

    await expect(secureOfflineMutationQueue.list('user-a')).resolves.toEqual([
      save,
      remove,
    ]);
  });

  it('손상되거나 소유자가 맞지 않는 항목은 반환하지 않고 제거한다', async () => {
    const malformedJson = dailyMutation({ mutationId: 'malformed-json' });
    const wrongOwner = dailyMutation({
      mutationId: 'wrong-owner',
      localDate: '2026-07-15',
    });
    await secureOfflineMutationQueue.enqueue(malformedJson);
    await secureOfflineMutationQueue.enqueue(wrongOwner);

    const [malformedService, wrongOwnerService] = [...storedCredentials.keys()];
    storedCredentials.set(malformedService, {
      username: malformedJson.uid,
      password: '{not-json',
    });
    storedCredentials.set(wrongOwnerService, {
      username: 'different-user',
      password: JSON.stringify(wrongOwner),
    });

    await expect(secureOfflineMutationQueue.list('user-a')).resolves.toEqual(
      [],
    );
    expect(resetGenericPasswordMock).toHaveBeenCalledWith({
      service: malformedService,
    });
    expect(resetGenericPasswordMock).toHaveBeenCalledWith({
      service: wrongOwnerService,
    });
    expect(storedCredentials).toHaveProperty('size', 0);
  });

  it('잘못된 mutation은 저장하지 않고 Keychain 저장 실패도 호출자에게 알린다', async () => {
    const invalid = { ...dailyMutation(), createdAt: 'invalid-date' };
    await expect(
      secureOfflineMutationQueue.enqueue(invalid as DailyLogOfflineMutation),
    ).rejects.toThrow('Invalid offline mutation.');
    expect(setGenericPasswordMock).not.toHaveBeenCalled();

    setGenericPasswordMock.mockResolvedValueOnce(false);
    await expect(
      secureOfflineMutationQueue.enqueue(dailyMutation()),
    ).rejects.toThrow('Unable to persist offline mutation in secure storage.');

    await expect(
      secureOfflineMutationQueue.enqueue(
        dailyMutation({ createdAt: '2026-02-30T00:00:00.000Z' }),
      ),
    ).rejects.toThrow('Invalid offline mutation.');
  });

  it('일일 기록과 공동 일정에는 실재하는 Gregorian LocalDate만 허용한다', async () => {
    await expect(
      secureOfflineMutationQueue.enqueue(
        dailyMutation({ localDate: '2026-02-30' }),
      ),
    ).rejects.toThrow('Invalid offline mutation.');
    await expect(
      secureOfflineMutationQueue.enqueue(
        upsertPairEventMutation({
          event: {
            id: 'event-invalid',
            title: '잘못된 날짜',
            date: '2026-13-01',
          },
        }),
      ),
    ).rejects.toThrow('Invalid offline mutation.');
    expect(setGenericPasswordMock).not.toHaveBeenCalled();

    await expect(
      secureOfflineMutationQueue.enqueue(
        dailyMutation({
          mutationId: 'daily-leap-day',
          localDate: '2024-02-29',
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      secureOfflineMutationQueue.enqueue(
        dailyMutation({
          mutationId: 'daily-future',
          localDate: '9999-12-31',
        }),
      ),
    ).rejects.toThrow('Invalid offline mutation.');
  });

  it('서버 Rules를 통과할 수 없는 민감 기록과 일정은 큐에 넣지 않는다', async () => {
    await expect(
      secureOfflineMutationQueue.enqueue(
        dailyMutation({
          record: { periodStarted: true, periodEnded: true },
        }),
      ),
    ).rejects.toThrow('Invalid offline mutation.');
    await expect(
      secureOfflineMutationQueue.enqueue(
        dailyMutation({ record: { moodTag: 'free-form-health-text' } }),
      ),
    ).rejects.toThrow('Invalid offline mutation.');
    await expect(
      secureOfflineMutationQueue.enqueue(
        upsertPairEventMutation({
          event: {
            id: 'event-invalid-time',
            title: '잘못된 시간',
            date: '2026-07-20',
            startTime: '25:00',
          },
        }),
      ),
    ).rejects.toThrow('Invalid offline mutation.');
    expect(setGenericPasswordMock).not.toHaveBeenCalled();
  });

  it('최초 주기 설정도 검증해 암호화 큐에 보존하고 최신 값으로 합친다', async () => {
    const first = setupMutation();
    const latest = setupMutation({
      createdAt: '2026-07-14T04:00:00.000Z',
      setup: {
        recordsCycle: false,
        consentAcceptedAt: '2026-07-14T03:59:00.000Z',
      },
    });

    await secureOfflineMutationQueue.enqueue(first);
    await secureOfflineMutationQueue.enqueue(latest);

    await expect(secureOfflineMutationQueue.list('user-a')).resolves.toEqual([
      latest,
    ]);
    await expect(
      secureOfflineMutationQueue.enqueue(
        setupMutation({
          setup: {
            recordsCycle: true,
            consentAcceptedAt: '2026-07-14T00:00:00.000Z',
            cycle: {
              asOfDate: '2026-07-14',
              averageCycleLength: 28,
              averagePeriodLength: 5,
              periodDates: { startDate: '2026-02-30' },
            },
          },
        }),
      ),
    ).rejects.toThrow('Invalid offline mutation.');

    await expect(
      secureOfflineMutationQueue.enqueue(
        setupMutation({
          setup: {
            recordsCycle: true,
            consentAcceptedAt: '2026-07-14T00:00:00.000Z',
          },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('공유 설정을 완전한 boolean schema로 검증하고 최신 값으로 합친다', async () => {
    const first = shareSettingsMutation();
    const latest = shareSettingsMutation({
      createdAt: '2026-07-14T05:00:00.000Z',
      settings: { ...first.settings, moodTag: false, note: true },
    });

    await secureOfflineMutationQueue.enqueue(first);
    await secureOfflineMutationQueue.enqueue(latest);

    await expect(secureOfflineMutationQueue.list('user-a')).resolves.toEqual([
      latest,
    ]);
    await expect(
      secureOfflineMutationQueue.enqueue({
        ...first,
        settings: { moodTag: true },
      } as ShareSettingsOfflineMutation),
    ).rejects.toThrow('Invalid offline mutation.');
  });
});

describe('같은 대상을 가리키는 변경을 접는다', () => {
  const uid = 'user-a';

  it('같은 날짜를 N번 저장해도 항목은 1건이고 내용은 마지막 값이다', async () => {
    for (let index = 0; index < 5; index += 1) {
      await secureOfflineMutationQueue.enqueue(
        dailyMutation({
          mutationId: `daily-${index}`,
          record: {moodTag: 'neutral', energyLevel: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5},
        }),
      );
    }

    const queued = await secureOfflineMutationQueue.list(uid);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      mutationId: 'daily-4',
      record: {energyLevel: 5},
    });
    // 고아 Keychain 항목이 남지 않는다.
    expect(storedCredentials.size).toBe(1);
  });

  it('저장 다음 삭제는 삭제만, 삭제 다음 저장은 저장만 남는다', async () => {
    await secureOfflineMutationQueue.enqueue(
      dailyMutation({mutationId: 'save-first'}),
    );
    await secureOfflineMutationQueue.enqueue(
      deleteDailyLogMutation({mutationId: 'delete-second'}),
    );

    let queued = await secureOfflineMutationQueue.list(uid);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'delete-daily-log',
      mutationId: 'delete-second',
    });

    await secureOfflineMutationQueue.enqueue(
      dailyMutation({mutationId: 'save-third'}),
    );
    queued = await secureOfflineMutationQueue.list(uid);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'daily-log',
      mutationId: 'save-third',
    });
  });

  it('접힌 항목의 순번이 유지돼 다른 대상과의 재생 순서가 바뀌지 않는다', async () => {
    await secureOfflineMutationQueue.enqueue(
      dailyMutation({mutationId: 'first-date', localDate: '2026-07-14'}),
    );
    await secureOfflineMutationQueue.enqueue(
      dailyMutation({mutationId: 'second-date', localDate: '2026-07-15'}),
    );
    // 첫 번째 날짜를 다시 저장한다. 순번이 새로 매겨지면 뒤로 밀린다.
    await secureOfflineMutationQueue.enqueue(
      dailyMutation({mutationId: 'first-date-again', localDate: '2026-07-14'}),
    );

    const queued = await secureOfflineMutationQueue.list(uid);
    expect(queued.map(mutation => mutation.mutationId)).toEqual([
      'first-date-again',
      'second-date',
    ]);
  });

  it('share-settings 는 pairId 단위로, 페어 이벤트는 (pairId, eventId) 단위로 접힌다', async () => {
    await secureOfflineMutationQueue.enqueue(
      shareSettingsMutation({mutationId: 'share-1'}),
    );
    await secureOfflineMutationQueue.enqueue(
      shareSettingsMutation({mutationId: 'share-2'}),
    );
    await secureOfflineMutationQueue.enqueue(
      upsertPairEventMutation({mutationId: 'event-1'}),
    );
    await secureOfflineMutationQueue.enqueue(
      upsertPairEventMutation({mutationId: 'event-2'}),
    );
    await secureOfflineMutationQueue.enqueue(
      upsertPairEventMutation({
        mutationId: 'other-event',
        event: {id: 'event-9', title: '다른 일정', date: '2026-07-21'},
      }),
    );

    const queued = await secureOfflineMutationQueue.list(uid);
    expect(queued.map(mutation => mutation.mutationId)).toEqual([
      'share-2',
      'event-2',
      'other-event',
    ]);
  });

  it('격리된 항목은 접기 대상이 아니다', async () => {
    const failed = dailyMutation({mutationId: 'quarantined-daily'});
    await secureOfflineMutationQueue.enqueue(failed);
    await secureOfflineMutationQueue.quarantine(
      uid,
      failed.mutationId,
      'invalid-argument',
    );

    await secureOfflineMutationQueue.enqueue(
      dailyMutation({mutationId: 'fresh-daily'}),
    );

    // 격리 항목은 진단 이력이므로 남고, 새 항목은 접히지 않고 따로 들어간다.
    await expect(secureOfflineMutationQueue.countFailed(uid)).resolves.toBe(1);
    const replayable = await secureOfflineMutationQueue.listForReplay(uid);
    expect(replayable.map(mutation => mutation.mutationId)).toEqual([
      'fresh-daily',
    ]);
  });

  it('상한을 넘으면 가장 오래된 미격리 항목부터 버리고 그 수를 알린다', async () => {
    const overflow = 3;
    for (let index = 0; index < OFFLINE_MUTATION_QUEUE_LIMIT + overflow; index += 1) {
      await secureOfflineMutationQueue.enqueue(
        dailyMutation({
          mutationId: `daily-${index}`,
          localDate: localDateForIndex(index),
        }),
      );
    }

    const queued = await secureOfflineMutationQueue.list(uid);
    expect(queued).toHaveLength(OFFLINE_MUTATION_QUEUE_LIMIT);
    // 가장 오래된 것부터 버린다.
    expect(queued[0]).toMatchObject({mutationId: `daily-${overflow}`});
    expect(secureOfflineMutationQueue.takeDiscardedCount(uid)).toBe(overflow);
    // 한 번 보고하면 0 으로 돌아간다.
    expect(secureOfflineMutationQueue.takeDiscardedCount(uid)).toBe(0);
  });
});

function localDateForIndex(index: number): string {
  const base = Date.parse('2026-01-01T12:00:00.000Z');
  return new Date(base + index * 86_400_000).toISOString().slice(0, 10);
}
