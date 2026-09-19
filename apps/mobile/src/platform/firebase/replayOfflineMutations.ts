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
  let firstFailureCode: string | undefined;

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
      const currentFailureCode = failureCode(error);
      firstFailureCode ??= currentFailureCode;
      // 여기 온 실패는 이미 재시도 불가로 판정됐다. 개인 기록과 페어 기록을
      // 가리지 않고 격리한다. 상한을 두고 N회 더 시도하는 선택지도 있지만,
      // 같은 요청을 다시 보내도 결과가 같으므로 시도 횟수만 늘어난다.
      // 격리는 즉시 한 번이고, 그 뒤 항목은 재생 대상에서 빠진다.
      await queue.quarantine(uid, mutation.mutationId, currentFailureCode);
      // 하나가 격리됐다고 뒤 기록까지 굶기지 않는다. 다음 항목으로 넘어간다.
    }
  }

  return {
    flushed,
    remaining: await queue.count(uid),
    // countFailed 가 격리된 항목 전부를 세므로 별도 누적과 더하지 않는다.
    // 예전에는 개인 기록 실패가 두 번 계산돼 경고가 과장됐다.
    failed: await queue.countFailed(uid),
    ...(firstFailureCode ? {failureCode: firstFailureCode} : {}),
  };
}
