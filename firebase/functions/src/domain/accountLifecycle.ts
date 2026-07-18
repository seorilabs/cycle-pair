import {createHash} from "node:crypto";

type JsonRecord = Record<string, unknown>;

export const ACCOUNT_EXPORT_SCHEMA_VERSION = 1;
export const ACCOUNT_EXPORT_TICKET_SCHEMA_VERSION = 1;
export const ACCOUNT_EXPORT_TOKEN_BYTES = 32;
export const ACCOUNT_EXPORT_TICKET_TTL_MS = 5 * 60 * 1_000;
export const ACCOUNT_DELETION_SCHEMA_VERSION = 1;
export const ACCOUNT_DELETION_RECEIPT_BYTES = 32;
export const ACCOUNT_DELETION_FINALIZER_SCHEDULE = "every 15 minutes";
export const RECENT_AUTH_MAX_AGE_SECONDS = 5 * 60;
export const AUTH_CLOCK_SKEW_SECONDS = 60;

export const ACCOUNT_EXPORT_LIMITS = Object.freeze({
  privateCycles: 100,
  privateDailyLogs: 1_000,
  shareSettings: 100,
  pairMemberships: 100,
  activePairs: 4,
  eventsPerPair: 500,
});

export const ACCOUNT_DELETION_LIMITS = Object.freeze({
  pairDocuments: 100,
  inviteDocumentsPerQuery: 100,
  purchaseTokenDocuments: 100,
  accountExportTicketDocuments: 10,
});

/**
 * Every user-owned root document is recursively deleted. Notification devices
 * live below users/{uid}, so that recursive root deletion also removes every
 * raw FCM token. Purchase token bindings use a token-hash document ID rather
 * than the UID, so callers add those query results separately.
 */
export const USER_ROOT_DOCUMENT_COLLECTIONS = Object.freeze([
  "users",
  "pairBindings",
  "connectionStates",
  "subscriptions",
  "purchaseStates",
  "notificationTokens",
  "accountExportStates",
] as const);

export type AccountPolicyCode =
  | "invalid-argument"
  | "permission-denied"
  | "failed-precondition";

export class AccountPolicyError extends Error {
  constructor(
    readonly code: AccountPolicyCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountPolicyError";
  }
}

export interface AccountDeletionAuthFacts {
  readonly uid: string;
  readonly signInProvider: string | undefined;
  readonly authTimeSeconds: number | undefined;
}

export interface PairCleanupInventory {
  readonly pairId: string;
  readonly members: readonly [string, string];
  readonly projectionDocumentPaths: readonly string[];
  readonly shareSettingsDocumentPaths: readonly string[];
  readonly membershipDocumentPaths: readonly string[];
  readonly cacheTombstoneDocumentPaths: readonly string[];
  readonly bindingDocumentPaths: readonly string[];
  readonly connectionStateDocumentPaths: readonly string[];
  readonly eventCollectionPaths: readonly string[];
  readonly pairTombstoneDocumentPath: string;
}

export interface AccountDeletionInventory {
  readonly recursiveDocumentPaths: readonly string[];
  readonly pairDocumentPaths: readonly string[];
  readonly inviteDocumentPaths: readonly string[];
  readonly purchaseTokenDocumentPaths: readonly string[];
  readonly accountExportTicketDocumentPaths: readonly string[];
}

export interface AccountExportTicketFacts {
  readonly uid: unknown;
  readonly schemaVersion: unknown;
  readonly expiresAtMillis: unknown;
}

export function authorizeAccountExport(
  authenticatedUid: string,
  requestedUid: unknown,
): string {
  if (requestedUid === undefined || requestedUid === null) {
    return authenticatedUid;
  }
  if (typeof requestedUid !== "string" || requestedUid.length === 0) {
    throw new AccountPolicyError(
      "invalid-argument",
      "uid가 올바르지 않습니다.",
    );
  }
  if (requestedUid !== authenticatedUid) {
    throw new AccountPolicyError(
      "permission-denied",
      "본인 데이터만 내보낼 수 있습니다.",
    );
  }

  return authenticatedUid;
}

export function authorizeRecentDurableAccount(
  auth: AccountDeletionAuthFacts,
  nowSeconds: number,
): string {
  if (auth.signInProvider === undefined || auth.signInProvider === "anonymous") {
    throw new AccountPolicyError(
      "failed-precondition",
      "민감한 계정 작업 전에 복구 가능한 계정으로 로그인해야 합니다.",
    );
  }
  const authTime = auth.authTimeSeconds;
  if (typeof authTime !== "number" || !Number.isSafeInteger(authTime)) {
    throw new AccountPolicyError(
      "failed-precondition",
      "민감한 계정 작업 전에 다시 인증해야 합니다.",
    );
  }
  const ageSeconds = nowSeconds - authTime;
  if (
    ageSeconds > RECENT_AUTH_MAX_AGE_SECONDS ||
    ageSeconds < -AUTH_CLOCK_SKEW_SECONDS
  ) {
    throw new AccountPolicyError(
      "failed-precondition",
      "민감한 계정 작업 전에 다시 인증해야 합니다.",
    );
  }

  return auth.uid;
}

export function authorizeAccountDeletion(
  auth: AccountDeletionAuthFacts,
  nowSeconds: number,
): string {
  // An anonymous Firebase Auth identity has no credential it can use for
  // reauthentication. The callable still verifies the signed Firebase token
  // and separately enforces that the requested UID is the authenticated UID,
  // so an anonymous user can safely exercise the right to erase their own
  // account and data.
  if (auth.signInProvider === "anonymous") {
    return auth.uid;
  }
  return authorizeRecentDurableAccount(auth, nowSeconds);
}

export function buildPairCleanupInventory(
  pairId: string,
  members: readonly [string, string],
): PairCleanupInventory {
  return {
    pairId,
    members,
    projectionDocumentPaths: members.map(
      uid => `pairs/${pairId}/projections/${uid}`,
    ),
    shareSettingsDocumentPaths: members.map(
      uid => `users/${uid}/shareSettings/${pairId}`,
    ),
    membershipDocumentPaths: members.map(
      uid => `users/${uid}/pairMemberships/${pairId}`,
    ),
    cacheTombstoneDocumentPaths: members.map(
      uid => `users/${uid}/cacheTombstones/${pairId}`,
    ),
    bindingDocumentPaths: members.map(uid => `pairBindings/${uid}`),
    connectionStateDocumentPaths: members.map(
      uid => `connectionStates/${uid}`,
    ),
    eventCollectionPaths: [
      `pairs/${pairId}/events`,
      `pairs/${pairId}/eventMutations`,
    ],
    pairTombstoneDocumentPath: `pairTombstones/${pairId}`,
  };
}

export function buildAccountDeletionInventory(
  uid: string,
  pairIds: readonly string[],
  inviteDocumentPaths: readonly string[],
  purchaseTokenDocumentPaths: readonly string[] = [],
  accountExportTicketDocumentPaths: readonly string[] = [],
): AccountDeletionInventory {
  const uniquePairIds = [...new Set(pairIds)].sort();
  const uniqueInvitePaths = [...new Set(inviteDocumentPaths)].sort();
  const uniquePurchaseTokenPaths = [...new Set(purchaseTokenDocumentPaths)].sort();
  const uniqueAccountExportTicketPaths = [
    ...new Set(accountExportTicketDocumentPaths),
  ].sort();
  const pairDocumentPaths = uniquePairIds.map(pairId => `pairs/${pairId}`);
  const recursiveDocumentPaths = [
    ...USER_ROOT_DOCUMENT_COLLECTIONS.map(collection => `${collection}/${uid}`),
    ...pairDocumentPaths,
    ...uniquePairIds.map(pairId => `pairTombstones/${pairId}`),
    ...uniqueInvitePaths,
    ...uniquePurchaseTokenPaths,
    ...uniqueAccountExportTicketPaths,
  ];

  return {
    recursiveDocumentPaths: [...new Set(recursiveDocumentPaths)],
    pairDocumentPaths,
    inviteDocumentPaths: uniqueInvitePaths,
    purchaseTokenDocumentPaths: uniquePurchaseTokenPaths,
    accountExportTicketDocumentPaths: uniqueAccountExportTicketPaths,
  };
}

export function isAccountExportToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function accountExportTokenHash(token: string): string {
  if (!isAccountExportToken(token)) {
    throw new AccountPolicyError(
      "invalid-argument",
      "내보내기 링크가 유효하지 않습니다.",
    );
  }
  // The bearer token is never persisted. Only this one-way document ID is
  // retained until the ticket is consumed or expires.
  return createHash("sha256").update(token).digest("hex");
}

export function isAccountDeletionReceipt(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function accountDeletionReceiptHash(receipt: string): string {
  if (!isAccountDeletionReceipt(receipt)) {
    throw new AccountPolicyError(
      "invalid-argument",
      "계정 삭제 복구 영수증이 유효하지 않습니다.",
    );
  }
  return createHash("sha256").update(receipt).digest("hex");
}

export function authorizeAccountExportTicket(
  facts: AccountExportTicketFacts,
  nowMillis: number,
): string {
  if (
    facts.schemaVersion !== ACCOUNT_EXPORT_TICKET_SCHEMA_VERSION ||
    typeof facts.uid !== "string" ||
    facts.uid.length === 0 ||
    typeof facts.expiresAtMillis !== "number" ||
    !Number.isSafeInteger(facts.expiresAtMillis) ||
    facts.expiresAtMillis <= nowMillis
  ) {
    throw new AccountPolicyError(
      "failed-precondition",
      "내보내기 링크가 만료되었거나 이미 사용되었습니다.",
    );
  }
  return facts.uid;
}

export function accountExportFilename(now: Date): string {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("내보내기 파일 날짜가 올바르지 않습니다.");
  }
  return `cycle-pair-data-export-${now.toISOString().slice(0, 10)}.json`;
}

export function enabledConsentFields(value: unknown): readonly string[] {
  if (!isPlainRecord(value)) {
    return [];
  }

  return Object.entries(value)
    .filter(([key, fieldValue]) =>
      fieldValue === true && key !== "schemaVersion",
    )
    .map(([key]) => key)
    .sort();
}

/** Convert Firestore-compatible values to a response with no custom objects. */
export function toJsonSafe(value: unknown, depth = 0): unknown {
  if (depth > 20) {
    throw new Error("내보내기 데이터 중첩 깊이가 한도를 초과했습니다.");
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(item => toJsonSafe(item, depth + 1) ?? null);
  }
  if (isTimestampLike(value)) {
    return value.toDate().toISOString();
  }
  if (isBytesLike(value)) {
    return value.toBase64();
  }
  if (isGeoPointLike(value)) {
    return {latitude: value.latitude, longitude: value.longitude};
  }
  if (isDocumentReferenceLike(value)) {
    return {path: value.path};
  }
  if (typeof value === "object") {
    const output: JsonRecord = {};
    for (const [key, item] of Object.entries(value)) {
      const safeItem = toJsonSafe(item, depth + 1);
      if (safeItem !== undefined) {
        output[key] = safeItem;
      }
    }
    return output;
  }

  return String(value);
}

function isPlainRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestampLike(
  value: unknown,
): value is {toDate(): Date} {
  return (
    isPlainRecord(value) &&
    typeof (value as {toDate?: unknown}).toDate === "function"
  );
}

function isBytesLike(
  value: unknown,
): value is {toBase64(): string} {
  return (
    isPlainRecord(value) &&
    typeof (value as {toBase64?: unknown}).toBase64 === "function"
  );
}

function isGeoPointLike(
  value: unknown,
): value is {latitude: number; longitude: number} {
  return (
    isPlainRecord(value) &&
    typeof value.latitude === "number" &&
    typeof value.longitude === "number"
  );
}

function isDocumentReferenceLike(
  value: unknown,
): value is {path: string} {
  return isPlainRecord(value) && typeof value.path === "string";
}
