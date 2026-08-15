import type {OfflineMutation} from '../local/SecureOfflineMutationQueue';
import {replayOfflineMutations} from './replayOfflineMutations';

function privateMutation(mutationId: string): OfflineMutation {
  return {
    schemaVersion: 1,
    type: 'daily-log',
    uid: 'user-a',
    mutationId,
    createdAt: '2026-07-14T00:00:00.000Z',
    localDate: '2026-07-14',
    record: {moodTag: 'neutral'},
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
    expect(execute).toHaveBeenCalledTimes(2);
    expect(input.queue.quarantine).not.toHaveBeenCalled();
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
