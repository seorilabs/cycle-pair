import {Firestore, QueryDocumentSnapshot, Timestamp} from "firebase-admin/firestore";
import {describe, expect, test, vi} from "vitest";

import {
  ACKNOWLEDGED_CACHE_TOMBSTONE_RETENTION_MS,
  EXPIRED_PAIR_INVITE_RETENTION_MS,
  RETENTION_CLEANUP_QUERY_LIMIT,
} from "../src/domain/retentionPolicy.js";
import {cleanupExpiredPairArtifacts} from "../src/services/retentionCleanup.js";

interface FakeReference {
  readonly path: string;
}

function candidate(path: string): QueryDocumentSnapshot {
  return {ref: {path} as FakeReference} as unknown as QueryDocumentSnapshot;
}

function query(candidates: readonly QueryDocumentSnapshot[]) {
  const value = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(async () => ({docs: candidates, size: candidates.length})),
  };
  value.where.mockReturnValue(value);
  value.orderBy.mockReturnValue(value);
  value.limit.mockReturnValue(value);
  return value;
}

describe("retention cleanup service", () => {
  test("rechecks stale candidates transactionally before bounded deletion", async () => {
    const now = Date.parse("2026-07-14T03:00:00.000Z");
    const inviteQuery = query([
      candidate("pairInvites/delete"),
      candidate("pairInvites/expiry-extended"),
    ]);
    const tombstoneQuery = query([
      candidate("users/a/cacheTombstones/delete"),
      candidate("users/b/cacheTombstones/back-to-pending"),
    ]);
    const currentData = new Map<string, Record<string, unknown>>([
      ["pairInvites/delete", {
        expiresAt: Timestamp.fromMillis(
          now - EXPIRED_PAIR_INVITE_RETENTION_MS - 1,
        ),
      }],
      ["pairInvites/expiry-extended", {
        expiresAt: Timestamp.fromMillis(now + 1),
      }],
      ["users/a/cacheTombstones/delete", {
        status: "acknowledged",
        acknowledgedAt: Timestamp.fromMillis(
          now - ACKNOWLEDGED_CACHE_TOMBSTONE_RETENTION_MS - 1,
        ),
      }],
      ["users/b/cacheTombstones/back-to-pending", {
        status: "pending",
        acknowledgedAt: Timestamp.fromMillis(
          now - ACKNOWLEDGED_CACHE_TOMBSTONE_RETENTION_MS - 1,
        ),
      }],
    ]);
    const deleted: string[] = [];
    const transaction = {
      get: vi.fn(async (ref: FakeReference) => {
        const data = currentData.get(ref.path);
        return {
          exists: data !== undefined,
          data: () => data,
        };
      }),
      delete: vi.fn((ref: FakeReference) => {
        deleted.push(ref.path);
      }),
    };
    const db = {
      collection: vi.fn(() => inviteQuery),
      collectionGroup: vi.fn(() => tombstoneQuery),
      runTransaction: vi.fn(async callback => callback(transaction)),
    } as unknown as Firestore;

    await expect(cleanupExpiredPairArtifacts(db, now)).resolves.toEqual({
      pairInviteCandidates: 2,
      cacheTombstoneCandidates: 2,
      deletedPairInvites: 1,
      deletedCacheTombstones: 1,
    });
    expect(inviteQuery.limit).toHaveBeenCalledWith(
      RETENTION_CLEANUP_QUERY_LIMIT,
    );
    expect(tombstoneQuery.limit).toHaveBeenCalledWith(
      RETENTION_CLEANUP_QUERY_LIMIT,
    );
    expect(deleted.sort()).toEqual([
      "pairInvites/delete",
      "users/a/cacheTombstones/delete",
    ].sort());
  });
});
