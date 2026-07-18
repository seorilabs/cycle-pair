const DAY_MS = 24 * 60 * 60 * 1_000;

/** Keep expired Pair invite metadata for seven full days after expiresAt. */
export const EXPIRED_PAIR_INVITE_RETENTION_MS = 7 * DAY_MS;

/** Keep an acknowledged cache deletion receipt for thirty full days. */
export const ACKNOWLEDGED_CACHE_TOMBSTONE_RETENTION_MS = 30 * DAY_MS;

/** One daily run has a fixed upper bound for each queried document type. */
export const RETENTION_CLEANUP_QUERY_LIMIT = 200;

/** Bound concurrent Firestore transactions inside one cleanup invocation. */
export const RETENTION_CLEANUP_TRANSACTION_CONCURRENCY = 20;

export const RETENTION_CLEANUP_SCHEDULE = "0 3 * * *";
export const RETENTION_CLEANUP_TIME_ZONE = "Asia/Seoul";

function isMillis(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function cutoffMillis(nowMillis: number, retentionMillis: number): number {
  if (!isMillis(nowMillis)) {
    throw new RangeError("retention policy nowMillis must be a safe integer");
  }
  return nowMillis - retentionMillis;
}

export function expiredPairInviteCutoffMillis(nowMillis: number): number {
  return cutoffMillis(nowMillis, EXPIRED_PAIR_INVITE_RETENTION_MS);
}

export function acknowledgedCacheTombstoneCutoffMillis(
  nowMillis: number,
): number {
  return cutoffMillis(nowMillis, ACKNOWLEDGED_CACHE_TOMBSTONE_RETENTION_MS);
}

export function shouldDeleteExpiredPairInvite(
  expiresAtMillis: unknown,
  nowMillis: number,
): boolean {
  return isMillis(expiresAtMillis) &&
    expiresAtMillis <= expiredPairInviteCutoffMillis(nowMillis);
}

export function shouldDeleteAcknowledgedCacheTombstone(
  facts: {
    readonly status: unknown;
    readonly acknowledgedAtMillis: unknown;
  },
  nowMillis: number,
): boolean {
  return facts.status === "acknowledged" &&
    isMillis(facts.acknowledgedAtMillis) &&
    facts.acknowledgedAtMillis <=
      acknowledgedCacheTombstoneCutoffMillis(nowMillis);
}
