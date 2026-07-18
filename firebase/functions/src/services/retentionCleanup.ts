import {
  Firestore,
  QueryDocumentSnapshot,
  Timestamp,
} from "firebase-admin/firestore";

import {
  RETENTION_CLEANUP_QUERY_LIMIT,
  RETENTION_CLEANUP_TRANSACTION_CONCURRENCY,
  acknowledgedCacheTombstoneCutoffMillis,
  expiredPairInviteCutoffMillis,
  shouldDeleteAcknowledgedCacheTombstone,
  shouldDeleteExpiredPairInvite,
} from "../domain/retentionPolicy.js";

export interface RetentionCleanupReport {
  readonly pairInviteCandidates: number;
  readonly cacheTombstoneCandidates: number;
  readonly deletedPairInvites: number;
  readonly deletedCacheTombstones: number;
}

function timestampMillis(value: unknown): number | undefined {
  return value instanceof Timestamp ? value.toMillis() : undefined;
}

async function inBoundedChunks<T>(
  values: readonly T[],
  operation: (value: T) => Promise<boolean>,
): Promise<number> {
  let completed = 0;
  for (
    let index = 0;
    index < values.length;
    index += RETENTION_CLEANUP_TRANSACTION_CONCURRENCY
  ) {
    const results = await Promise.all(
      values
        .slice(index, index + RETENTION_CLEANUP_TRANSACTION_CONCURRENCY)
        .map(operation),
    );
    completed += results.filter(Boolean).length;
  }
  return completed;
}

async function deletePairInviteIfStillEligible(
  db: Firestore,
  candidate: QueryDocumentSnapshot,
  nowMillis: number,
): Promise<boolean> {
  return db.runTransaction(async transaction => {
    const current = await transaction.get(candidate.ref);
    if (
      !current.exists ||
      !shouldDeleteExpiredPairInvite(
        timestampMillis(current.data()?.expiresAt),
        nowMillis,
      )
    ) {
      return false;
    }
    transaction.delete(candidate.ref);
    return true;
  });
}

async function deleteCacheTombstoneIfStillEligible(
  db: Firestore,
  candidate: QueryDocumentSnapshot,
  nowMillis: number,
): Promise<boolean> {
  return db.runTransaction(async transaction => {
    const current = await transaction.get(candidate.ref);
    if (
      !current.exists ||
      !shouldDeleteAcknowledgedCacheTombstone(
        {
          status: current.data()?.status,
          acknowledgedAtMillis: timestampMillis(
            current.data()?.acknowledgedAt,
          ),
        },
        nowMillis,
      )
    ) {
      return false;
    }
    transaction.delete(candidate.ref);
    return true;
  });
}

/**
 * Select a bounded candidate set, then re-read every document in a transaction.
 * Query snapshots are hints only: an invite whose expiry moved or a tombstone
 * whose acknowledgement state changed can never be deleted from stale data.
 */
export async function cleanupExpiredPairArtifacts(
  db: Firestore,
  nowMillis: number,
): Promise<RetentionCleanupReport> {
  const [pairInvites, cacheTombstones] = await Promise.all([
    db.collection("pairInvites")
      .where(
        "expiresAt",
        "<=",
        Timestamp.fromMillis(expiredPairInviteCutoffMillis(nowMillis)),
      )
      .orderBy("expiresAt", "asc")
      .limit(RETENTION_CLEANUP_QUERY_LIMIT)
      .get(),
    db.collectionGroup("cacheTombstones")
      .where("status", "==", "acknowledged")
      .where(
        "acknowledgedAt",
        "<=",
        Timestamp.fromMillis(
          acknowledgedCacheTombstoneCutoffMillis(nowMillis),
        ),
      )
      .orderBy("acknowledgedAt", "asc")
      .limit(RETENTION_CLEANUP_QUERY_LIMIT)
      .get(),
  ]);

  const [deletedPairInvites, deletedCacheTombstones] = await Promise.all([
    inBoundedChunks(pairInvites.docs, candidate =>
      deletePairInviteIfStillEligible(db, candidate, nowMillis),
    ),
    inBoundedChunks(cacheTombstones.docs, candidate =>
      deleteCacheTombstoneIfStillEligible(db, candidate, nowMillis),
    ),
  ]);

  return {
    pairInviteCandidates: pairInvites.size,
    cacheTombstoneCandidates: cacheTombstones.size,
    deletedPairInvites,
    deletedCacheTombstones,
  };
}
