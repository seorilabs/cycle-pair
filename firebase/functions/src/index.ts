import {createHash, randomBytes, timingSafeEqual} from "node:crypto";

import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {
  DocumentData,
  DocumentSnapshot,
  DocumentReference,
  FieldValue,
  QueryDocumentSnapshot,
  Query,
  Timestamp,
  Transaction,
  getFirestore,
} from "firebase-admin/firestore";
import {getMessaging} from "firebase-admin/messaging";
import {logger} from "firebase-functions";
import {setGlobalOptions} from "firebase-functions/v2";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {
  CallableRequest,
  HttpsError,
  onCall,
  onRequest,
} from "firebase-functions/v2/https";
import {onMessagePublished} from "firebase-functions/v2/pubsub";
import {onSchedule} from "firebase-functions/v2/scheduler";

import {
  ACCOUNT_DELETION_LIMITS,
  ACCOUNT_DELETION_FINALIZER_SCHEDULE,
  ACCOUNT_DELETION_RECEIPT_BYTES,
  ACCOUNT_DELETION_SCHEMA_VERSION,
  ACCOUNT_EXPORT_LIMITS,
  ACCOUNT_EXPORT_SCHEMA_VERSION,
  ACCOUNT_EXPORT_TICKET_SCHEMA_VERSION,
  ACCOUNT_EXPORT_TICKET_TTL_MS,
  ACCOUNT_EXPORT_TOKEN_BYTES,
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
} from "./domain/accountLifecycle.js";
import {
  INVITE_TTL_MS,
  evaluateInviteRateLimit,
  inviteIsUsable,
} from "./domain/invitePolicy.js";
import {
  RETENTION_CLEANUP_SCHEDULE,
  RETENTION_CLEANUP_TIME_ZONE,
} from "./domain/retentionPolicy.js";
import {
  PairEventInput,
  PairEventValidationError,
  parsePairEventInput,
} from "./domain/pairEvent.js";
import {
  NOTIFICATION_DEVICE_LIMIT,
  NOTIFICATION_SCHEMA_VERSION,
  NeutralNotificationType,
  NotificationDeviceInput,
  NotificationValidationError,
  hasMeaningfulProjectionChange,
  isInvalidRegistrationTokenCode,
  isWithinQuietHours,
  neutralNotificationContent,
  notificationTokenHash,
  parseNotificationDeviceInput,
  parseNotificationToken,
  shouldSendEventNotification,
} from "./domain/notification.js";
import {
  PARTNER_NUDGE_SCHEMA_VERSION,
  PartnerNudgeType,
  evaluatePartnerNudgeCooldown,
  parsePartnerNudgeType,
  partnerNudgeCooldownFields,
} from "./domain/partnerNudge.js";
import {buildPartnerProjection} from "./domain/projection.js";
import {
  SubscriptionPolicyError,
  parseVerifySubscriptionRequest,
} from "./domain/subscription.js";
import {
  APPLE_IAP_SECRETS,
  GooglePlayDeveloperApiProvider,
  OfficialAppleAppStoreProvider,
} from "./providers/subscriptionProviders.js";
import {
  FirestoreSubscriptionRepository,
  SubscriptionService,
} from "./services/subscriptionService.js";
import {finalizeAccountDeletion} from "./services/accountDeletionFinalizer.js";
import {cleanupExpiredPairArtifacts} from "./services/retentionCleanup.js";

initializeApp();

const db = getFirestore();
const auth = getAuth();
const messaging = getMessaging();
const subscriptionRepository = new FirestoreSubscriptionRepository(db);
const subscriptionService = new SubscriptionService(
  subscriptionRepository,
  new GooglePlayDeveloperApiProvider(),
  new OfficialAppleAppStoreProvider(),
);
const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true";
const FUNCTIONS_REGION = "asia-northeast3";
const ACCOUNT_DELETION_LEASE_MS = 10 * 60 * 1_000;
const ACCOUNT_DELETION_FINALIZER_BATCH_SIZE = 5;

setGlobalOptions({
  region: FUNCTIONS_REGION,
  maxInstances: 10,
  timeoutSeconds: 30,
});

const callableOptions = {
  enforceAppCheck,
  cors: true,
  // Firebase Auth/App Check are verified by the callable protocol inside the
  // function. Cloud Run must accept the request before those tokens can be read.
  // The Seorilabs domain-restricted-sharing policy requires the deployed Cloud
  // Run service to use --no-invoker-iam-check instead of an allUsers binding.
  invoker: "public" as const,
};

type JsonRecord = Record<string, unknown>;

interface ConnectionStateData {
  readonly inviteEpoch: number;
  readonly inviteWindowStartedAtMillis: number | null;
  readonly inviteCount: number;
}

interface PairMemberInput {
  readonly uid: string;
  readonly recordsCycle: boolean;
}

type PairEventOperation = "upsert" | "delete";

function requireAuth(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (uid === undefined || uid.length === 0) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  return uid;
}

function requireAccountMutationAllowed(
  deletionState: DocumentSnapshot<DocumentData>,
): void {
  if (deletionState.exists) {
    throw new HttpsError(
      "failed-precondition",
      "계정 삭제가 진행 중이거나 완료되었습니다.",
    );
  }
}

function asRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "요청 형식이 올바르지 않습니다.");
  }

  return value as JsonRecord;
}

function requireBoolean(data: JsonRecord, field: string): boolean {
  const value = data[field];
  if (typeof value !== "boolean") {
    throw new HttpsError("invalid-argument", `${field}는 boolean이어야 합니다.`);
  }

  return value;
}

function requireDocumentId(data: JsonRecord, field: string): string {
  const value = data[field];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new HttpsError("invalid-argument", `${field}가 올바르지 않습니다.`);
  }

  return value;
}

function requirePairEvent(value: unknown): PairEventInput {
  try {
    return parsePairEventInput(value);
  } catch (error) {
    if (error instanceof PairEventValidationError) {
      throw new HttpsError("invalid-argument", error.message);
    }
    throw error;
  }
}

function requireInviteToken(data: JsonRecord): string {
  const token = data.inviteToken;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new HttpsError("invalid-argument", "초대가 유효하지 않습니다.");
  }

  return token;
}

function inviteHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseConnectionState(
  snapshot: DocumentSnapshot<DocumentData>,
): ConnectionStateData {
  const data = snapshot.data();
  const inviteEpoch = data?.inviteEpoch;
  const inviteCount = data?.inviteCount;
  const inviteWindowStartedAt = data?.inviteWindowStartedAt;

  return {
    inviteEpoch:
      typeof inviteEpoch === "number" && Number.isSafeInteger(inviteEpoch)
        ? inviteEpoch
        : 0,
    inviteWindowStartedAtMillis:
      inviteWindowStartedAt instanceof Timestamp
        ? inviteWindowStartedAt.toMillis()
        : null,
    inviteCount:
      typeof inviteCount === "number" && Number.isSafeInteger(inviteCount)
        ? inviteCount
        : 0,
  };
}

function timestampMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function pairMembers(data: DocumentData | undefined): readonly [string, string] {
  const memberUids = data?.memberUids;
  if (
    !Array.isArray(memberUids) ||
    memberUids.length !== 2 ||
    typeof memberUids[0] !== "string" ||
    typeof memberUids[1] !== "string" ||
    memberUids[0] === memberUids[1]
  ) {
    throw new HttpsError("failed-precondition", "Pair 데이터가 손상되었습니다.");
  }

  return [memberUids[0], memberUids[1]];
}

function requireActivePairMember(
  pair: DocumentData | undefined,
  uid: string,
): readonly [string, string] {
  if (pair === undefined) {
    throw new HttpsError("not-found", "Pair를 찾을 수 없습니다.");
  }

  const members = pairMembers(pair);
  if (!members.includes(uid)) {
    throw new HttpsError("permission-denied", "Pair 멤버만 접근할 수 있습니다.");
  }
  if (pair.status !== "active") {
    throw new HttpsError("failed-precondition", "활성 Pair가 아닙니다.");
  }

  return members;
}

function latestDailyLogQuery(uid: string): Query<DocumentData> {
  return db
    .collection(`users/${uid}/privateDailyLogs`)
    // Daily logs persist their canonical LocalDate as data as well as the
    // document ID. Ordering by the record date prevents an edited historical
    // log from replacing today's projection merely because updatedAt is newer.
    .orderBy("localDate", "desc")
    .limit(1);
}

async function latestDailyLog(
  transaction: Transaction,
  uid: string,
): Promise<DocumentData | undefined> {
  const snapshot = await transaction.get(latestDailyLogQuery(uid));
  return snapshot.docs[0]?.data();
}

async function projectionForMember(
  transaction: Transaction,
  member: PairMemberInput,
  pairId: string,
  now: Timestamp,
): Promise<{readonly document: JsonRecord; readonly recordsCycle: boolean}> {
  const shareSettingsRef = db.doc(`users/${member.uid}/shareSettings/${pairId}`);
  const privateCycleRef = db.doc(
    `users/${member.uid}/privateCycles/current`,
  );
  const [privateCycleSnapshot, privateDailyLog, shareSettingsSnapshot] =
    await Promise.all([
      transaction.get(privateCycleRef),
      latestDailyLog(transaction, member.uid),
      transaction.get(shareSettingsRef),
    ]);
  const privateCycle = privateCycleSnapshot.data();
  const hasCurrentSensitiveHealthConsent =
    privateCycle?.schemaVersion === 2 &&
    privateCycle?.consentVersion === "2026-08-09-v1";
  const recordsCycle = privateCycleSnapshot.exists
    ? privateCycle?.recordsCycle === true
    : member.recordsCycle;
  const projection = buildPartnerProjection({
    ownerUid: member.uid,
    pairId,
    generatedAt: now.toDate().toISOString(),
    // The owner-private setup is authoritative once it exists. This prevents
    // stale invite/Pair metadata from keeping cycle-derived fields shared.
    privateCycle:
      hasCurrentSensitiveHealthConsent && recordsCycle
        ? privateCycle
        : undefined,
    privateDailyLog: hasCurrentSensitiveHealthConsent
      ? privateDailyLog
      : undefined,
    shareSettings: shareSettingsSnapshot.data(),
  });

  return {document: {...projection, generatedAt: now}, recordsCycle};
}

function pairEventMutationHash(
  operation: PairEventOperation,
  eventId: string,
  event?: PairEventInput,
): string {
  return createHash("sha256")
    .update(JSON.stringify({operation, eventId, ...(event === undefined ? {} : {event})}))
    .digest("hex");
}

function requireMatchingMutationReceipt(
  receipt: DocumentData | undefined,
  uid: string,
  operation: PairEventOperation,
  eventId: string,
  payloadHash: string,
): void {
  if (
    receipt?.actorUid !== uid ||
    receipt.operation !== operation ||
    receipt.eventId !== eventId ||
    receipt.payloadHash !== payloadHash
  ) {
    throw new HttpsError(
      "failed-precondition",
      "mutationId가 다른 일정 변경에 이미 사용되었습니다.",
    );
  }
}

function notificationPolicy<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof NotificationValidationError) {
      throw new HttpsError("invalid-argument", error.message);
    }
    throw error;
  }
}

function safeExternalErrorCode(error: unknown): string {
  const code = optionalRecord(error)?.code;
  return typeof code === "string" && /^[a-z0-9/_-]{1,80}$/i.test(code)
    ? code
    : "unknown";
}

function storedNotificationDevice(
  data: DocumentData | undefined,
): NotificationDeviceInput | null {
  if (data === undefined) {
    return null;
  }
  try {
    return parseNotificationDeviceInput({
      token: data.token,
      platform: data.platform,
      locale: data.locale,
      quietHours: data.quietHours,
    });
  } catch {
    return null;
  }
}

async function deleteNotificationDeviceReferences(
  references: readonly DocumentReference<DocumentData>[],
): Promise<void> {
  if (references.length === 0) {
    return;
  }
  const batch = db.batch();
  for (const reference of references) {
    batch.delete(reference);
  }
  await batch.commit();
}

async function deliverNotificationToActivePartner(
  pairId: string,
  actorUid: string,
  type: NeutralNotificationType,
): Promise<void> {
  const pairSnapshot = await db.doc(`pairs/${pairId}`).get();
  const pair = pairSnapshot.data();
  if (pair?.status !== "active") {
    return;
  }
  let members: readonly [string, string];
  try {
    members = pairMembers(pair);
  } catch {
    return;
  }
  if (!members.includes(actorUid)) {
    return;
  }
  const recipientUid = members[0] === actorUid ? members[1] : members[0];
  const deviceSnapshot = await db
    .collection(`users/${recipientUid}/notificationDevices`)
    .limit(NOTIFICATION_DEVICE_LIMIT)
    .get();
  const now = new Date();
  const invalidDocuments: DocumentReference<DocumentData>[] = [];
  const deliverable = deviceSnapshot.docs.flatMap(snapshot => {
    const device = storedNotificationDevice(snapshot.data());
    if (device === null) {
      invalidDocuments.push(snapshot.ref);
      return [];
    }
    return isWithinQuietHours(device.quietHours, now)
      ? []
      : [{reference: snapshot.ref, token: device.token}];
  });

  if (deliverable.length === 0) {
    await deleteNotificationDeviceReferences(invalidDocuments);
    return;
  }

  const content = neutralNotificationContent(type);
  try {
    const response = await messaging.sendEachForMulticast({
      tokens: deliverable.map(device => device.token),
      notification: content.notification,
      data: {...content.data},
      android: {notification: {channelId: "cyclepair_updates"}},
    });
    response.responses.forEach((sendResponse, index) => {
      if (
        !sendResponse.success &&
        isInvalidRegistrationTokenCode(sendResponse.error?.code)
      ) {
        const reference = deliverable[index]?.reference;
        if (reference !== undefined) {
          invalidDocuments.push(reference);
        }
      }
    });
  } catch (error) {
    logger.warn("Neutral notification delivery failed.", {
      code: safeExternalErrorCode(error),
    });
  }
  await deleteNotificationDeviceReferences(invalidDocuments);
}

async function notifyActivePartner(
  pairId: string,
  actorUid: string,
  type: NeutralNotificationType,
): Promise<void> {
  try {
    await deliverNotificationToActivePartner(pairId, actorUid, type);
  } catch (error) {
    // Notification delivery is best-effort and must not turn a committed,
    // idempotent product mutation into a client-visible failure. No actor,
    // recipient, token, Pair, or content value is included in this log.
    logger.warn("Neutral notification processing failed.", {
      code: safeExternalErrorCode(error),
    });
  }
}

async function cleanupPairScopedData(
  pairRef: DocumentReference<DocumentData>,
): Promise<void> {
  await Promise.all([
    db.recursiveDelete(pairRef.collection("events")),
    db.recursiveDelete(pairRef.collection("eventMutations")),
    db.recursiveDelete(pairRef.collection("nudgeInboxes")),
    db.recursiveDelete(pairRef.collection("nudgeSenders")),
  ]);
}

interface BoundedDocuments {
  readonly documents: readonly QueryDocumentSnapshot<DocumentData>[];
  readonly truncated: boolean;
}

interface ExportedDocument {
  readonly id: string;
  readonly data: unknown;
}

function accountPolicy<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof AccountPolicyError) {
      throw new HttpsError(error.code, error.message);
    }
    throw error;
  }
}

function optionalRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function accountDeletionAuthFacts(
  request: CallableRequest<unknown>,
  uid: string,
): {
  readonly uid: string;
  readonly signInProvider: string | undefined;
  readonly seoriGuest: boolean;
  readonly authTimeSeconds: number | undefined;
} {
  const token = optionalRecord(request.auth?.token);
  const firebase = optionalRecord(token?.firebase);
  const signInProvider = firebase?.sign_in_provider;
  const seoriGuest = token?.seori_guest;
  const authTimeSeconds = token?.auth_time;

  return {
    uid,
    signInProvider:
      typeof signInProvider === "string" ? signInProvider : undefined,
    seoriGuest: seoriGuest === true,
    authTimeSeconds:
      typeof authTimeSeconds === "number" ? authTimeSeconds : undefined,
  };
}

async function readBoundedDocuments(
  query: Query<DocumentData>,
  limit: number,
): Promise<BoundedDocuments> {
  const snapshot = await query.limit(limit + 1).get();
  const documents = [...snapshot.docs]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, limit);
  return {documents, truncated: snapshot.size > limit};
}

function exportDocument(
  snapshot: DocumentSnapshot<DocumentData>,
): ExportedDocument {
  return {id: snapshot.id, data: toJsonSafe(snapshot.data() ?? {})};
}

async function exportActivePair(
  uid: string,
  pairId: string,
  consentSnapshot: QueryDocumentSnapshot<DocumentData> | undefined,
): Promise<JsonRecord | null> {
  const pairRef = db.doc(`pairs/${pairId}`);
  const pairSnapshot = await pairRef.get();
  const pair = pairSnapshot.data();
  if (pair?.status !== "active") {
    return null;
  }
  const members = pairMembers(pair);
  if (!members.includes(uid)) {
    return null;
  }

  const [eventDocuments, projectionSnapshot] = await Promise.all([
    readBoundedDocuments(
      pairRef.collection("events"),
      ACCOUNT_EXPORT_LIMITS.eventsPerPair,
    ),
    pairRef.collection("projections").doc(uid).get(),
  ]);
  const consent = consentSnapshot?.data();
  const projection = projectionSnapshot.data();

  return {
    pairId,
    pair: exportDocument(pairSnapshot),
    sharedEvents: {
      documents: eventDocuments.documents.map(exportDocument),
      truncated: eventDocuments.truncated,
    },
    myProjection: projectionSnapshot.exists
      ? exportDocument(projectionSnapshot)
      : null,
    consentMetadata: {
      enabledFields: enabledConsentFields(consent),
      shareSettings: consentSnapshot === undefined
        ? null
        : exportDocument(consentSnapshot),
      projectionSchemaVersion:
        typeof projection?.schemaVersion === "number"
          ? projection.schemaVersion
          : null,
      projectionGeneratedAt: toJsonSafe(projection?.generatedAt) ?? null,
    },
  };
}

async function buildAccountDataExport(uid: string): Promise<JsonRecord> {
  const [privateCycles, privateDailyLogs, shareSettings, pairMemberships] =
    await Promise.all([
      readBoundedDocuments(
        db.collection(`users/${uid}/privateCycles`),
        ACCOUNT_EXPORT_LIMITS.privateCycles,
      ),
      readBoundedDocuments(
        db.collection(`users/${uid}/privateDailyLogs`),
        ACCOUNT_EXPORT_LIMITS.privateDailyLogs,
      ),
      readBoundedDocuments(
        db.collection(`users/${uid}/shareSettings`),
        ACCOUNT_EXPORT_LIMITS.shareSettings,
      ),
      readBoundedDocuments(
        db.collection(`users/${uid}/pairMemberships`),
        ACCOUNT_EXPORT_LIMITS.pairMemberships,
      ),
    ]);

  const consentByPairId = new Map(
    shareSettings.documents.map(snapshot => [snapshot.id, snapshot] as const),
  );
  const activePairIds = [...new Set(
    pairMemberships.documents.flatMap(snapshot => {
      const membership = snapshot.data();
      if (membership.status !== "active") {
        return [];
      }
      const pairId = typeof membership.pairId === "string"
        ? membership.pairId
        : snapshot.id;
      return [pairId];
    }),
  )].sort();
  const selectedPairIds = activePairIds.slice(
    0,
    ACCOUNT_EXPORT_LIMITS.activePairs,
  );
  const activePairs = (await Promise.all(
    selectedPairIds.map(pairId =>
      exportActivePair(uid, pairId, consentByPairId.get(pairId)),
    ),
  )).filter((value): value is JsonRecord => value !== null);

  return {
    schemaVersion: ACCOUNT_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exportSubjectUid: uid,
    limits: ACCOUNT_EXPORT_LIMITS,
    data: {
      privateCycles: {
        documents: privateCycles.documents.map(exportDocument),
        truncated: privateCycles.truncated,
      },
      privateDailyLogs: {
        documents: privateDailyLogs.documents.map(exportDocument),
        truncated: privateDailyLogs.truncated,
      },
      shareSettings: {
        documents: shareSettings.documents.map(exportDocument),
        truncated: shareSettings.truncated,
      },
      pairMemberships: {
        documents: pairMemberships.documents.map(exportDocument),
        truncated: pairMemberships.truncated,
      },
      activePairs,
    },
    truncated: {
      privateCycles: privateCycles.truncated,
      privateDailyLogs: privateDailyLogs.truncated,
      shareSettings: shareSettings.truncated,
      pairMemberships: pairMemberships.truncated,
      activePairs: activePairIds.length > ACCOUNT_EXPORT_LIMITS.activePairs,
      sharedEvents: activePairs.some(pair =>
        optionalRecord(pair.sharedEvents)?.truncated === true,
      ),
    },
  };
}

export const createPairInvite = onCall(callableOptions, async request => {
  const inviterUid = requireAuth(request);
  const data = asRecord(request.data);
  const recordsCycle = requireBoolean(data, "recordsCycle");
  const token = randomBytes(32).toString("base64url");
  const hash = inviteHash(token);
  const nowMillis = Date.now();
  const now = Timestamp.fromMillis(nowMillis);
  const expiresAt = Timestamp.fromMillis(nowMillis + INVITE_TTL_MS);
  const stateRef = db.doc(`connectionStates/${inviterUid}`);
  const bindingRef = db.doc(`pairBindings/${inviterUid}`);
  const deletionStateRef = db.doc(`accountDeletionStates/${inviterUid}`);
  const inviteRef = db.doc(`pairInvites/${hash}`);

  await db.runTransaction(async transaction => {
    const [stateSnapshot, bindingSnapshot, deletionStateSnapshot] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(bindingRef),
      transaction.get(deletionStateRef),
    ]);

    if (deletionStateSnapshot.exists) {
      throw new HttpsError(
        "failed-precondition",
        "계정 삭제가 진행 중입니다.",
      );
    }
    if (bindingSnapshot.exists) {
      throw new HttpsError(
        "failed-precondition",
        "이미 활성화된 Pair가 있습니다.",
      );
    }

    const state = parseConnectionState(stateSnapshot);
    const rateDecision = evaluateInviteRateLimit(
      {
        windowStartedAtMillis: state.inviteWindowStartedAtMillis,
        count: state.inviteCount,
      },
      nowMillis,
    );
    if (!rateDecision.allowed) {
      throw new HttpsError(
        "resource-exhausted",
        "초대 생성 한도를 초과했습니다.",
        {retryAfterMillis: rateDecision.retryAfterMillis},
      );
    }

    transaction.set(
      stateRef,
      {
        inviteEpoch: state.inviteEpoch,
        inviteWindowStartedAt: Timestamp.fromMillis(
          rateDecision.nextState.windowStartedAtMillis ?? nowMillis,
        ),
        inviteCount: rateDecision.nextState.count,
        updatedAt: now,
      },
      {merge: true},
    );
    transaction.create(inviteRef, {
      inviterUid,
      inviterRecordsCycle: recordsCycle,
      inviteEpoch: state.inviteEpoch,
      status: "pending",
      createdAt: now,
      expiresAt,
    });
  });

  return {
    inviteToken: token,
    expiresAt: expiresAt.toDate().toISOString(),
  };
});

export const acceptPairInvite = onCall(callableOptions, async request => {
  const acceptingUid = requireAuth(request);
  const data = asRecord(request.data);
  const acceptingRecordsCycle = requireBoolean(data, "recordsCycle");
  const token = requireInviteToken(data);
  const hash = inviteHash(token);
  const inviteRef = db.doc(`pairInvites/${hash}`);
  const pairRef = db.collection("pairs").doc();
  const nowMillis = Date.now();
  const now = Timestamp.fromMillis(nowMillis);

  await db.runTransaction(async transaction => {
    const inviteSnapshot = await transaction.get(inviteRef);
    const invite = inviteSnapshot.data();
    if (invite === undefined || typeof invite.inviterUid !== "string") {
      throw new HttpsError("failed-precondition", "초대가 유효하지 않습니다.");
    }
    const inviterUid = invite.inviterUid;

    const inviterStateRef = db.doc(`connectionStates/${inviterUid}`);
    const acceptingStateRef = db.doc(`connectionStates/${acceptingUid}`);
    const inviterBindingRef = db.doc(`pairBindings/${inviterUid}`);
    const acceptingBindingRef = db.doc(`pairBindings/${acceptingUid}`);
    const inviterDeletionStateRef = db.doc(
      `accountDeletionStates/${inviterUid}`,
    );
    const acceptingDeletionStateRef = db.doc(
      `accountDeletionStates/${acceptingUid}`,
    );
    const [
      inviterStateSnapshot,
      acceptingStateSnapshot,
      inviterBindingSnapshot,
      acceptingBindingSnapshot,
      inviterDeletionStateSnapshot,
      acceptingDeletionStateSnapshot,
    ] = await Promise.all([
      transaction.get(inviterStateRef),
      transaction.get(acceptingStateRef),
      transaction.get(inviterBindingRef),
      transaction.get(acceptingBindingRef),
      transaction.get(inviterDeletionStateRef),
      transaction.get(acceptingDeletionStateRef),
    ]);
    const inviterState = parseConnectionState(inviterStateSnapshot);
    const acceptingState = parseConnectionState(acceptingStateSnapshot);

    if (
      !inviteIsUsable(
        {
          status: invite.status,
          inviterUid,
          inviteEpoch: invite.inviteEpoch,
          expiresAtMillis: timestampMillis(invite.expiresAt),
        },
        inviterState.inviteEpoch,
        acceptingUid,
        nowMillis,
      )
    ) {
      throw new HttpsError("failed-precondition", "초대가 유효하지 않습니다.");
    }

    if (
      inviterDeletionStateSnapshot.exists ||
      acceptingDeletionStateSnapshot.exists
    ) {
      throw new HttpsError(
        "failed-precondition",
        "두 사용자 중 한 명의 계정 삭제가 진행 중입니다.",
      );
    }

    if (inviterBindingSnapshot.exists || acceptingBindingSnapshot.exists) {
      throw new HttpsError(
        "failed-precondition",
        "두 사용자 중 한 명에게 이미 활성화된 Pair가 있습니다.",
      );
    }

    const inviterRecordsCycle = invite.inviterRecordsCycle === true;
    const requestedMembers: readonly [PairMemberInput, PairMemberInput] = [
      {uid: inviterUid, recordsCycle: inviterRecordsCycle},
      {uid: acceptingUid, recordsCycle: acceptingRecordsCycle},
    ];
    const [inviterProjection, acceptingProjection] = await Promise.all([
      projectionForMember(transaction, requestedMembers[0], pairRef.id, now),
      projectionForMember(transaction, requestedMembers[1], pairRef.id, now),
    ]);
    const members: readonly [PairMemberInput, PairMemberInput] = [
      {uid: inviterUid, recordsCycle: inviterProjection.recordsCycle},
      {uid: acceptingUid, recordsCycle: acceptingProjection.recordsCycle},
    ];
    const memberUids = members.map(member => member.uid);

    transaction.create(pairRef, {
      status: "active",
      memberUids,
      members: {
        [inviterUid]: {recordsCycle: inviterRecordsCycle},
        [acceptingUid]: {recordsCycle: acceptingRecordsCycle},
      },
      createdAt: now,
      updatedAt: now,
    });
    transaction.create(
      pairRef.collection("projections").doc(inviterUid),
      inviterProjection.document,
    );
    transaction.create(
      pairRef.collection("projections").doc(acceptingUid),
      acceptingProjection.document,
    );
    transaction.create(inviterBindingRef, {pairId: pairRef.id, createdAt: now});
    transaction.create(acceptingBindingRef, {pairId: pairRef.id, createdAt: now});

    for (const member of members) {
      const partnerUid = member.uid === inviterUid ? acceptingUid : inviterUid;
      transaction.set(
        db.doc(`users/${member.uid}/pairMemberships/${pairRef.id}`),
        {
          pairId: pairRef.id,
          status: "active",
          memberUids,
          partnerUid,
          recordsCycle: member.recordsCycle,
          createdAt: now,
          updatedAt: now,
        },
      );
    }

    transaction.update(inviteRef, {
      status: "accepted",
      acceptedBy: acceptingUid,
      acceptedAt: now,
    });
    transaction.set(
      inviterStateRef,
      {inviteEpoch: inviterState.inviteEpoch + 1, updatedAt: now},
      {merge: true},
    );
    transaction.set(
      acceptingStateRef,
      {inviteEpoch: acceptingState.inviteEpoch + 1, updatedAt: now},
      {merge: true},
    );
  });

  return {pairId: pairRef.id};
});

export const registerNotificationDevice = onCall(
  callableOptions,
  async request => {
    const uid = requireAuth(request);
    const registration = notificationPolicy(() =>
      parseNotificationDeviceInput(request.data),
    );
    const deviceId = notificationTokenHash(registration.token);
    const deviceRef = db.doc(
      `users/${uid}/notificationDevices/${deviceId}`,
    );
    const devices = db.collection(`users/${uid}/notificationDevices`);
    const deletionStateRef = db.doc(`accountDeletionStates/${uid}`);
    const now = Timestamp.now();

    await db.runTransaction(async transaction => {
      const [deletionState, existing, deviceSnapshot] = await Promise.all([
        transaction.get(deletionStateRef),
        transaction.get(deviceRef),
        transaction.get(devices.limit(NOTIFICATION_DEVICE_LIMIT + 1)),
      ]);
      if (deletionState.exists) {
        throw new HttpsError(
          "failed-precondition",
          "계정 삭제가 진행 중입니다.",
        );
      }
      if (!existing.exists && deviceSnapshot.size >= NOTIFICATION_DEVICE_LIMIT) {
        throw new HttpsError(
          "resource-exhausted",
          "등록 가능한 알림 기기 수를 초과했습니다.",
        );
      }
      const createdAt = existing.data()?.createdAt;
      transaction.set(deviceRef, {
        schemaVersion: NOTIFICATION_SCHEMA_VERSION,
        token: registration.token,
        tokenHash: deviceId,
        platform: registration.platform,
        locale: registration.locale,
        quietHours: registration.quietHours,
        createdAt: createdAt instanceof Timestamp ? createdAt : now,
        updatedAt: now,
      });
    });

    return {registered: true};
  },
);

export const unregisterNotificationDevice = onCall(
  callableOptions,
  async request => {
    const uid = requireAuth(request);
    const data = asRecord(request.data);
    if (Object.keys(data).length !== 1 || !("token" in data)) {
      throw new HttpsError("invalid-argument", "요청 형식이 올바르지 않습니다.");
    }
    const token = notificationPolicy(() => parseNotificationToken(data.token));
    const deviceRef = db.doc(
      `users/${uid}/notificationDevices/${notificationTokenHash(token)}`,
    );
    const removed = await db.runTransaction(async transaction => {
      const [snapshot, deletionState] = await Promise.all([
        transaction.get(deviceRef),
        transaction.get(db.doc(`accountDeletionStates/${uid}`)),
      ]);
      requireAccountMutationAllowed(deletionState);
      if (!snapshot.exists) {
        return false;
      }
      if (snapshot.data()?.token !== token) {
        throw new HttpsError(
          "failed-precondition",
          "알림 토큰을 해제할 수 없습니다.",
        );
      }
      transaction.delete(deviceRef);
      return true;
    });

    return {unregistered: true, removed};
  },
);

export const sendPartnerNudge = onCall(callableOptions, async request => {
  const uid = requireAuth(request);
  const data = asRecord(request.data);
  if (
    Object.keys(data).length !== 3 ||
    !("pairId" in data) ||
    !("requestId" in data) ||
    !("type" in data)
  ) {
    throw new HttpsError("invalid-argument", "요청 형식이 올바르지 않습니다.");
  }
  const pairId = requireDocumentId(data, "pairId");
  const requestId = requireDocumentId(data, "requestId");
  let type: PartnerNudgeType;
  try {
    type = parsePartnerNudgeType(data.type);
  } catch {
    throw new HttpsError("invalid-argument", "넛지 종류가 올바르지 않습니다.");
  }

  const pairRef = db.doc(`pairs/${pairId}`);
  const senderRef = pairRef.collection("nudgeSenders").doc(uid);
  const deletionStateRef = db.doc(`accountDeletionStates/${uid}`);
  const now = Timestamp.now();
  const fields = partnerNudgeCooldownFields(type);

  const result = await db.runTransaction(async transaction => {
    const [pairSnapshot, senderSnapshot, deletionStateSnapshot] =
      await Promise.all([
        transaction.get(pairRef),
        transaction.get(senderRef),
        transaction.get(deletionStateRef),
      ]);
    requireAccountMutationAllowed(deletionStateSnapshot);
    const members = requireActivePairMember(pairSnapshot.data(), uid);
    const recipientUid = members[0] === uid ? members[1] : members[0];
    const sender = senderSnapshot.data();
    const previousRequestId = sender?.[fields.requestId];
    const previousNextAllowedAtMillis = timestampMillis(
      sender?.[fields.nextAllowedAt],
    );
    const decision = evaluatePartnerNudgeCooldown(
      {
        ...(typeof previousRequestId === "string"
          ? {requestId: previousRequestId}
          : {}),
        ...(previousNextAllowedAtMillis !== null
          ? {nextAllowedAtMillis: previousNextAllowedAtMillis}
          : {}),
      },
      requestId,
      now.toMillis(),
    );

    if (decision.kind === "blocked") {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((decision.nextAllowedAtMillis - now.toMillis()) / 1_000),
      );
      throw new HttpsError(
        "resource-exhausted",
        "같은 넛지는 30분 뒤에 다시 보낼 수 있습니다.",
        {
          retryAfterSeconds,
          nextAllowedAt: new Date(decision.nextAllowedAtMillis).toISOString(),
        },
      );
    }

    const sentAt = decision.kind === "idempotent"
      ? (sender?.[fields.sentAt] instanceof Timestamp
        ? sender[fields.sentAt] as Timestamp
        : now)
      : now;
    const nextAllowedAt = Timestamp.fromMillis(decision.nextAllowedAtMillis);
    if (decision.kind === "allowed") {
      transaction.set(senderRef, {
        schemaVersion: PARTNER_NUDGE_SCHEMA_VERSION,
        senderUid: uid,
        [fields.requestId]: requestId,
        [fields.sentAt]: sentAt,
        [fields.nextAllowedAt]: nextAllowedAt,
        updatedAt: now,
      }, {merge: true});
      transaction.set(
        pairRef.collection("nudgeInboxes").doc(recipientUid),
        {
          schemaVersion: PARTNER_NUDGE_SCHEMA_VERSION,
          requestId,
          senderUid: uid,
          recipientUid,
          type,
          sentAt,
        },
      );
    }

    return {
      sentAt: sentAt.toDate().toISOString(),
      nextAllowedAt: nextAllowedAt.toDate().toISOString(),
      alreadyApplied: decision.kind === "idempotent",
    };
  });

  if (!result.alreadyApplied) {
    await notifyActivePartner(pairId, uid, "partner-nudge");
  }
  return {
    requestId,
    type,
    sentAt: result.sentAt,
    nextAllowedAt: result.nextAllowedAt,
    alreadyApplied: result.alreadyApplied,
  };
});

export const acknowledgePartnerNudge = onCall(
  callableOptions,
  async request => {
    const uid = requireAuth(request);
    const data = asRecord(request.data);
    if (
      Object.keys(data).length !== 2 ||
      !("pairId" in data) ||
      !("requestId" in data)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "요청 형식이 올바르지 않습니다.",
      );
    }
    const pairId = requireDocumentId(data, "pairId");
    const requestId = requireDocumentId(data, "requestId");
    const pairRef = db.doc(`pairs/${pairId}`);
    const inboxRef = pairRef.collection("nudgeInboxes").doc(uid);
    const deletionStateRef = db.doc(`accountDeletionStates/${uid}`);

    const acknowledged = await db.runTransaction(async transaction => {
      const [pairSnapshot, inboxSnapshot, deletionStateSnapshot] =
        await Promise.all([
          transaction.get(pairRef),
          transaction.get(inboxRef),
          transaction.get(deletionStateRef),
        ]);
      requireAccountMutationAllowed(deletionStateSnapshot);
      requireActivePairMember(pairSnapshot.data(), uid);
      const inbox = inboxSnapshot.data();
      if (
        !inboxSnapshot.exists ||
        inbox?.recipientUid !== uid ||
        inbox?.requestId !== requestId
      ) {
        return false;
      }
      transaction.delete(inboxRef);
      return true;
    });

    return {requestId, acknowledged};
  },
);

export const getPurchaseAccountToken = onCall(
  callableOptions,
  async request => {
    const uid = requireAuth(request);
    try {
      return await subscriptionService.getPurchaseAccountToken(uid);
    } catch (error) {
      if (error instanceof SubscriptionPolicyError) {
        throw new HttpsError(error.code, error.message);
      }
      throw new HttpsError(
        "internal",
        "구매 계정 토큰을 준비할 수 없습니다.",
      );
    }
  },
);

export const verifySubscriptionPurchase = onCall(
  {...callableOptions, secrets: [...APPLE_IAP_SECRETS]},
  async request => {
    const uid = requireAuth(request);
    try {
      const verificationRequest = parseVerifySubscriptionRequest(request.data);
      return await subscriptionService.verifySubscriptionPurchase(
        uid,
        verificationRequest,
      );
    } catch (error) {
      if (error instanceof SubscriptionPolicyError) {
        return {verified: false as const, reason: error.reason};
      }
      return {verified: false as const, reason: "unknown" as const};
    }
  },
);

/**
 * Google Play RTDN contains only a change signal. The handler always calls
 * purchases.subscriptionsv2.get before updating the normalized snapshot.
 */
export const handleGooglePlaySubscriptionRtdn = onMessagePublished(
  {
    topic: "cyclepair-google-play-rtdn",
    timeoutSeconds: 60,
    maxInstances: 10,
  },
  async event => {
    await subscriptionService.processGoogleNotification(
      event.data.message.data,
      event.data.message.messageId,
    );
  },
);

/** Apple retries non-2xx responses; no payload, JWS, token, or UID is logged. */
export const handleAppStoreServerNotificationV2 = onRequest(
  {
    invoker: "public",
    cors: false,
    timeoutSeconds: 60,
    maxInstances: 10,
    secrets: [...APPLE_IAP_SECRETS],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Method Not Allowed");
      return;
    }
    const body = optionalRecord(request.body);
    const signedPayload = body?.signedPayload;
    if (
      typeof signedPayload !== "string" ||
      signedPayload.length === 0 ||
      signedPayload.length > 131_072
    ) {
      response.status(400).send("Invalid notification");
      return;
    }
    try {
      await subscriptionService.processAppleNotification(signedPayload);
      response.status(200).send("OK");
    } catch (error) {
      const policyError = error instanceof SubscriptionPolicyError
        ? error
        : undefined;
      const status = policyError === undefined || policyError.reason === "unknown"
        ? 503
        : 400;
      response.status(status).send(
        status === 503 ? "Verification unavailable" : "Invalid notification",
      );
    }
  },
);

export const upsertPairEvent = onCall(callableOptions, async request => {
  const uid = requireAuth(request);
  const data = asRecord(request.data);
  const pairId = requireDocumentId(data, "pairId");
  const mutationId = requireDocumentId(data, "mutationId");
  const event = requirePairEvent(data.event);
  const pairRef = db.doc(`pairs/${pairId}`);
  const eventRef = pairRef.collection("events").doc(event.id);
  const mutationRef = pairRef.collection("eventMutations").doc(mutationId);
  const deletionStateRef = db.doc(`accountDeletionStates/${uid}`);
  const payloadHash = pairEventMutationHash("upsert", event.id, event);

  const result = await db.runTransaction(async transaction => {
    const [
      pairSnapshot,
      mutationSnapshot,
      eventSnapshot,
      deletionStateSnapshot,
    ] = await Promise.all([
      transaction.get(pairRef),
      transaction.get(mutationRef),
      transaction.get(eventRef),
      transaction.get(deletionStateRef),
    ]);
    requireAccountMutationAllowed(deletionStateSnapshot);
    requireActivePairMember(pairSnapshot.data(), uid);

    if (mutationSnapshot.exists) {
      requireMatchingMutationReceipt(
        mutationSnapshot.data(),
        uid,
        "upsert",
        event.id,
        payloadHash,
      );
      return {alreadyApplied: true};
    }

    const existing = eventSnapshot.data();
    const now = Timestamp.now();
    const createdAt =
      existing?.createdAt instanceof Timestamp ? existing.createdAt : now;
    const createdBy =
      typeof existing?.createdBy === "string" ? existing.createdBy : uid;

    transaction.set(eventRef, {
      title: event.title,
      date: event.date,
      ...(event.startTime === undefined ? {} : {startTime: event.startTime}),
      ...(event.endTime === undefined ? {} : {endTime: event.endTime}),
      ...(event.note === undefined ? {} : {note: event.note}),
      createdBy,
      updatedBy: uid,
      mutationId,
      createdAt,
      updatedAt: now,
      schemaVersion: 1,
    });
    transaction.create(mutationRef, {
      operation: "upsert",
      eventId: event.id,
      actorUid: uid,
      payloadHash,
      completedAt: now,
    });

    return {alreadyApplied: false};
  });

  if (shouldSendEventNotification(result.alreadyApplied, true)) {
    await notifyActivePartner(pairId, uid, "shared-event-update");
  }

  return {pairId, eventId: event.id, mutationId, ...result};
});

export const deletePairEvent = onCall(callableOptions, async request => {
  const uid = requireAuth(request);
  const data = asRecord(request.data);
  const pairId = requireDocumentId(data, "pairId");
  const eventId = requireDocumentId(data, "eventId");
  const mutationId = requireDocumentId(data, "mutationId");
  const pairRef = db.doc(`pairs/${pairId}`);
  const eventRef = pairRef.collection("events").doc(eventId);
  const mutationRef = pairRef.collection("eventMutations").doc(mutationId);
  const deletionStateRef = db.doc(`accountDeletionStates/${uid}`);
  const payloadHash = pairEventMutationHash("delete", eventId);

  const result = await db.runTransaction(async transaction => {
    const [
      pairSnapshot,
      mutationSnapshot,
      eventSnapshot,
      deletionStateSnapshot,
    ] = await Promise.all([
      transaction.get(pairRef),
      transaction.get(mutationRef),
      transaction.get(eventRef),
      transaction.get(deletionStateRef),
    ]);
    requireAccountMutationAllowed(deletionStateSnapshot);
    requireActivePairMember(pairSnapshot.data(), uid);

    if (mutationSnapshot.exists) {
      const receipt = mutationSnapshot.data();
      requireMatchingMutationReceipt(
        receipt,
        uid,
        "delete",
        eventId,
        payloadHash,
      );
      return {alreadyApplied: true, deleted: receipt?.deleted === true};
    }

    const now = Timestamp.now();
    if (eventSnapshot.exists) {
      transaction.delete(eventRef);
    }
    transaction.create(mutationRef, {
      operation: "delete",
      eventId,
      actorUid: uid,
      payloadHash,
      deleted: eventSnapshot.exists,
      completedAt: now,
    });

    return {alreadyApplied: false, deleted: eventSnapshot.exists};
  });

  if (shouldSendEventNotification(result.alreadyApplied, result.deleted)) {
    await notifyActivePartner(pairId, uid, "shared-event-update");
  }

  return {pairId, eventId, mutationId, ...result};
});

function accountExportDownloadBaseUrl(): string {
  const configured = process.env.ACCOUNT_EXPORT_DOWNLOAD_BASE_URL;
  if (configured !== undefined) {
    try {
      const url = new URL(configured);
      if (
        url.protocol !== "https:" ||
        url.username.length > 0 ||
        url.password.length > 0 ||
        url.search.length > 0 ||
        url.hash.length > 0
      ) {
        throw new Error("invalid download URL");
      }
      return url.toString().replace(/\/$/, "");
    } catch {
      throw new HttpsError(
        "internal",
        "내보내기 다운로드 주소가 올바르게 설정되지 않았습니다.",
      );
    }
  }

  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (
    typeof projectId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{3,61}[a-z0-9]$/.test(projectId)
  ) {
    throw new HttpsError(
      "internal",
      "내보내기 다운로드 주소를 확인할 수 없습니다.",
    );
  }
  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/downloadAccountDataExport`;
}

export const requestAccountDataExport = onCall(
  callableOptions,
  async request => {
    const authenticatedUid = requireAuth(request);
    const data = asRecord(request.data);
    const uid = accountPolicy(() =>
      authorizeAccountExport(authenticatedUid, data.uid),
    );
    accountPolicy(() =>
      authorizeRecentDurableAccount(
        accountDeletionAuthFacts(request, uid),
        Math.floor(Date.now() / 1_000),
      ),
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ACCOUNT_EXPORT_TICKET_TTL_MS);
    const token = randomBytes(ACCOUNT_EXPORT_TOKEN_BYTES).toString("base64url");
    const tokenHash = accountExportTokenHash(token);
    const ticketRef = db.doc(`accountExportTickets/${tokenHash}`);
    const stateRef = db.doc(`accountExportStates/${uid}`);
    const deletionStateRef = db.doc(`accountDeletionStates/${uid}`);

    await db.runTransaction(async transaction => {
      const [stateSnapshot, deletionStateSnapshot] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(deletionStateRef),
      ]);
      if (deletionStateSnapshot.exists) {
        throw new HttpsError(
          "failed-precondition",
          "계정 삭제가 진행 중입니다.",
        );
      }
      const activeTicketHash = stateSnapshot.data()?.activeTicketHash;
      if (
        typeof activeTicketHash === "string" &&
        /^[a-f0-9]{64}$/.test(activeTicketHash) &&
        activeTicketHash !== tokenHash
      ) {
        transaction.delete(db.doc(`accountExportTickets/${activeTicketHash}`));
      }
      transaction.create(ticketRef, {
        schemaVersion: ACCOUNT_EXPORT_TICKET_SCHEMA_VERSION,
        uid,
        createdAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(expiresAt),
      });
      transaction.set(stateRef, {
        schemaVersion: ACCOUNT_EXPORT_TICKET_SCHEMA_VERSION,
        uid,
        activeTicketHash: tokenHash,
        expiresAt: Timestamp.fromDate(expiresAt),
        updatedAt: Timestamp.fromDate(now),
      });
    });

    return {
      schemaVersion: ACCOUNT_EXPORT_TICKET_SCHEMA_VERSION,
      exportSubjectUid: uid,
      expiresAt: expiresAt.toISOString(),
      filename: accountExportFilename(now),
      singleUse: true,
      // The token stays in the fragment: browsers do not send it in the GET
      // request URL or Referer. The bootstrap moves it into a same-origin
      // Authorization header for the one download POST.
      downloadUrl: `${accountExportDownloadBaseUrl()}#token=${encodeURIComponent(token)}`,
    };
  },
);

function setAccountExportNoStoreHeaders(
  response: {set(headers: Record<string, string>): unknown},
): void {
  response.set({
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
}

function accountExportBootstrapHtml(nonce: string): string {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>사이클 페어 데이터 내보내기</title></head>
<body><main><h1>사이클 페어 데이터 내보내기</h1><p id="status">보안 다운로드를 준비하고 있습니다.</p></main>
<script nonce="${nonce}">
(async()=>{const status=document.getElementById("status");const params=new URLSearchParams(location.hash.slice(1));const token=params.get("token");history.replaceState(null,"",location.pathname);if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token)){status.textContent="다운로드 링크가 올바르지 않습니다.";return;}try{const response=await fetch(location.pathname,{method:"POST",headers:{Authorization:"Bearer "+token,Accept:"application/json"},cache:"no-store",credentials:"omit"});if(!response.ok){throw new Error("download rejected");}const blob=await response.blob();const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=response.headers.get("x-cycle-pair-filename")||"cycle-pair-data-export.json";document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);status.textContent="다운로드를 시작했습니다. 이 링크는 다시 사용할 수 없습니다.";}catch{status.textContent="링크가 만료되었거나 이미 사용되었습니다. 앱에서 새 링크를 요청해 주세요.";}})();
</script></body></html>`;
}

async function consumeAccountExportTicket(token: string): Promise<string> {
  const tokenHash = accountExportTokenHash(token);
  const ticketRef = db.doc(`accountExportTickets/${tokenHash}`);
  return db.runTransaction(async transaction => {
    const ticketSnapshot = await transaction.get(ticketRef);
    const ticket = ticketSnapshot.data();
    const expiresAt = ticket?.expiresAt;
    const uid = authorizeAccountExportTicket({
      schemaVersion: ticket?.schemaVersion,
      uid: ticket?.uid,
      expiresAtMillis:
        expiresAt instanceof Timestamp ? expiresAt.toMillis() : undefined,
    }, Date.now());
    const stateRef = db.doc(`accountExportStates/${uid}`);
    const [stateSnapshot, deletionStateSnapshot] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(db.doc(`accountDeletionStates/${uid}`)),
    ]);
    requireAccountMutationAllowed(deletionStateSnapshot);
    transaction.delete(ticketRef);
    if (stateSnapshot.data()?.activeTicketHash === tokenHash) {
      transaction.delete(stateRef);
    }
    return uid;
  });
}

export const downloadAccountDataExport = onRequest(
  {
    invoker: "public",
    timeoutSeconds: 60,
    cors: false,
  },
  async (request, response) => {
    setAccountExportNoStoreHeaders(response);
    if (request.method === "GET") {
      const nonce = randomBytes(18).toString("base64");
      response.set(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      );
      response.status(200).type("html").send(accountExportBootstrapHtml(nonce));
      return;
    }
    if (request.method !== "POST") {
      response.set("Allow", "GET, POST");
      response.status(405).type("text/plain").send("Method not allowed");
      return;
    }

    const authorization = request.header("authorization") ?? "";
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
    if (match?.[1] === undefined) {
      response.status(404).type("text/plain").send("Download unavailable");
      return;
    }

    try {
      const uid = await consumeAccountExportTicket(match[1]);
      const exportedAt = new Date();
      const filename = accountExportFilename(exportedAt);
      const payload = await buildAccountDataExport(uid);
      response.set({
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Cycle-Pair-Filename": filename,
      });
      response.status(200).send(JSON.stringify(payload, null, 2));
    } catch (error) {
      if (error instanceof AccountPolicyError) {
        response.status(404).type("text/plain").send("Download unavailable");
        return;
      }
      throw error;
    }
  },
);

export const cleanupExpiredAccountExportTickets = onSchedule(
  {schedule: "every 15 minutes", timeoutSeconds: 60},
  async () => {
    const now = Timestamp.now();
    const expired = await db
      .collection("accountExportTickets")
      .where("expiresAt", "<=", now)
      .limit(200)
      .get();
    for (let index = 0; index < expired.docs.length; index += 20) {
      await Promise.all(expired.docs.slice(index, index + 20).map(snapshot =>
        db.runTransaction(async transaction => {
          const current = await transaction.get(snapshot.ref);
          const expiresAt = current.data()?.expiresAt;
          if (!(expiresAt instanceof Timestamp) || expiresAt.toMillis() > Date.now()) {
            return;
          }
          const uid = current.data()?.uid;
          let stateRef: DocumentReference<DocumentData> | undefined;
          let stateSnapshot: DocumentSnapshot<DocumentData> | undefined;
          if (typeof uid === "string" && uid.length > 0) {
            stateRef = db.doc(`accountExportStates/${uid}`);
            stateSnapshot = await transaction.get(stateRef);
          }
          transaction.delete(snapshot.ref);
          if (
            stateRef !== undefined &&
            stateSnapshot?.data()?.activeTicketHash === snapshot.id
          ) {
            transaction.delete(stateRef);
          }
        }),
      ));
    }
  },
);

export const cleanupExpiredPairRetentionData = onSchedule(
  {
    schedule: RETENTION_CLEANUP_SCHEDULE,
    timeZone: RETENTION_CLEANUP_TIME_ZONE,
    timeoutSeconds: 120,
    maxInstances: 1,
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 3_600,
  },
  async () => {
    const report = await cleanupExpiredPairArtifacts(db, Date.now());
    logger.info("Pair artifact retention cleanup completed.", report);
  },
);

interface PairRevocationResult {
  readonly pairId: string;
  readonly revokedAt: string;
  readonly alreadyRevoked: boolean;
  readonly missing: boolean;
}

async function revokePairAccess(
  requestingUid: string,
  pairId: string,
  allowMissing: boolean,
): Promise<PairRevocationResult> {
  const pairRef = db.doc(`pairs/${pairId}`);
  const now = Timestamp.now();

  const result = await db.runTransaction(async transaction => {
    const [pairSnapshot, deletionStateSnapshot] = await Promise.all([
      transaction.get(pairRef),
      transaction.get(db.doc(`accountDeletionStates/${requestingUid}`)),
    ]);
    if (!allowMissing) {
      requireAccountMutationAllowed(deletionStateSnapshot);
    }
    const pair = pairSnapshot.data();
    if (pair === undefined) {
      if (allowMissing) {
        return {alreadyRevoked: true, missing: true};
      }
      throw new HttpsError("not-found", "Pair를 찾을 수 없습니다.");
    }

    const members = pairMembers(pair);
    if (!members.includes(requestingUid)) {
      throw new HttpsError("permission-denied", "Pair 멤버만 해제할 수 있습니다.");
    }
    if (pair.status === "revoked") {
      return {alreadyRevoked: true, missing: false};
    }
    if (pair.status !== "active") {
      throw new HttpsError("failed-precondition", "활성 Pair가 아닙니다.");
    }

    const cleanup = buildPairCleanupInventory(pairId, members);
    const bindingRefs = cleanup.bindingDocumentPaths.map(path => db.doc(path));
    const stateRefs = cleanup.connectionStateDocumentPaths.map(path =>
      db.doc(path),
    );
    const [bindingSnapshots, stateSnapshots] = await Promise.all([
      Promise.all(bindingRefs.map(ref => transaction.get(ref))),
      Promise.all(stateRefs.map(ref => transaction.get(ref))),
    ]);

    transaction.update(pairRef, {
      status: "revoked",
      revokedAt: now,
      revokedBy: requestingUid,
      updatedAt: now,
    });
    for (const path of cleanup.projectionDocumentPaths) {
      transaction.delete(db.doc(path));
    }
    for (const path of cleanup.shareSettingsDocumentPaths) {
      transaction.delete(db.doc(path));
    }

    transaction.set(db.doc(cleanup.pairTombstoneDocumentPath), {
      pairId,
      memberUids: members,
      revokedAt: now,
      revokedBy: requestingUid,
    });

    members.forEach((_, index) => {
      const partnerUid = members[index === 0 ? 1 : 0];
      const binding = bindingSnapshots[index]?.data();
      const state = parseConnectionState(stateSnapshots[index]!);

      if (binding?.pairId === pairId) {
        transaction.delete(bindingRefs[index]!);
      }
      transaction.set(
        db.doc(cleanup.membershipDocumentPaths[index]!),
        {status: "revoked", revokedAt: now, updatedAt: now},
        {merge: true},
      );
      transaction.set(db.doc(cleanup.cacheTombstoneDocumentPaths[index]!), {
        type: "pair-revoked",
        pairId,
        formerPartnerUid: partnerUid,
        projectionOwnerUids: members,
        status: "pending",
        createdAt: now,
      });
      transaction.set(
        stateRefs[index]!,
        {inviteEpoch: state.inviteEpoch + 1, updatedAt: now},
        {merge: true},
      );
    });

    return {alreadyRevoked: false, missing: false};
  });

  // Pair status changes inside the transaction, so Security Rules deny reads
  // immediately. Physical cleanup follows after commit and is retried when a
  // client repeats revokePair for an already-revoked Pair.
  await cleanupPairScopedData(pairRef);

  return {
    pairId,
    revokedAt: now.toDate().toISOString(),
    ...result,
  };
}

export const revokePair = onCall(callableOptions, async request => {
  const requestingUid = requireAuth(request);
  const data = asRecord(request.data);
  const pairId = requireDocumentId(data, "pairId");
  const result = await revokePairAccess(requestingUid, pairId, false);

  return {
    pairId: result.pairId,
    revokedAt: result.revokedAt,
    alreadyRevoked: result.alreadyRevoked,
  };
});

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string =>
      typeof item === "string" && item.length > 0,
    )
    : [];
}

async function prepareAccountDeletion(uid: string): Promise<readonly string[]> {
  const stateRef = db.doc(`accountDeletionStates/${uid}`);
  const bindingRef = db.doc(`pairBindings/${uid}`);
  const now = Timestamp.now();
  const transactionPairIds = await db.runTransaction(async transaction => {
    const [stateSnapshot, bindingSnapshot] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(bindingRef),
    ]);
    const pairIds = stringArray(stateSnapshot.data()?.pairIds);
    const bindingPairId = bindingSnapshot.data()?.pairId;
    if (typeof bindingPairId === "string") {
      pairIds.push(bindingPairId);
    }
    const uniquePairIds = [...new Set(pairIds)].sort();

    transaction.set(
      stateRef,
      {
        schemaVersion: ACCOUNT_DELETION_SCHEMA_VERSION,
        status: "in-progress",
        pairIds: uniquePairIds,
        requestedAt: stateSnapshot.data()?.requestedAt ?? now,
        updatedAt: now,
      },
      {merge: true},
    );
    return uniquePairIds;
  });

  // accountDeletionStates now blocks create/accept transactions. Recover a
  // binding mirror if a previous partial failure left the root binding absent.
  const activeMemberships = await readBoundedDocuments(
    db.collection(`users/${uid}/pairMemberships`).where("status", "==", "active"),
    ACCOUNT_EXPORT_LIMITS.activePairs,
  );
  if (activeMemberships.truncated) {
    throw new HttpsError(
      "resource-exhausted",
      "활성 Pair 수가 안전한 삭제 한도를 초과했습니다.",
    );
  }
  const membershipPairIds = activeMemberships.documents.map(snapshot => {
    const pairId = snapshot.data().pairId;
    return typeof pairId === "string" ? pairId : snapshot.id;
  });
  const pairIds = [...new Set([
    ...transactionPairIds,
    ...membershipPairIds,
  ])].sort();
  await stateRef.set({pairIds, updatedAt: Timestamp.now()}, {merge: true});

  return pairIds;
}

async function accountPairDocuments(
  uid: string,
): Promise<BoundedDocuments> {
  const result = await readBoundedDocuments(
    db.collection("pairs").where("memberUids", "array-contains", uid),
    ACCOUNT_DELETION_LIMITS.pairDocuments,
  );
  if (result.truncated) {
    throw new HttpsError(
      "resource-exhausted",
      "Pair 이력이 안전한 삭제 한도를 초과했습니다.",
    );
  }
  return result;
}

async function accountInviteDocumentPaths(uid: string): Promise<readonly string[]> {
  const [created, accepted] = await Promise.all([
    readBoundedDocuments(
      db.collection("pairInvites").where("inviterUid", "==", uid),
      ACCOUNT_DELETION_LIMITS.inviteDocumentsPerQuery,
    ),
    readBoundedDocuments(
      db.collection("pairInvites").where("acceptedBy", "==", uid),
      ACCOUNT_DELETION_LIMITS.inviteDocumentsPerQuery,
    ),
  ]);
  if (created.truncated || accepted.truncated) {
    throw new HttpsError(
      "resource-exhausted",
      "초대 이력이 안전한 삭제 한도를 초과했습니다.",
    );
  }

  return [...new Set([
    ...created.documents.map(snapshot => snapshot.ref.path),
    ...accepted.documents.map(snapshot => snapshot.ref.path),
  ])].sort();
}

async function accountExportTicketDocumentPaths(
  uid: string,
): Promise<readonly string[]> {
  const tickets = await readBoundedDocuments(
    db.collection("accountExportTickets").where("uid", "==", uid),
    ACCOUNT_DELETION_LIMITS.accountExportTicketDocuments,
  );
  if (tickets.truncated) {
    throw new HttpsError(
      "resource-exhausted",
      "내보내기 링크 수가 안전한 삭제 한도를 초과했습니다.",
    );
  }
  return tickets.documents.map(snapshot => snapshot.ref.path).sort();
}

async function recursivelyDeletePaths(paths: readonly string[]): Promise<void> {
  const uniquePaths = [...new Set(paths)];
  for (let index = 0; index < uniquePaths.length; index += 10) {
    await Promise.all(
      uniquePaths
        .slice(index, index + 10)
        .map(path => db.recursiveDelete(db.doc(path))),
    );
  }
}

async function sanitizeFormerPartnerMetadata(
  pairSnapshot: QueryDocumentSnapshot<DocumentData>,
  deletedUid: string,
  wasActive: boolean,
): Promise<void> {
  const pairId = pairSnapshot.id;
  const members = pairMembers(pairSnapshot.data());
  const formerPartnerUid = members.find(uid => uid !== deletedUid);
  if (formerPartnerUid === undefined) {
    return;
  }
  const now = Timestamp.now();
  const writes: Promise<unknown>[] = [
    db.doc(`users/${formerPartnerUid}/pairMemberships/${pairId}`).set({
      schemaVersion: 1,
      pairId,
      status: "revoked",
      reason: "account-deleted",
      revokedAt: now,
      updatedAt: now,
    }),
    db.doc(`users/${formerPartnerUid}/shareSettings/${pairId}`).delete(),
  ];
  if (wasActive) {
    writes.push(
      db.doc(`users/${formerPartnerUid}/cacheTombstones/${pairId}`).set({
        schemaVersion: 1,
        type: "account-deleted",
        pairId,
        status: "pending",
        createdAt: now,
      }),
    );
  }
  await Promise.all(writes);
}

function deletionReceiptHashMatches(
  storedHash: unknown,
  suppliedHash: string,
): boolean {
  if (
    typeof storedHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(storedHash) ||
    !/^[a-f0-9]{64}$/.test(suppliedHash)
  ) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(storedHash, "hex"),
    Buffer.from(suppliedHash, "hex"),
  );
}

type AccountDeletionClaim =
  | {readonly kind: "claimed"}
  | {readonly kind: "busy"}
  | {readonly kind: "completed"; readonly completedAt: string};

async function claimAccountDeletion(
  uid: string,
  receiptHash: string,
  workerId: string,
): Promise<AccountDeletionClaim> {
  const stateRef = db.doc(`accountDeletionStates/${uid}`);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef);
    const state = snapshot.data();
    if (!deletionReceiptHashMatches(state?.recoveryReceiptHash, receiptHash)) {
      throw new HttpsError("not-found", "계정 삭제 상태를 찾을 수 없습니다.");
    }
    if (state?.status === "completed") {
      const completedAt = state.completedAt;
      if (!(completedAt instanceof Timestamp)) {
        throw new HttpsError("internal", "계정 삭제 완료 상태가 손상되었습니다.");
      }
      return {kind: "completed", completedAt: completedAt.toDate().toISOString()};
    }

    const nowMillis = Date.now();
    const leaseExpiresAt = state?.leaseExpiresAt;
    if (
      state?.leaseOwner !== workerId &&
      leaseExpiresAt instanceof Timestamp &&
      leaseExpiresAt.toMillis() > nowMillis
    ) {
      return {kind: "busy"};
    }
    const now = Timestamp.fromMillis(nowMillis);
    transaction.set(stateRef, {
      schemaVersion: ACCOUNT_DELETION_SCHEMA_VERSION,
      status: state?.status === "revoking-pairs" ? "revoking-pairs" : "in-progress",
      recoveryReceipt: FieldValue.delete(),
      leaseOwner: workerId,
      leaseExpiresAt: Timestamp.fromMillis(nowMillis + ACCOUNT_DELETION_LEASE_MS),
      updatedAt: now,
    }, {merge: true});
    return {kind: "claimed"};
  });
}

async function releaseAccountDeletionLease(
  uid: string,
  workerId: string,
): Promise<void> {
  const stateRef = db.doc(`accountDeletionStates/${uid}`);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef);
    if (snapshot.data()?.leaseOwner !== workerId) return;
    transaction.set(stateRef, {
      leaseOwner: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    }, {merge: true});
  });
}

async function completeAccountDeletion(
  uid: string,
  receiptHash: string,
): Promise<string | null> {
  const workerId = randomBytes(16).toString("base64url");
  const claim = await claimAccountDeletion(uid, receiptHash, workerId);
  if (claim.kind === "completed") return claim.completedAt;
  if (claim.kind === "busy") return null;

  try {
    const preparedPairIds = await prepareAccountDeletion(uid);
    const pairDocuments = await accountPairDocuments(uid);
    const pairIds = [...new Set([
      ...preparedPairIds,
      ...pairDocuments.documents.map(snapshot => snapshot.id),
    ])].sort();
    if (pairIds.length > ACCOUNT_DELETION_LIMITS.pairDocuments) {
      throw new HttpsError(
        "resource-exhausted",
        "Pair 이력이 안전한 삭제 한도를 초과했습니다.",
      );
    }
    await db.doc(`accountDeletionStates/${uid}`).set(
      {pairIds, status: "revoking-pairs", updatedAt: Timestamp.now()},
      {merge: true},
    );

    const pairSnapshotById = new Map(
      pairDocuments.documents.map(snapshot => [snapshot.id, snapshot] as const),
    );
    for (const pairId of pairIds) {
      const pairSnapshot = pairSnapshotById.get(pairId);
      const status = pairSnapshot?.data().status;
      const wasActive = status === "active";
      if (status === "active" || status === "revoked" || pairSnapshot === undefined) {
        await revokePairAccess(uid, pairId, true);
      }
      if (pairSnapshot !== undefined) {
        await sanitizeFormerPartnerMetadata(pairSnapshot, uid, wasActive);
      }
    }

    const [invitePaths, purchaseTokenPaths, accountExportTicketPaths] =
      await Promise.all([
        accountInviteDocumentPaths(uid),
        subscriptionRepository.listPurchaseBindingPaths(uid),
        accountExportTicketDocumentPaths(uid),
      ]);
    const inventory = buildAccountDeletionInventory(
      uid,
      pairIds,
      invitePaths,
      purchaseTokenPaths,
      accountExportTicketPaths,
    );
    const deletionStatePath = `accountDeletionStates/${uid}`;
    const accessBarrierPaths = [
      `pairBindings/${uid}`,
      `connectionStates/${uid}`,
      ...inventory.pairDocumentPaths,
      ...pairIds.map(pairId => `pairTombstones/${pairId}`),
      ...inventory.inviteDocumentPaths,
      `accountExportStates/${uid}`,
      ...inventory.accountExportTicketDocumentPaths,
    ];
    await recursivelyDeletePaths(accessBarrierPaths);

    // Delete owner data only after the binding is gone so Firestore triggers
    // cannot recreate partner projections while the recursive delete runs.
    const remainingDataPaths = inventory.recursiveDocumentPaths.filter(path =>
      path !== deletionStatePath && !accessBarrierPaths.includes(path),
    );
    let completedAt: Timestamp | undefined;
    await finalizeAccountDeletion({
      deleteRemainingData: () => recursivelyDeletePaths(remainingDataPaths),
      // Firebase Auth is deliberately the final irreversible owner operation.
      // The receipt-backed scheduler can finish the tombstone even after the
      // owner token disappears or the original callable response is lost.
      deleteAuthUser: async () => {
        try {
          await auth.deleteUser(uid);
        } catch (error) {
          if (optionalRecord(error)?.code !== "auth/user-not-found") {
            throw error;
          }
        }
      },
      completeDeletionState: async () => {
        completedAt = Timestamp.now();
        await db.doc(deletionStatePath).set({
          schemaVersion: ACCOUNT_DELETION_SCHEMA_VERSION,
          status: "completed",
          recoveryReceiptHash: receiptHash,
          pairIds: [],
          completedAt,
          updatedAt: completedAt,
        }, {merge: false});
      },
    });
    if (completedAt === undefined) {
      throw new HttpsError("internal", "계정 삭제 완료 시각을 기록하지 못했습니다.");
    }
    return completedAt.toDate().toISOString();
  } catch (error) {
    await releaseAccountDeletionLease(uid, workerId).catch(() => undefined);
    throw error;
  }
}

export const beginAccountDeletion = onCall(callableOptions, async request => {
  const authenticatedUid = requireAuth(request);
  const data = asRecord(request.data ?? {});
  const requestedUid = accountPolicy(() =>
    authorizeAccountExport(authenticatedUid, data.uid),
  );
  const uid = requestedUid;
  const authFacts = accountDeletionAuthFacts(request, uid);
  const proposedReceipt = randomBytes(ACCOUNT_DELETION_RECEIPT_BYTES)
    .toString("base64url");
  const proposedHash = accountDeletionReceiptHash(proposedReceipt);
  const stateRef = db.doc(`accountDeletionStates/${uid}`);

  const recoveryReceipt = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef);
    const state = snapshot.data();
    if (snapshot.exists) {
      const existingReceipt = state?.recoveryReceipt;
      if (
        state?.status === "prepared" &&
        typeof existingReceipt === "string" &&
        deletionReceiptHashMatches(
          state.recoveryReceiptHash,
          accountDeletionReceiptHash(existingReceipt),
        )
      ) {
        return existingReceipt;
      }
      throw new HttpsError(
        "failed-precondition",
        "계정 삭제가 이미 진행 중이거나 완료되었습니다.",
      );
    }
    accountPolicy(() =>
      authorizeAccountDeletion(
        authFacts,
        Math.floor(Date.now() / 1_000),
      ),
    );
    const now = Timestamp.now();
    transaction.create(stateRef, {
      schemaVersion: ACCOUNT_DELETION_SCHEMA_VERSION,
      status: "prepared",
      recoveryReceipt: proposedReceipt,
      recoveryReceiptHash: proposedHash,
      pairIds: [],
      requestedAt: now,
      updatedAt: now,
    });
    return proposedReceipt;
  });

  return {
    schemaVersion: ACCOUNT_DELETION_SCHEMA_VERSION,
    deletionSubjectUid: uid,
    recoveryReceipt,
  };
});

export const getAccountDeletionStatus = onCall(callableOptions, async request => {
  const data = asRecord(request.data ?? {});
  const uid = requireDocumentId(data, "uid");
  const receiptHash = accountPolicy(() =>
    accountDeletionReceiptHash(data.recoveryReceipt as string),
  );
  const state = (await db.doc(`accountDeletionStates/${uid}`).get()).data();
  if (!deletionReceiptHashMatches(state?.recoveryReceiptHash, receiptHash)) {
    throw new HttpsError("not-found", "계정 삭제 상태를 찾을 수 없습니다.");
  }
  if (state?.status === "completed") {
    const completedAt = state.completedAt;
    if (!(completedAt instanceof Timestamp)) {
      throw new HttpsError("internal", "계정 삭제 완료 상태가 손상되었습니다.");
    }
    return {
      schemaVersion: ACCOUNT_DELETION_SCHEMA_VERSION,
      status: "completed",
      completedAt: completedAt.toDate().toISOString(),
    };
  }
  return {
    schemaVersion: ACCOUNT_DELETION_SCHEMA_VERSION,
    status: state?.status === "prepared" ? "prepared" : "pending",
  };
});

export const deleteMyAccount = onCall(
  {...callableOptions, timeoutSeconds: 540},
  async request => {
    const authenticatedUid = requireAuth(request);
    const data = asRecord(request.data ?? {});
    const uid = accountPolicy(() =>
      authorizeAccountExport(authenticatedUid, data.uid),
    );
    const receiptHash = accountPolicy(() =>
      accountDeletionReceiptHash(data.recoveryReceipt as string),
    );
    const completedAt = await completeAccountDeletion(uid, receiptHash);
    if (completedAt === null) {
      throw new HttpsError(
        "aborted",
        "계정 삭제가 이미 처리 중입니다. 잠시 후 상태를 다시 확인해 주세요.",
      );
    }
    return {
      schemaVersion: ACCOUNT_DELETION_SCHEMA_VERSION,
      deleted: true,
      completedAt,
    };
  },
);

export const finalizePendingAccountDeletions = onSchedule(
  {
    schedule: ACCOUNT_DELETION_FINALIZER_SCHEDULE,
    timeoutSeconds: 540,
    maxInstances: 1,
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 3_600,
  },
  async () => {
    const pending = await db.collection("accountDeletionStates")
      .where("status", "in", ["in-progress", "revoking-pairs"])
      .orderBy("updatedAt", "asc")
      .limit(ACCOUNT_DELETION_FINALIZER_BATCH_SIZE)
      .get();
    const results = await Promise.allSettled(pending.docs.map(async snapshot => {
      const receiptHash = snapshot.data().recoveryReceiptHash;
      if (typeof receiptHash !== "string" || !/^[a-f0-9]{64}$/.test(receiptHash)) {
        throw new Error("Pending account deletion has no valid receipt hash.");
      }
      return completeAccountDeletion(snapshot.id, receiptHash);
    }));
    const report = results.reduce((counts, result) => {
      if (result.status === "fulfilled" && result.value !== null) counts.completed += 1;
      else if (result.status === "fulfilled") counts.busy += 1;
      else counts.failed += 1;
      return counts;
    }, {completed: 0, busy: 0, failed: 0});
    logger.info("Pending account deletion finalizer completed.", report);
    if (report.failed > 0) {
      throw new Error("One or more pending account deletions could not be finalized.");
    }
  },
);

export const acknowledgeCacheTombstone = onCall(
  callableOptions,
  async request => {
    const uid = requireAuth(request);
    const data = asRecord(request.data);
    const tombstoneId = requireDocumentId(data, "tombstoneId");
    const tombstoneRef = db.doc(`users/${uid}/cacheTombstones/${tombstoneId}`);
    const deletionStateRef = db.doc(`accountDeletionStates/${uid}`);
    const now = Timestamp.now();

    await db.runTransaction(async transaction => {
      const [snapshot, deletionStateSnapshot] = await Promise.all([
        transaction.get(tombstoneRef),
        transaction.get(deletionStateRef),
      ]);
      requireAccountMutationAllowed(deletionStateSnapshot);
      if (!snapshot.exists) {
        throw new HttpsError("not-found", "삭제 알림을 찾을 수 없습니다.");
      }
      transaction.update(tombstoneRef, {
        status: "acknowledged",
        acknowledgedAt: now,
      });
    });

    return {tombstoneId, acknowledgedAt: now.toDate().toISOString()};
  },
);

async function refreshProjectionForUser(uid: string): Promise<void> {
  const bindingRef = db.doc(`pairBindings/${uid}`);
  const deletionStateRef = db.doc(`accountDeletionStates/${uid}`);

  await db.runTransaction(async transaction => {
    const [bindingSnapshot, deletionStateSnapshot] = await Promise.all([
      transaction.get(bindingRef),
      transaction.get(deletionStateRef),
    ]);
    if (deletionStateSnapshot.exists) {
      return;
    }
    const pairId = bindingSnapshot.data()?.pairId;
    if (typeof pairId !== "string") {
      return;
    }

    const pairRef = db.doc(`pairs/${pairId}`);
    const pairSnapshot = await transaction.get(pairRef);
    const pair = pairSnapshot.data();
    if (pair?.status !== "active") {
      transaction.delete(pairRef.collection("projections").doc(uid));
      return;
    }

    const members = pairMembers(pair);
    if (!members.includes(uid)) {
      throw new Error(`pair binding mismatch for ${uid}`);
    }

    const memberData = pair.members?.[uid];
    const recordsCycle = memberData?.recordsCycle === true;
    const now = Timestamp.now();
    const projection = await projectionForMember(
      transaction,
      {uid, recordsCycle},
      pairId,
      now,
    );
    transaction.set(
      pairRef.collection("projections").doc(uid),
      projection.document,
    );
    if (projection.recordsCycle !== recordsCycle) {
      transaction.update(pairRef, {
        members: {
          ...pair.members,
          [uid]: {...memberData, recordsCycle: projection.recordsCycle},
        },
        updatedAt: now,
      });
      transaction.set(
        db.doc(`users/${uid}/pairMemberships/${pairId}`),
        {recordsCycle: projection.recordsCycle, updatedAt: now},
        {merge: true},
      );
    }
  });
}

export const syncCycleProjection = onDocumentWritten(
  "users/{uid}/privateCycles/{cycleId}",
  async event => {
    await refreshProjectionForUser(event.params.uid);
  },
);

export const syncDailyLogProjection = onDocumentWritten(
  "users/{uid}/privateDailyLogs/{logId}",
  async event => {
    const uid = event.params.uid;
    const logId = event.params.logId;
    const before = event.data?.before;
    const after = event.data?.after;
    const tombstoneRef = db.doc(
      `users/${uid}/privateDailyLogTombstones/${logId}`,
    );
    if (after?.exists) {
      await tombstoneRef.delete();
    } else if (before?.exists) {
      const deletionState = await db.doc(`accountDeletionStates/${uid}`).get();
      if (!deletionState.exists) {
        const lastMutationId = before.data()?.lastMutationId;
        await tombstoneRef.set({
          schemaVersion: 1,
          localDate: logId,
          lastMutationId:
            typeof lastMutationId === "string" && lastMutationId.length > 0
              ? lastMutationId.slice(0, 128)
              : `server-delete-${logId}`,
          updatedAt: Timestamp.now(),
        });
      }
    }
    await refreshProjectionForUser(uid);
  },
);

export const syncShareSettingsProjection = onDocumentWritten(
  "users/{uid}/shareSettings/{pairId}",
  async event => {
    await refreshProjectionForUser(event.params.uid);
  },
);

export const notifyPartnerProjectionChange = onDocumentWritten(
  "pairs/{pairId}/projections/{ownerUid}",
  async event => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!hasMeaningfulProjectionChange(before, after)) {
      return;
    }
    await notifyActivePartner(
      event.params.pairId,
      event.params.ownerUid,
      "pair-update",
    );
  },
);
