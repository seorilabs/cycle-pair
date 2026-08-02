import {createHash} from "node:crypto";

import {describe, expect, test} from "vitest";

import {
  ACCOUNT_DELETION_LIMITS,
  ACCOUNT_DELETION_RECEIPT_BYTES,
  ACCOUNT_EXPORT_SCHEMA_VERSION,
  ACCOUNT_EXPORT_TICKET_SCHEMA_VERSION,
  ACCOUNT_EXPORT_TICKET_TTL_MS,
  RECENT_AUTH_MAX_AGE_SECONDS,
  USER_ROOT_DOCUMENT_COLLECTIONS,
  AccountPolicyError,
  authorizeAccountDeletion,
  authorizeAccountExport,
  authorizeAccountExportTicket,
  authorizeRecentDurableAccount,
  accountExportFilename,
  accountExportTokenHash,
  accountDeletionReceiptHash,
  buildAccountDeletionInventory,
  buildPairCleanupInventory,
  enabledConsentFields,
  toJsonSafe,
} from "../src/domain/accountLifecycle.js";

describe("account export policy", () => {
  test("allows omitted or matching uid and rejects another owner", () => {
    expect(authorizeAccountExport("alice", undefined)).toBe("alice");
    expect(authorizeAccountExport("alice", "alice")).toBe("alice");
    expect(() => authorizeAccountExport("alice", "bob")).toThrowError(
      expect.objectContaining({code: "permission-denied"}),
    );
  });

  test("requires a recent durable login before exporting sensitive data", () => {
    const nowSeconds = 2_000_000;
    expect(() => authorizeRecentDurableAccount({
      uid: "alice",
      signInProvider: "anonymous",
      seoriGuest: false,
      authTimeSeconds: nowSeconds,
    }, nowSeconds)).toThrowError(
      expect.objectContaining({code: "failed-precondition"}),
    );
    expect(() => authorizeRecentDurableAccount({
      uid: "alice",
      signInProvider: "password",
      seoriGuest: false,
      authTimeSeconds: nowSeconds - RECENT_AUTH_MAX_AGE_SECONDS - 1,
    }, nowSeconds)).toThrowError(
      expect.objectContaining({code: "failed-precondition"}),
    );
  });

  test("keeps the payload JSON-safe and exposes enabled consent keys", () => {
    const value = toJsonSafe({
      timestamp: {toDate: () => new Date("2026-07-14T00:00:00.000Z")},
      nested: [1, undefined, {note: "본인 메모"}],
    });
    expect(value).toEqual({
      timestamp: "2026-07-14T00:00:00.000Z",
      nested: [1, null, {note: "본인 메모"}],
    });
    expect(enabledConsentFields({
      schemaVersion: 1,
      periodDates: true,
      moodTag: false,
      carePreferences: true,
    })).toEqual(["carePreferences", "periodDates"]);
    expect(ACCOUNT_EXPORT_SCHEMA_VERSION).toBe(1);
  });

  test("hashes a 32-byte bearer token and enforces a strict ticket expiry", () => {
    const token = "a".repeat(43);
    expect(accountExportTokenHash(token)).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(() => accountExportTokenHash("raw-token")).toThrowError(
      expect.objectContaining({code: "invalid-argument"}),
    );
    expect(authorizeAccountExportTicket({
      schemaVersion: ACCOUNT_EXPORT_TICKET_SCHEMA_VERSION,
      uid: "alice",
      expiresAtMillis: 1_000 + ACCOUNT_EXPORT_TICKET_TTL_MS,
    }, 1_000)).toBe("alice");
    expect(() => authorizeAccountExportTicket({
      schemaVersion: ACCOUNT_EXPORT_TICKET_SCHEMA_VERSION,
      uid: "alice",
      expiresAtMillis: 1_000,
    }, 1_000)).toThrowError(
      expect.objectContaining({code: "failed-precondition"}),
    );
    expect(accountExportFilename(new Date("2026-07-14T23:59:59.000Z")))
      .toBe("cycle-pair-data-export-2026-07-14.json");
  });
});

describe("account deletion authorization", () => {
  const nowSeconds = 2_000_000;

  test("allows an authenticated anonymous account to erase itself", () => {
    expect(authorizeAccountDeletion({
      uid: "alice",
      signInProvider: "anonymous",
      seoriGuest: false,
      authTimeSeconds: undefined,
    }, nowSeconds)).toBe("alice");
  });

  test("rejects unknown or stale durable authentication and accepts a recent login", () => {
    expect(() => authorizeAccountDeletion({
      uid: "alice",
      signInProvider: undefined,
      seoriGuest: false,
      authTimeSeconds: nowSeconds,
    }, nowSeconds)).toThrow(AccountPolicyError);
    expect(() => authorizeAccountDeletion({
      uid: "alice",
      signInProvider: "password",
      seoriGuest: false,
      authTimeSeconds: nowSeconds - RECENT_AUTH_MAX_AGE_SECONDS - 1,
    }, nowSeconds)).toThrow(AccountPolicyError);
    expect(authorizeAccountDeletion({
      uid: "alice",
      signInProvider: "password",
      seoriGuest: false,
      authTimeSeconds: nowSeconds - RECENT_AUTH_MAX_AGE_SECONDS,
    }, nowSeconds)).toBe("alice");
  });

  test("treats a platform custom-token guest as deletable but not durable", () => {
    const platformGuest = {
      uid: "pb_01K1J9ZVJ7AJ0DQRMA4RYB4R7P",
      signInProvider: "custom",
      seoriGuest: true,
      authTimeSeconds: nowSeconds,
    } as const;
    expect(authorizeAccountDeletion(platformGuest, nowSeconds))
      .toBe("pb_01K1J9ZVJ7AJ0DQRMA4RYB4R7P");
    expect(() => authorizeRecentDurableAccount(platformGuest, nowSeconds))
      .toThrowError(expect.objectContaining({code: "failed-precondition"}));

    expect(authorizeRecentDurableAccount({
      ...platformGuest,
      signInProvider: "password",
    }, nowSeconds)).toBe("pb_01K1J9ZVJ7AJ0DQRMA4RYB4R7P");
  });

  test("hashes only a 256-bit base64url deletion recovery receipt", () => {
    const receipt = "z".repeat(43);
    expect(ACCOUNT_DELETION_RECEIPT_BYTES).toBe(32);
    expect(accountDeletionReceiptHash(receipt)).toBe(
      createHash("sha256").update(receipt).digest("hex"),
    );
    expect(() => accountDeletionReceiptHash("guessable"))
      .toThrowError(expect.objectContaining({code: "invalid-argument"}));
  });
});

describe("account deletion inventory", () => {
  test("covers pair access revocation, event cleanup, and both member mirrors", () => {
    const inventory = buildPairCleanupInventory("pair-1", ["alice", "bob"]);
    expect(inventory.projectionDocumentPaths).toEqual([
      "pairs/pair-1/projections/alice",
      "pairs/pair-1/projections/bob",
    ]);
    expect(inventory.eventCollectionPaths).toEqual([
      "pairs/pair-1/events",
      "pairs/pair-1/eventMutations",
    ]);
    expect(inventory.cacheTombstoneDocumentPaths).toContain(
      "users/bob/cacheTombstones/pair-1",
    );
    expect(inventory.bindingDocumentPaths).toEqual([
      "pairBindings/alice",
      "pairBindings/bob",
    ]);
  });

  test("recursively covers user, purchase/token placeholders, pairs, and invites", () => {
    const inventory = buildAccountDeletionInventory(
      "alice",
      ["pair-2", "pair-1", "pair-1"],
      ["pairInvites/hash-2", "pairInvites/hash-1"],
      ["purchaseTokens/token-hash-2", "purchaseTokens/token-hash-1"],
      ["accountExportTickets/export-hash"],
    );
    for (const collection of USER_ROOT_DOCUMENT_COLLECTIONS) {
      expect(inventory.recursiveDocumentPaths).toContain(`${collection}/alice`);
    }
    expect(inventory.recursiveDocumentPaths).not.toContain(
      "accountDeletionStates/alice",
    );
    // notificationDevices is a subcollection of this recursively deleted root.
    expect(inventory.recursiveDocumentPaths).toContain("users/alice");
    expect(inventory.pairDocumentPaths).toEqual([
      "pairs/pair-1",
      "pairs/pair-2",
    ]);
    expect(inventory.recursiveDocumentPaths).toContain(
      "pairTombstones/pair-1",
    );
    expect(inventory.inviteDocumentPaths).toEqual([
      "pairInvites/hash-1",
      "pairInvites/hash-2",
    ]);
    expect(inventory.purchaseTokenDocumentPaths).toEqual([
      "purchaseTokens/token-hash-1",
      "purchaseTokens/token-hash-2",
    ]);
    expect(inventory.recursiveDocumentPaths).toContain(
      "purchaseTokens/token-hash-1",
    );
    expect(inventory.accountExportTicketDocumentPaths).toEqual([
      "accountExportTickets/export-hash",
    ]);
    expect(inventory.recursiveDocumentPaths).toContain(
      "accountExportTickets/export-hash",
    );
    expect(ACCOUNT_DELETION_LIMITS.pairDocuments).toBeGreaterThan(1);
  });
});
