import type {OfflineSyncReport} from '../backend/CyclePairBackend';
import {
  pairIdForOfflineMutation,
  type OfflineMutation,
} from '../local/SecureOfflineMutationQueue';

interface OfflineMutationQueuePort {
  remove(uid: string, mutationId: string): Promise<void>;
  quarantine(
    uid: string,
    mutationId: string,
    failureCode: string,
  ): Promise<void>;
  count(uid: string): Promise<number>;
  countFailed(uid: string): Promise<number>;
}

export async function replayOfflineMutations({
  uid,
  mutations,
  queue,
  execute,
  isPairInvalidated,
  isRetryable,
  failureCode,
}: {
  readonly uid: string;
  readonly mutations: readonly OfflineMutation[];
  readonly queue: OfflineMutationQueuePort;
  readonly execute: (mutation: OfflineMutation) => Promise<void>;
  readonly isPairInvalidated: (pairId: string) => boolean;
  readonly isRetryable: (error: unknown) => boolean;
  readonly failureCode: (error: unknown) => string;
}): Promise<OfflineSyncReport> {
  let flushed = 0;
  let currentPrivateFailures = 0;

  for (const mutation of mutations) {
    const pairId = pairIdForOfflineMutation(mutation);
    try {
      if (pairId && isPairInvalidated(pairId)) {
        await queue.remove(uid, mutation.mutationId);
        flushed += 1;
        continue;
      }
      await execute(mutation);
      await queue.remove(uid, mutation.mutationId);
      flushed += 1;
    } catch (error) {
      if (isRetryable(error)) break;
      if (pairId) {
        await queue.quarantine(uid, mutation.mutationId, failureCode(error));
      } else {
        // Private health writes stay active for a future retry. Continue so a
        // single invalid head item cannot starve later personal records.
        currentPrivateFailures += 1;
      }
    }
  }

  return {
    flushed,
    remaining: await queue.count(uid),
    failed: (await queue.countFailed(uid)) + currentPrivateFailures,
  };
}
