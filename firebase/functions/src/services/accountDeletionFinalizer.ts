export interface AccountDeletionFinalizationOperations {
  readonly deleteRemainingData: () => Promise<void>;
  readonly deleteAuthUser: () => Promise<void>;
  readonly completeDeletionState: () => Promise<void>;
}

/**
 * Keep the deletion-state barrier permanently, and only mark it completed
 * after Firebase Auth deletion succeeds.
 *
 * If Auth has a transient failure, the still-authenticated owner can retry and
 * every mutation remains blocked by accountDeletionStates. After Auth deletion,
 * a previously issued ID token can remain cryptographically valid for a short
 * period, so removing the barrier would allow deleted data to be recreated.
 */
export async function finalizeAccountDeletion(
  operations: AccountDeletionFinalizationOperations,
): Promise<void> {
  await operations.deleteRemainingData();
  await operations.deleteAuthUser();
  await operations.completeDeletionState();
}

export interface AccountDeletionFinalizationReport {
  readonly completed: number;
  readonly busy: number;
  readonly failed: number;
  /** 실패 원인 코드. 중복을 접고 정렬해 로그 한 줄로 읽히게 한다. */
  readonly failureCodes: readonly string[];
}

/**
 * Turn settled finalization results into a loggable report.
 *
 * Counting failures without recording why leaves a scheduled retry loop that
 * can fail indefinitely with no evidence of the cause. Only the error code is
 * kept: uid, receipt, and Pair values never enter the log.
 */
export function summarizeAccountDeletionFinalizations(
  results: readonly PromiseSettledResult<string | null>[],
  errorCode: (reason: unknown) => string,
): AccountDeletionFinalizationReport {
  const failureCodes = new Set<string>();
  const counts = results.reduce(
    (totals, result) => {
      if (result.status === "rejected") {
        failureCodes.add(errorCode(result.reason));
        return {...totals, failed: totals.failed + 1};
      }
      return result.value === null
        ? {...totals, busy: totals.busy + 1}
        : {...totals, completed: totals.completed + 1};
    },
    {completed: 0, busy: 0, failed: 0},
  );
  return {...counts, failureCodes: [...failureCodes].sort()};
}

/** 실패 코드를 throw 메시지에 실어 ERROR 로그 한 줄만 봐도 원인이 남게 한다. */
export function accountDeletionFinalizationFailureMessage(
  report: AccountDeletionFinalizationReport,
): string {
  return `One or more pending account deletions could not be finalized: ${
    report.failureCodes.join(", ")
  }`;
}
