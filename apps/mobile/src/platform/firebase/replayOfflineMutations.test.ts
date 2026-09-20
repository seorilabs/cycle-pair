import type {OfflineMutation} from '../local/SecureOfflineMutationQueue';
import {secureOfflineMutationQueue} from '../local/SecureOfflineMutationQueue';
import {replayOfflineMutations} from './replayOfflineMutations';

function privateMutation(mutationId: string): OfflineMutation {
  return {
    schemaVersion: 1,
    type: 'daily-log',
    uid: 'user-a',
    mutationId,
    createdAt: '2026-07-14T00:00:00.000Z',
    localDate: '2026-07-14',
    record: {emotionTags: ['anxious']},
  };
}

function pairMutation(mutationId: string): OfflineMutation {
  return {
    schemaVersion: 1,
    type: 'delete-pair-event',
    uid: 'user-a',
    mutationId,
    createdAt: '2026-07-14T00:00:00.000Z',
    pairId: 'pair-a',
    eventId: 'event-a',
  };
}

function dependencies(mutations: readonly OfflineMutation[]) {
  const remaining = new Set(mutations.map(mutation => mutation.mutationId));
  const quarantined = new Set<string>();
  return {
    remaining,
    quarantined,
    queue: {
      remove: jest.fn(async (_uid: string, mutationId: string) => {
        remaining.delete(mutationId);
        quarantined.delete(mutationId);
      }),
      quarantine: jest.fn(
        async (_uid: string, mutationId: string, _failureCode: string) => {
          quarantined.add(mutationId);
        },
      ),
      count: jest.fn(async () => remaining.size),
      countFailed: jest.fn(async () => quarantined.size),
      takeDiscardedCount: jest.fn(() => 0),
    },
  };
}

describe('replayOfflineMutations', () => {
  it('개인 mutation 하나가 실패해도 뒤의 개인 기록을 계속 동기화한다', async () => {
    const failed = privateMutation('private-failed');
    const synced = privateMutation('private-synced');
    const input = dependencies([failed, synced]);
    const execute = jest.fn(async (mutation: OfflineMutation) => {
      if (mutation.mutationId === failed.mutationId) {
        throw {code: 'firestore/invalid-argument'};
      }
    });

    await expect(
      replayOfflineMutations({
        uid: 'user-a',
        mutations: [failed, synced],
        queue: input.queue,
        execute,
        isPairInvalidated: () => false,
        isRetryable: () => false,
        failureCode: () => 'invalid-argument',
      }),
    ).resolves.toEqual({
      flushed: 1,
      remaining: 1,
      failed: 1,
      failureCode: 'invalid-argument',
    });
    // 하나가 격리돼도 뒤 기록은 계속 동기화된다.
    expect(execute).toHaveBeenCalledTimes(2);
    // 개인 기록도 종결 상태로 옮긴다. 예전에는 큐에 그대로 남았다.
    expect(input.queue.quarantine).toHaveBeenCalledTimes(1);
    expect(input.queue.quarantine).toHaveBeenCalledWith(
      'user-a',
      failed.mutationId,
      'invalid-argument',
    );
    expect(input.remaining).toEqual(new Set([failed.mutationId]));
  });

  it('재시도 불가 Pair mutation을 격리하고 다음 기록을 처리한다', async () => {
    const failed = pairMutation('pair-failed');
    const synced = privateMutation('private-synced-after-pair');
    const input = dependencies([failed, synced]);
    const execute = jest.fn(async (mutation: OfflineMutation) => {
      if (mutation.mutationId === failed.mutationId) {
        throw {code: 'functions/not-found'};
      }
    });

    await expect(
      replayOfflineMutations({
        uid: 'user-a',
        mutations: [failed, synced],
        queue: input.queue,
        execute,
        isPairInvalidated: () => false,
        isRetryable: () => false,
        failureCode: () => 'not-found',
      }),
    ).resolves.toEqual({
      flushed: 1,
      remaining: 1,
      failed: 1,
      failureCode: 'not-found',
    });
    expect(input.queue.quarantine).toHaveBeenCalledWith(
      'user-a',
      failed.mutationId,
      'not-found',
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('재시도 가능한 네트워크 오류에서는 순서를 보존하기 위해 중단한다', async () => {
    const first = privateMutation('network-failed');
    const later = privateMutation('must-wait');
    const input = dependencies([first, later]);
    const execute = jest.fn(async () => {
      throw {code: 'firestore/unavailable'};
    });

    await expect(
      replayOfflineMutations({
        uid: 'user-a',
        mutations: [first, later],
        queue: input.queue,
        execute,
        isPairInvalidated: () => false,
        isRetryable: () => true,
        failureCode: () => 'non-retryable',
      }),
    ).resolves.toEqual({flushed: 0, remaining: 2, failed: 0});
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('영구 실패한 개인 기록이 큐에서 나간다', () => {
  const uid = 'user-a';

  // Keychain mock 은 파일 안에서 상태를 공유한다. 앞 테스트가 남긴 격리
  // 항목이 countFailed 에 섞이지 않게 비운다.
  beforeEach(async () => {
    await secureOfflineMutationQueue.clearUser(uid);
  });

  async function replayWith(
    mutations: readonly OfflineMutation[],
    execute: (mutation: OfflineMutation) => Promise<void>,
  ) {
    return replayOfflineMutations({
      uid,
      mutations,
      queue: secureOfflineMutationQueue,
      execute,
      isPairInvalidated: () => false,
      isRetryable: () => false,
      failureCode: () => 'invalid-argument',
    });
  }

  it('첫 동기화에서 격리되고 두 번째 동기화는 다시 시도하지 않는다', async () => {
    const mutation = privateMutation('private-permanent-failure');
    await secureOfflineMutationQueue.enqueue(mutation);

    const execute = jest.fn(async () => {
      throw {code: 'firestore/invalid-argument'};
    });

    const first = await replayWith(
      await secureOfflineMutationQueue.listForReplay(uid),
      execute,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(first.failed).toBe(1);

    // 두 번째 동기화. 격리된 항목은 재생 목록에 없다.
    const replayable = await secureOfflineMutationQueue.listForReplay(uid);
    expect(replayable).toEqual([]);

    const second = await replayWith(replayable, execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(second.failed).toBe(1);
    expect(second.failed).toBeLessThanOrEqual(1);
  });

  it('report.failed 가 같은 항목을 두 번 세지 않는다', async () => {
    const mutation = privateMutation('private-single-count');
    await secureOfflineMutationQueue.enqueue(mutation);

    const report = await replayWith(
      await secureOfflineMutationQueue.listForReplay(uid),
      async () => {
        throw {code: 'firestore/invalid-argument'};
      },
    );

    expect(report.failed).toBe(1);
    await expect(secureOfflineMutationQueue.countFailed(uid)).resolves.toBe(1);
  });
});

describe('상한 초과로 버린 항목을 동기화 리포트로 알린다', () => {
  it('버린 수를 리포트에 담고 큐에서 비운다', async () => {
    const input = dependencies([]);
    (input.queue.takeDiscardedCount as jest.Mock).mockReturnValue(3);

    const report = await replayOfflineMutations({
      uid: 'user-a',
      mutations: [],
      queue: input.queue,
      execute: jest.fn(),
      isPairInvalidated: () => false,
      isRetryable: () => false,
      failureCode: () => 'invalid-argument',
    });

    expect(report.discarded).toBe(3);
    expect(input.queue.takeDiscardedCount).toHaveBeenCalledWith('user-a');
  });

  it('버린 항목이 없으면 필드를 넣지 않는다', async () => {
    const input = dependencies([]);

    const report = await replayOfflineMutations({
      uid: 'user-a',
      mutations: [],
      queue: input.queue,
      execute: jest.fn(),
      isPairInvalidated: () => false,
      isRetryable: () => false,
      failureCode: () => 'invalid-argument',
    });

    expect(Object.hasOwn(report, 'discarded')).toBe(false);
  });
});
