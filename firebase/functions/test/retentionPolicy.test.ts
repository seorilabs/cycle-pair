import {describe, expect, test} from "vitest";

import {
  ACKNOWLEDGED_CACHE_TOMBSTONE_RETENTION_MS,
  EXPIRED_PAIR_INVITE_RETENTION_MS,
  RETENTION_CLEANUP_QUERY_LIMIT,
  acknowledgedCacheTombstoneCutoffMillis,
  expiredPairInviteCutoffMillis,
  shouldDeleteAcknowledgedCacheTombstone,
  shouldDeleteExpiredPairInvite,
} from "../src/domain/retentionPolicy.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = Date.parse("2026-07-14T03:00:00.000Z");

describe("Pair artifact retention policy", () => {
  test("keeps expired Pair invites for seven full days", () => {
    expect(EXPIRED_PAIR_INVITE_RETENTION_MS).toBe(7 * DAY_MS);
    const cutoff = expiredPairInviteCutoffMillis(NOW);

    expect(shouldDeleteExpiredPairInvite(cutoff + 1, NOW)).toBe(false);
    expect(shouldDeleteExpiredPairInvite(cutoff, NOW)).toBe(true);
    expect(shouldDeleteExpiredPairInvite(cutoff - 1, NOW)).toBe(true);
  });

  test("never deletes unexpired, recently expired, or malformed invites", () => {
    expect(shouldDeleteExpiredPairInvite(NOW + DAY_MS, NOW)).toBe(false);
    expect(shouldDeleteExpiredPairInvite(NOW - DAY_MS, NOW)).toBe(false);
    expect(shouldDeleteExpiredPairInvite(undefined, NOW)).toBe(false);
    expect(shouldDeleteExpiredPairInvite("2026-07-01", NOW)).toBe(false);
  });

  test("keeps acknowledged cache tombstones for thirty full days", () => {
    expect(ACKNOWLEDGED_CACHE_TOMBSTONE_RETENTION_MS).toBe(30 * DAY_MS);
    const cutoff = acknowledgedCacheTombstoneCutoffMillis(NOW);

    expect(shouldDeleteAcknowledgedCacheTombstone({
      status: "acknowledged",
      acknowledgedAtMillis: cutoff + 1,
    }, NOW)).toBe(false);
    expect(shouldDeleteAcknowledgedCacheTombstone({
      status: "acknowledged",
      acknowledgedAtMillis: cutoff,
    }, NOW)).toBe(true);
    expect(shouldDeleteAcknowledgedCacheTombstone({
      status: "acknowledged",
      acknowledgedAtMillis: cutoff - 1,
    }, NOW)).toBe(true);
  });

  test("never deletes pending or unacknowledged tombstones", () => {
    const longAgo = NOW - 365 * DAY_MS;
    expect(shouldDeleteAcknowledgedCacheTombstone({
      status: "pending",
      acknowledgedAtMillis: longAgo,
    }, NOW)).toBe(false);
    expect(shouldDeleteAcknowledgedCacheTombstone({
      status: "acknowledged",
      acknowledgedAtMillis: undefined,
    }, NOW)).toBe(false);
    expect(shouldDeleteAcknowledgedCacheTombstone({
      status: "revoked",
      acknowledgedAtMillis: longAgo,
    }, NOW)).toBe(false);
  });

  test("uses a bounded positive query limit", () => {
    expect(RETENTION_CLEANUP_QUERY_LIMIT).toBeGreaterThan(0);
    expect(RETENTION_CLEANUP_QUERY_LIMIT).toBeLessThanOrEqual(500);
  });

  test("rejects an invalid policy clock instead of widening deletion", () => {
    expect(() => expiredPairInviteCutoffMillis(Number.NaN)).toThrow(RangeError);
    expect(() =>
      acknowledgedCacheTombstoneCutoffMillis(Number.MAX_VALUE),
    ).toThrow(RangeError);
  });
});
