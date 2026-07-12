import {createHash, randomBytes} from "node:crypto";

import {initializeApp} from "firebase-admin/app";
import {
  DocumentData,
  DocumentSnapshot,
  Query,
  Timestamp,
  Transaction,
  getFirestore,
} from "firebase-admin/firestore";
import {setGlobalOptions} from "firebase-functions/v2";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";

import {
  INVITE_TTL_MS,
  evaluateInviteRateLimit,
  inviteIsUsable,
} from "./domain/invitePolicy.js";
import {buildPartnerProjection} from "./domain/projection.js";

initializeApp();

const db = getFirestore();
const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true";

setGlobalOptions({
  region: "asia-northeast3",
  maxInstances: 10,
  timeoutSeconds: 30,
});

const callableOptions = {
  enforceAppCheck,
  cors: true,
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

function requireAuth(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (uid === undefined || uid.length === 0) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  return uid;
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

function latestRecordQuery(
  uid: string,
  collection: "privateCycles" | "privateDailyLogs",
): Query<DocumentData> {
  return db
    .collection(`users/${uid}/${collection}`)
    .orderBy("updatedAt", "desc")
    .limit(1);
}

async function latestRecord(
  transaction: Transaction,
  uid: string,
  collection: "privateCycles" | "privateDailyLogs",
): Promise<DocumentData | undefined> {
  const snapshot = await transaction.get(latestRecordQuery(uid, collection));
  return snapshot.docs[0]?.data();
}

async function projectionForMember(
  transaction: Transaction,
  member: PairMemberInput,
  pairId: string,
  now: Timestamp,
): Promise<JsonRecord> {
  const shareSettingsRef = db.doc(`users/${member.uid}/shareSettings/${pairId}`);
  const [privateCycle, privateDailyLog, shareSettingsSnapshot] = await Promise.all([
    latestRecord(transaction, member.uid, "privateCycles"),
    latestRecord(transaction, member.uid, "privateDailyLogs"),
    transaction.get(shareSettingsRef),
  ]);
  const projection = buildPartnerProjection({
    ownerUid: member.uid,
    pairId,
    generatedAt: now.toDate().toISOString(),
    privateCycle,
    privateDailyLog,
    shareSettings: shareSettingsSnapshot.data(),
  });

  return {...projection, generatedAt: now};
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
  const inviteRef = db.doc(`pairInvites/${hash}`);

  await db.runTransaction(async transaction => {
    const [stateSnapshot, bindingSnapshot] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(bindingRef),
    ]);

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
    const [
      inviterStateSnapshot,
      acceptingStateSnapshot,
      inviterBindingSnapshot,
      acceptingBindingSnapshot,
    ] = await Promise.all([
      transaction.get(inviterStateRef),
      transaction.get(acceptingStateRef),
      transaction.get(inviterBindingRef),
      transaction.get(acceptingBindingRef),
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

    if (inviterBindingSnapshot.exists || acceptingBindingSnapshot.exists) {
      throw new HttpsError(
        "failed-precondition",
        "두 사용자 중 한 명에게 이미 활성화된 Pair가 있습니다.",
      );
    }

    const inviterRecordsCycle = invite.inviterRecordsCycle === true;
    const members: readonly [PairMemberInput, PairMemberInput] = [
      {uid: inviterUid, recordsCycle: inviterRecordsCycle},
      {uid: acceptingUid, recordsCycle: acceptingRecordsCycle},
    ];
    const [inviterProjection, acceptingProjection] = await Promise.all([
      projectionForMember(transaction, members[0], pairRef.id, now),
      projectionForMember(transaction, members[1], pairRef.id, now),
    ]);
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
    transaction.create(pairRef.collection("projections").doc(inviterUid), inviterProjection);
    transaction.create(
      pairRef.collection("projections").doc(acceptingUid),
      acceptingProjection,
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

export const revokePair = onCall(callableOptions, async request => {
  const requestingUid = requireAuth(request);
  const data = asRecord(request.data);
  const pairId = requireDocumentId(data, "pairId");
  const pairRef = db.doc(`pairs/${pairId}`);
  const now = Timestamp.now();

  const result = await db.runTransaction(async transaction => {
    const pairSnapshot = await transaction.get(pairRef);
    const pair = pairSnapshot.data();
    if (pair === undefined) {
      throw new HttpsError("not-found", "Pair를 찾을 수 없습니다.");
    }

    const members = pairMembers(pair);
    if (!members.includes(requestingUid)) {
      throw new HttpsError("permission-denied", "Pair 멤버만 해제할 수 있습니다.");
    }
    if (pair.status === "revoked") {
      return {alreadyRevoked: true};
    }
    if (pair.status !== "active") {
      throw new HttpsError("failed-precondition", "활성 Pair가 아닙니다.");
    }

    const bindingRefs = members.map(uid => db.doc(`pairBindings/${uid}`));
    const stateRefs = members.map(uid => db.doc(`connectionStates/${uid}`));
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
    for (const uid of members) {
      transaction.delete(pairRef.collection("projections").doc(uid));
      transaction.delete(db.doc(`users/${uid}/shareSettings/${pairId}`));
    }

    transaction.set(db.doc(`pairTombstones/${pairId}`), {
      pairId,
      memberUids: members,
      revokedAt: now,
      revokedBy: requestingUid,
    });

    members.forEach((uid, index) => {
      const partnerUid = members[index === 0 ? 1 : 0];
      const binding = bindingSnapshots[index]?.data();
      const state = parseConnectionState(stateSnapshots[index]!);

      if (binding?.pairId === pairId) {
        transaction.delete(bindingRefs[index]!);
      }
      transaction.set(
        db.doc(`users/${uid}/pairMemberships/${pairId}`),
        {status: "revoked", revokedAt: now, updatedAt: now},
        {merge: true},
      );
      transaction.set(db.doc(`users/${uid}/cacheTombstones/${pairId}`), {
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

    return {alreadyRevoked: false};
  });

  return {
    pairId,
    revokedAt: now.toDate().toISOString(),
    ...result,
  };
});

export const acknowledgeCacheTombstone = onCall(
  callableOptions,
  async request => {
    const uid = requireAuth(request);
    const data = asRecord(request.data);
    const tombstoneId = requireDocumentId(data, "tombstoneId");
    const tombstoneRef = db.doc(`users/${uid}/cacheTombstones/${tombstoneId}`);
    const now = Timestamp.now();

    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(tombstoneRef);
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

  await db.runTransaction(async transaction => {
    const bindingSnapshot = await transaction.get(bindingRef);
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
    transaction.set(pairRef.collection("projections").doc(uid), projection);
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
    await refreshProjectionForUser(event.params.uid);
  },
);

export const syncShareSettingsProjection = onDocumentWritten(
  "users/{uid}/shareSettings/{pairId}",
  async event => {
    await refreshProjectionForUser(event.params.uid);
  },
);
