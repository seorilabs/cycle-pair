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
