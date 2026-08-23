import {createHash} from "node:crypto";

import {FirebaseApp, deleteApp, initializeApp} from "firebase/app";
import {
  Auth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signInAnonymously,
} from "firebase/auth";
import {
  Firestore,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import {
  Functions,
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {afterAll, describe, expect, test} from "vitest";

const PROJECT_ID = "demo-cyclepair";
const apps: FirebaseApp[] = [];

function emulatorAddress(
  value: string | undefined,
  fallbackHost: string,
  fallbackPort: number,
): {host: string; port: number} {
  if (value === undefined) {
    return {host: fallbackHost, port: fallbackPort};
  }
  const separator = value.lastIndexOf(":");
  const host = value.slice(0, separator);
  const port = Number(value.slice(separator + 1));
  return host.length > 0 && Number.isInteger(port)
    ? {host, port}
    : {host: fallbackHost, port: fallbackPort};
}

interface EmulatorClient {
  readonly app: FirebaseApp;
  readonly auth: Auth;
  readonly firestore: Firestore;
  readonly functions: Functions;
}

function shareSettings(
  overrides: Partial<
    Record<
      | "cyclePhase"
      | "cycleStatus"
      | "fertilityStatus"
      | "nextPeriodWindow"
      | "periodDates"
      | "moodTag"
      | "symptomTags"
      | "energyLevel"
      | "conditionCode"
      | "carePreferences"
      | "note",
      boolean
    >
  >,
) {
  return {
    schemaVersion: 1,
    updatedAt: Timestamp.now(),
    cyclePhase: false,
    cycleStatus: false,
    fertilityStatus: false,
    nextPeriodWindow: false,
    periodDates: false,
    moodTag: false,
    symptomTags: false,
    energyLevel: false,
    conditionCode: false,
    carePreferences: false,
    note: false,
    ...overrides,
  };
}

async function createClient(
  name: string,
  authenticate = true,
): Promise<EmulatorClient> {
  const app = initializeApp(
    {
      projectId: PROJECT_ID,
      apiKey: "demo-api-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
    },
    name,
  );
  apps.push(app);

  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const functions = getFunctions(app, "asia-northeast3");
  const authEmulator = emulatorAddress(
    process.env.CYCLEPAIR_AUTH_EMULATOR_HOST,
    "127.0.0.1",
    9399,
  );
  const firestoreEmulator = emulatorAddress(
    process.env.CYCLEPAIR_FIRESTORE_EMULATOR_HOST,
    "127.0.0.1",
    8380,
  );
  const functionsEmulator = emulatorAddress(
    process.env.CYCLEPAIR_FUNCTIONS_EMULATOR_HOST,
    "127.0.0.1",
    5301,
  );
  connectAuthEmulator(
    auth,
    `http://${authEmulator.host}:${authEmulator.port}`,
    {disableWarnings: true},
  );
  connectFirestoreEmulator(
    firestore,
    firestoreEmulator.host,
    firestoreEmulator.port,
  );
  connectFunctionsEmulator(
    functions,
    functionsEmulator.host,
    functionsEmulator.port,
  );

  if (authenticate) {
    await signInAnonymously(auth);
  }

  return {app, auth, firestore, functions};
}

async function createEmailClient(
  name: string,
  email: string,
  password: string,
): Promise<EmulatorClient> {
  const client = await createClient(name, false);
  await createUserWithEmailAndPassword(client.auth, email, password);
  return client;
}

async function waitForProjection(
  firestore: Firestore,
  path: string,
  predicate: (data: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const snapshot = await getDocFromServer(doc(firestore, path));
    const data = snapshot.data() as Record<string, unknown> | undefined;
    if (data !== undefined && predicate(data)) {
      return data;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error(`projection did not converge: ${path}`);
}

async function emulatorDocumentExists(path: string): Promise<boolean> {
  const host =
    process.env.CYCLEPAIR_FIRESTORE_EMULATOR_HOST ??
    process.env.FIRESTORE_EMULATOR_HOST ??
    "127.0.0.1:8380";
  const response = await fetch(
    `http://${host}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    {headers: {authorization: "Bearer owner"}},
  );
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(
      `Firestore emulator admin read failed (${
        response.status
      }): ${await response.text()}`,
    );
  }

  return true;
}

async function emulatorAdminSetDocument(
  path: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const host =
    process.env.CYCLEPAIR_FIRESTORE_EMULATOR_HOST ??
    process.env.FIRESTORE_EMULATOR_HOST ??
    "127.0.0.1:8380";
  const response = await fetch(
    `http://${host}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer owner",
        "content-type": "application/json",
      },
      body: JSON.stringify({fields}),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Firestore emulator admin write failed (${
        response.status
      }): ${await response.text()}`,
    );
  }
}

function functionsHttpUrl(functionName: string): string {
  const address = emulatorAddress(
    process.env.CYCLEPAIR_FUNCTIONS_EMULATOR_HOST,
    "127.0.0.1",
    5301,
  );
  return `http://${address.host}:${address.port}/${PROJECT_ID}/asia-northeast3/${functionName}`;
}

function exportTokenFromTicket(value: unknown): string {
  const data = value as {downloadUrl?: unknown};
  if (typeof data.downloadUrl !== "string") {
    throw new Error("missing export download URL");
  }
  const token = new URL(data.downloadUrl).hash.match(
    /^#token=([A-Za-z0-9_-]{43})$/,
  )?.[1];
  if (token === undefined) {
    throw new Error("invalid export download URL");
  }
  return token;
}

afterAll(async () => {
  await Promise.all(apps.map(app => deleteApp(app)));
});

describe("notification device callables", () => {
  test("require auth and keep registration tokens server-only", async () => {
    const token = "fcm_registration_token:APA91b-emulator_1234567890";
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const unauthenticated = await createClient("notification-unauth", false);
    const anonymous = await createClient("notification-owner");
    const uid = anonymous.auth.currentUser!.uid;
    const registration = {
      token,
      platform: "android",
      locale: "ko-KR",
      quietHours: {
        start: "22:00",
        end: "08:00",
        timeZone: "Asia/Seoul",
      },
    };
    const unauthenticatedRegister = httpsCallable(
      unauthenticated.functions,
      "registerNotificationDevice",
    );
    await expect(unauthenticatedRegister(registration)).rejects.toMatchObject({
      code: "functions/unauthenticated",
    });

    const register = httpsCallable(
      anonymous.functions,
      "registerNotificationDevice",
    );
    await expect(
      register({...registration, uid: "forged"}),
    ).rejects.toMatchObject({code: "functions/invalid-argument"});
    await expect(register(registration)).resolves.toMatchObject({
      data: {registered: true},
    });
    const devicePath = `users/${uid}/notificationDevices/${tokenHash}`;
    expect(await emulatorDocumentExists(devicePath)).toBe(true);
    await expect(
      getDocFromServer(doc(anonymous.firestore, devicePath)),
    ).rejects.toMatchObject({code: "permission-denied"});

    const unregister = httpsCallable(
      anonymous.functions,
      "unregisterNotificationDevice",
    );
    await expect(unregister({token})).resolves.toMatchObject({
      data: {unregistered: true, removed: true},
    });
    expect(await emulatorDocumentExists(devicePath)).toBe(false);
    await expect(unregister({token})).resolves.toMatchObject({
      data: {unregistered: true, removed: false},
    });

    const limitTokens = Array.from(
      {length: 10},
      (_, index) =>
        `fcm_registration_token:APA91b-limit_${index}_1234567890`,
    );
    for (const limitToken of limitTokens) {
      await register({...registration, token: limitToken});
    }
    await expect(
      register({
        ...registration,
        token: "fcm_registration_token:APA91b-limit_overflow_1234567890",
      }),
    ).rejects.toMatchObject({code: "functions/resource-exhausted"});
    await expect(
      register({...registration, token: limitTokens[0], locale: "en-US"}),
    ).resolves.toMatchObject({data: {registered: true}});
    await emulatorAdminSetDocument(`accountDeletionStates/${uid}`, {
      schemaVersion: {integerValue: "1"},
      status: {stringValue: "in-progress"},
    });
    await expect(register(registration)).rejects.toMatchObject({
      code: "functions/failed-precondition",
    });
    await expect(unregister({token: limitTokens[0]})).rejects.toMatchObject({
      code: "functions/failed-precondition",
    });
  });
});

describe("subscription account token callable", () => {
  test("requires auth and returns one server-owned UUID for both stores", async () => {
    const unauthenticated = await createClient("purchase-token-unauth", false);
    const owner = await createClient("purchase-token-owner");
    const other = await createClient("purchase-token-other");
    const unauthenticatedCallable = httpsCallable(
      unauthenticated.functions,
      "getPurchaseAccountToken",
    );
    await expect(unauthenticatedCallable({})).rejects.toMatchObject({
      code: "functions/unauthenticated",
    });

    const getPurchaseAccountToken = httpsCallable(
      owner.functions,
      "getPurchaseAccountToken",
    );
    const first = await getPurchaseAccountToken({});
    const second = await getPurchaseAccountToken({uid: "ignored"});
    const tokenResponse = first.data as {
      schemaVersion: number;
      appAccountToken: string;
      googleObfuscatedExternalAccountId: string;
    };
    expect(second.data).toEqual(first.data);
    expect(tokenResponse).toMatchObject({schemaVersion: 1});
    expect(tokenResponse.appAccountToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(tokenResponse.googleObfuscatedExternalAccountId).toBe(
      tokenResponse.appAccountToken,
    );

    const uid = owner.auth.currentUser!.uid;
    const statePath = `purchaseStates/${uid}`;
    const state = await getDocFromServer(doc(owner.firestore, statePath));
    expect(state.data()).toMatchObject({
      schemaVersion: 1,
      accountToken: tokenResponse.appAccountToken,
    });
    await expect(getDocFromServer(doc(other.firestore, statePath)))
      .rejects.toMatchObject({code: "permission-denied"});
    await expect(setDoc(doc(owner.firestore, statePath), {
      accountToken: "forged",
    })).rejects.toMatchObject({code: "permission-denied"});

    await emulatorAdminSetDocument(`accountDeletionStates/${uid}`, {
      schemaVersion: {integerValue: "1"},
      status: {stringValue: "in-progress"},
    });
    await expect(getPurchaseAccountToken({})).rejects.toMatchObject({
      code: "functions/failed-precondition",
    });

    const unauthenticatedVerify = httpsCallable(
      unauthenticated.functions,
      "verifySubscriptionPurchase",
    );
    const invalidEvidence = {
      provider: "google-play",
      productId: "client-forged-product",
      basePlanId: "monthly",
      transactionId: "transaction-1",
      purchaseToken: "never-sent-to-google",
    };
    await expect(unauthenticatedVerify(invalidEvidence)).rejects.toMatchObject({
      code: "functions/unauthenticated",
    });
    const verify = httpsCallable(
      owner.functions,
      "verifySubscriptionPurchase",
    );
    await expect(verify(invalidEvidence)).resolves.toMatchObject({
      data: {verified: false, reason: "product-mismatch"},
    });
  });
});

describe("pair lifecycle callables", () => {
  test("requires auth, accepts an invite once, and revokes access atomically", async () => {
    const unauthenticated = await createClient("unauthenticated", false);
    const unauthenticatedCreate = httpsCallable(
      unauthenticated.functions,
      "createPairInvite",
    );
    await expect(
      unauthenticatedCreate({recordsCycle: true}),
    ).rejects.toMatchObject({code: "functions/unauthenticated"});

    const alice = await createClient("alice");
    const bob = await createClient("bob");
    const charlie = await createClient("charlie");
    const aliceUid = alice.auth.currentUser!.uid;
    const bobUid = bob.auth.currentUser!.uid;
    await setDoc(
      doc(alice.firestore, `users/${aliceUid}/privateCycles/current`),
      {
        schemaVersion: 2,
        recordsCycle: true,
        consentAcceptedAt: "2026-07-14T00:00:00.000Z",
        consentVersion: "2026-08-09-v1",
        updatedAt: serverTimestamp(),
      },
    );
    const createInvite = httpsCallable(alice.functions, "createPairInvite");
    const created = await createInvite({recordsCycle: true});
    const inviteToken = (created.data as {inviteToken: string}).inviteToken;
    expect(inviteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const acceptInvite = httpsCallable(bob.functions, "acceptPairInvite");
    const accepted = await acceptInvite({inviteToken, recordsCycle: false});
    const pairId = (accepted.data as {pairId: string}).pairId;
    const pairPath = `pairs/${pairId}`;
    const pair = await getDocFromServer(doc(alice.firestore, pairPath));

    expect(pair.data()).toMatchObject({
      status: "active",
      memberUids: [alice.auth.currentUser?.uid, bob.auth.currentUser?.uid],
    });
    await expect(
      getDocFromServer(doc(charlie.firestore, pairPath)),
    ).rejects.toMatchObject({code: "permission-denied"});

    const projectionPath = `${pairPath}/projections/${alice.auth.currentUser?.uid}`;
    const projection = await getDocFromServer(
      doc(bob.firestore, projectionPath),
    );
    expect(projection.data()).toMatchObject({
      pairId,
      ownerUid: alice.auth.currentUser?.uid,
      schemaVersion: 1,
    });
    expect(projection.data()).not.toHaveProperty("cyclePhase");
    const initialGeneratedAt = (
      projection.data()?.generatedAt as Timestamp
    ).toMillis();
    await expect(
      updateDoc(doc(bob.firestore, projectionPath), {moodTag: "forged"}),
    ).rejects.toMatchObject({code: "permission-denied"});

    const upsertEvent = httpsCallable(alice.functions, "upsertPairEvent");
    const invalidEvent = {
      id: "event_1",
      title: "",
      date: "2026-02-30",
    };
    await expect(
      upsertEvent({
        pairId,
        event: invalidEvent,
        mutationId: "mutation_invalid",
      }),
    ).rejects.toMatchObject({code: "functions/invalid-argument"});

    const event = {
      id: "event_1",
      title: " 산책 ",
      date: "2026-07-14",
      startTime: "19:30",
      endTime: "20:00",
      note: "물 챙기기",
    };
    const outsiderUpsert = httpsCallable(charlie.functions, "upsertPairEvent");
    await expect(
      outsiderUpsert({pairId, event, mutationId: "mutation_outsider"}),
    ).rejects.toMatchObject({code: "functions/permission-denied"});

    const createdEvent = await upsertEvent({
      pairId,
      event,
      mutationId: "mutation_create",
    });
    expect(createdEvent.data).toMatchObject({
      pairId,
      eventId: event.id,
      mutationId: "mutation_create",
      alreadyApplied: false,
    });
    const eventPath = `${pairPath}/events/${event.id}`;
    const eventSnapshot = await getDocFromServer(doc(bob.firestore, eventPath));
    expect(eventSnapshot.data()).toMatchObject({
      title: "산책",
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      note: event.note,
      createdBy: aliceUid,
      updatedBy: aliceUid,
      mutationId: "mutation_create",
    });
    const firstCreatedAt = eventSnapshot.data()?.createdAt as Timestamp;
    expect(firstCreatedAt).toBeInstanceOf(Timestamp);
    await expect(
      updateDoc(doc(bob.firestore, eventPath), {title: "직접 수정"}),
    ).rejects.toMatchObject({code: "permission-denied"});

    const replayedEvent = await upsertEvent({
      pairId,
      event,
      mutationId: "mutation_create",
    });
    expect(replayedEvent.data).toMatchObject({alreadyApplied: true});
    await expect(
      upsertEvent({
        pairId,
        event: {...event, title: "다른 일정"},
        mutationId: "mutation_create",
      }),
    ).rejects.toMatchObject({code: "functions/failed-precondition"});

    const bobUpsertEvent = httpsCallable(bob.functions, "upsertPairEvent");
    await bobUpsertEvent({
      pairId,
      event: {...event, title: "저녁 산책", note: ""},
      mutationId: "mutation_update",
    });
    const updatedEvent = await getDocFromServer(
      doc(alice.firestore, eventPath),
    );
    expect(updatedEvent.data()).toMatchObject({
      title: "저녁 산책",
      createdBy: aliceUid,
      updatedBy: bobUid,
      mutationId: "mutation_update",
    });
    expect(updatedEvent.data()).not.toHaveProperty("note");
    expect((updatedEvent.data()?.createdAt as Timestamp).toMillis()).toBe(
      firstCreatedAt.toMillis(),
    );

    const deleteEvent = httpsCallable(bob.functions, "deletePairEvent");
    const deletedEvent = await deleteEvent({
      pairId,
      eventId: event.id,
      mutationId: "mutation_delete",
    });
    expect(deletedEvent.data).toMatchObject({
      eventId: event.id,
      alreadyApplied: false,
      deleted: true,
    });
    expect(
      (await getDocFromServer(doc(alice.firestore, eventPath))).exists(),
    ).toBe(false);
    const replayedDelete = await deleteEvent({
      pairId,
      eventId: event.id,
      mutationId: "mutation_delete",
    });
    expect(replayedDelete.data).toMatchObject({alreadyApplied: true});

    const cleanupEvent = {...event, id: "event_cleanup", note: "삭제 대상"};
    await upsertEvent({
      pairId,
      event: cleanupEvent,
      mutationId: "mutation_cleanup",
    });
    const cleanupEventPath = `${pairPath}/events/${cleanupEvent.id}`;
    expect(
      (await getDocFromServer(doc(bob.firestore, cleanupEventPath))).exists(),
    ).toBe(true);

    const unauthenticatedNudge = httpsCallable(
      unauthenticated.functions,
      "sendPartnerNudge",
    );
    await expect(
      unauthenticatedNudge({
        pairId,
        requestId: "nudge_unauthenticated",
        type: "check-in-request",
      }),
    ).rejects.toMatchObject({code: "functions/unauthenticated"});
    const sendNudge = httpsCallable(alice.functions, "sendPartnerNudge");
    const outsiderNudge = httpsCallable(
      charlie.functions,
      "sendPartnerNudge",
    );
    await expect(
      sendNudge({
        pairId,
        requestId: "nudge_invalid_type",
        type: "free-text",
      }),
    ).rejects.toMatchObject({code: "functions/invalid-argument"});
    await expect(
      outsiderNudge({
        pairId,
        requestId: "nudge_outsider",
        type: "check-in-request",
      }),
    ).rejects.toMatchObject({code: "functions/permission-denied"});

    const firstNudge = await sendNudge({
      pairId,
      requestId: "nudge_checkin_1",
      type: "check-in-request",
    });
    expect(firstNudge.data).toMatchObject({
      requestId: "nudge_checkin_1",
      type: "check-in-request",
      alreadyApplied: false,
      nextAllowedAt: expect.any(String),
    });
    const bobInboxPath = `${pairPath}/nudgeInboxes/${bobUid}`;
    const aliceCooldownPath = `${pairPath}/nudgeSenders/${aliceUid}`;
    expect(
      (await getDocFromServer(doc(bob.firestore, bobInboxPath))).data(),
    ).toMatchObject({
      requestId: "nudge_checkin_1",
      senderUid: aliceUid,
      recipientUid: bobUid,
      type: "check-in-request",
    });
    await expect(
      getDocFromServer(doc(alice.firestore, bobInboxPath)),
    ).rejects.toMatchObject({code: "permission-denied"});
    expect(
      (await getDocFromServer(doc(alice.firestore, aliceCooldownPath))).data(),
    ).toMatchObject({
      senderUid: aliceUid,
      checkInRequestId: "nudge_checkin_1",
    });
    await expect(
      sendNudge({
        pairId,
        requestId: "nudge_checkin_1",
        type: "check-in-request",
      }),
    ).resolves.toMatchObject({data: {alreadyApplied: true}});
    await expect(
      sendNudge({
        pairId,
        requestId: "nudge_checkin_2",
        type: "check-in-request",
      }),
    ).rejects.toMatchObject({code: "functions/resource-exhausted"});

    await sendNudge({
      pairId,
      requestId: "nudge_care_1",
      type: "care-acknowledgement",
    });
    expect(
      (await getDocFromServer(doc(bob.firestore, bobInboxPath))).data(),
    ).toMatchObject({
      requestId: "nudge_care_1",
      type: "care-acknowledgement",
    });
    const acknowledgeNudge = httpsCallable(
      bob.functions,
      "acknowledgePartnerNudge",
    );
    await expect(
      acknowledgeNudge({pairId, requestId: "nudge_checkin_1"}),
    ).resolves.toMatchObject({data: {acknowledged: false}});
    expect(await emulatorDocumentExists(bobInboxPath)).toBe(true);
    await expect(
      acknowledgeNudge({pairId, requestId: "nudge_care_1"}),
    ).resolves.toMatchObject({data: {acknowledged: true}});
    expect(await emulatorDocumentExists(bobInboxPath)).toBe(false);

    const sendBobNudge = httpsCallable(bob.functions, "sendPartnerNudge");
    await sendBobNudge({
      pairId,
      requestId: "nudge_cleanup",
      type: "check-in-request",
    });
    const aliceInboxPath = `${pairPath}/nudgeInboxes/${aliceUid}`;
    const bobCooldownPath = `${pairPath}/nudgeSenders/${bobUid}`;
    expect(await emulatorDocumentExists(aliceInboxPath)).toBe(true);
    expect(await emulatorDocumentExists(bobCooldownPath)).toBe(true);

    const settingsPath = `users/${aliceUid}/shareSettings/${pairId}`;
    await setDoc(
      doc(alice.firestore, `users/${aliceUid}/privateCycles/current`),
      {
        schemaVersion: 2,
        recordsCycle: true,
        consentAcceptedAt: "2026-07-14T00:00:00.000Z",
        consentVersion: "2026-08-09-v1",
        asOfDate: "2026-07-14",
        averageCycleLength: 28,
        averagePeriodLength: 5,
        periodDates: {startDate: "2026-07-10"},
        cyclePhase: "luteal",
        nextPeriodWindow: {
          startDate: "2026-07-31",
          endDate: "2026-08-14",
        },
        updatedAt: serverTimestamp(),
      },
    );
    await waitForProjection(
      bob.firestore,
      projectionPath,
      data =>
        data.generatedAt instanceof Timestamp &&
        data.generatedAt.toMillis() > initialGeneratedAt &&
        !Object.hasOwn(data, "cyclePhase"),
    );

    await setDoc(
      doc(alice.firestore, settingsPath),
      shareSettings({
        symptomTags: true,
        energyLevel: true,
        conditionCode: true,
        note: true,
      }),
    );
    await setDoc(
      doc(alice.firestore, `users/${aliceUid}/privateDailyLogs/2026-07-14`),
      {
        schemaVersion: 2,
        localDate: "2026-07-14",
        lastMutationId: "daily-latest",
        symptomTags: ["headache"],
        energyLevel: 4,
        conditionCode: "needs-space",
        note: "오늘은 조용히 쉬고 싶어요.",
        updatedAt: serverTimestamp(),
      },
    );
    const latestDailyProjection = await waitForProjection(
      bob.firestore,
      projectionPath,
      data =>
        Array.isArray(data.symptomTags) &&
        data.symptomTags[0] === "headache" &&
        data.energyLevel === 4 &&
        data.conditionCode === "needs-space" &&
        data.dailyLogDate === "2026-07-14" &&
        data.note === "오늘은 조용히 쉬고 싶어요.",
    );
    const latestDailyGeneratedAt =
      latestDailyProjection.generatedAt as Timestamp;
    await new Promise(resolve => setTimeout(resolve, 5));
    await setDoc(
      doc(alice.firestore, `users/${aliceUid}/privateDailyLogs/2026-07-01`),
      {
        schemaVersion: 2,
        localDate: "2026-07-01",
        lastMutationId: "daily-historical",
        symptomTags: ["cramps"],
        updatedAt: serverTimestamp(),
      },
    );
    await waitForProjection(
      bob.firestore,
      projectionPath,
      data =>
        data.generatedAt instanceof Timestamp &&
        data.generatedAt.toMillis() > latestDailyGeneratedAt.toMillis() &&
        Array.isArray(data.symptomTags) &&
        data.symptomTags[0] === "headache" &&
        data.dailyLogDate === "2026-07-14",
    );
    await deleteDoc(
      doc(alice.firestore, `users/${aliceUid}/privateDailyLogs/2026-07-14`),
    );
    await waitForProjection(
      bob.firestore,
      projectionPath,
      data =>
        Array.isArray(data.symptomTags) &&
        data.symptomTags[0] === "cramps" &&
        data.dailyLogDate === "2026-07-01" &&
        !Object.hasOwn(data, "energyLevel") &&
        !Object.hasOwn(data, "conditionCode") &&
        !Object.hasOwn(data, "note"),
    );
    const dailyTombstonePath =
      `users/${aliceUid}/privateDailyLogTombstones/2026-07-14`;
    expect(
      (
        await getDocFromServer(doc(alice.firestore, dailyTombstonePath))
      ).data(),
    ).toMatchObject({
      schemaVersion: 1,
      localDate: "2026-07-14",
      lastMutationId: "daily-latest",
    });
    await setDoc(
      doc(alice.firestore, `users/${aliceUid}/privateDailyLogs/2026-07-14`),
      {
        schemaVersion: 2,
        localDate: "2026-07-14",
        lastMutationId: "daily-recreated",
        symptomTags: ["bloating"],
        updatedAt: serverTimestamp(),
      },
    );
    await waitForProjection(
      bob.firestore,
      projectionPath,
      data =>
        Array.isArray(data.symptomTags) &&
        data.symptomTags[0] === "bloating" &&
        data.dailyLogDate === "2026-07-14",
    );
    expect(
      (
        await getDocFromServer(doc(alice.firestore, dailyTombstonePath))
      ).exists(),
    ).toBe(false);
    await setDoc(
      doc(alice.firestore, settingsPath),
      shareSettings({periodDates: true, cyclePhase: true}),
    );
    await waitForProjection(
      bob.firestore,
      projectionPath,
      data =>
        data.cyclePhase === "luteal" &&
        data.cycleAsOfDate === "2026-07-14" &&
        (data.periodDates as {startDate?: string} | undefined)?.startDate ===
          "2026-07-10" &&
        !Object.hasOwn(data, "energyLevel") &&
        !Object.hasOwn(data, "conditionCode") &&
        !Object.hasOwn(data, "note"),
    );
    await updateDoc(doc(alice.firestore, settingsPath), {
      periodDates: false,
      cyclePhase: false,
    });
    const disabledCycleProjection = await waitForProjection(
      bob.firestore,
      projectionPath,
      data =>
        !Object.hasOwn(data, "periodDates") &&
        !Object.hasOwn(data, "cyclePhase"),
    );
    await new Promise(resolve => setTimeout(resolve, 5));
    await setDoc(
      doc(alice.firestore, `users/${aliceUid}/privateCycles/current`),
      {
        schemaVersion: 2,
        recordsCycle: false,
        consentAcceptedAt: "2026-07-14T00:00:00.000Z",
        consentVersion: "2026-08-09-v1",
        updatedAt: serverTimestamp(),
      },
    );
    const disabledCycleGeneratedAt =
      disabledCycleProjection.generatedAt as Timestamp;
    await waitForProjection(
      bob.firestore,
      projectionPath,
      data =>
        data.generatedAt instanceof Timestamp &&
        data.generatedAt.toMillis() > disabledCycleGeneratedAt.toMillis() &&
        !Object.hasOwn(data, "cyclePhase") &&
        !Object.hasOwn(data, "nextPeriodWindow"),
    );
    expect(
      (await getDocFromServer(doc(alice.firestore, pairPath))).data()
        ?.members?.[aliceUid]?.recordsCycle,
    ).toBe(false);
    expect(
      (
        await getDocFromServer(
          doc(
            alice.firestore,
            `users/${aliceUid}/pairMemberships/${pairId}`,
          ),
        )
      ).data()?.recordsCycle,
    ).toBe(false);

    const replayInvite = httpsCallable(charlie.functions, "acceptPairInvite");
    await expect(
      replayInvite({inviteToken, recordsCycle: false}),
    ).rejects.toMatchObject({code: "functions/failed-precondition"});

    const revoke = httpsCallable(alice.functions, "revokePair");
    const revoked = await revoke({pairId});
    expect(revoked.data).toMatchObject({pairId, alreadyRevoked: false});

    await expect(
      getDocFromServer(doc(bob.firestore, projectionPath)),
    ).rejects.toMatchObject({code: "permission-denied"});
    await expect(
      getDocFromServer(doc(bob.firestore, cleanupEventPath)),
    ).rejects.toMatchObject({code: "permission-denied"});
    expect(await emulatorDocumentExists(cleanupEventPath)).toBe(false);
    expect(
      await emulatorDocumentExists(
        `${pairPath}/eventMutations/mutation_cleanup`,
      ),
    ).toBe(false);
    expect(await emulatorDocumentExists(aliceInboxPath)).toBe(false);
    expect(await emulatorDocumentExists(aliceCooldownPath)).toBe(false);
    expect(await emulatorDocumentExists(bobCooldownPath)).toBe(false);
    const tombstonePath = `users/${bob.auth.currentUser?.uid}/cacheTombstones/${pairId}`;
    const tombstone = await getDocFromServer(doc(bob.firestore, tombstonePath));
    expect(tombstone.data()).toMatchObject({
      pairId,
      formerPartnerUid: alice.auth.currentUser?.uid,
      status: "pending",
    });
    const deletedSettings = await getDocFromServer(
      doc(alice.firestore, settingsPath),
    );
    expect(deletedSettings.exists()).toBe(false);

    const acknowledge = httpsCallable(
      bob.functions,
      "acknowledgeCacheTombstone",
    );
    await acknowledge({tombstoneId: pairId});
    const acknowledged = await getDocFromServer(
      doc(bob.firestore, tombstonePath),
    );
    expect(acknowledged.data()).toMatchObject({status: "acknowledged"});

    const beginAnonymous = httpsCallable(
      alice.functions,
      "beginAccountDeletion",
    );
    const preparation = (await beginAnonymous({uid: aliceUid})).data as {
      recoveryReceipt: string;
    };
    const deleteAnonymous = httpsCallable(alice.functions, "deleteMyAccount");
    await expect(deleteAnonymous({
      uid: bobUid,
      recoveryReceipt: preparation.recoveryReceipt,
    })).rejects.toMatchObject({
      code: "functions/permission-denied",
    });
    await expect(deleteAnonymous({
      uid: aliceUid,
      recoveryReceipt: preparation.recoveryReceipt,
    })).resolves.toMatchObject({
      data: {schemaVersion: 1, deleted: true},
    });
    const deletionStatus = httpsCallable(
      alice.functions,
      "getAccountDeletionStatus",
    );
    await expect(deletionStatus({
      uid: aliceUid,
      recoveryReceipt: preparation.recoveryReceipt,
    })).resolves.toMatchObject({
      data: {schemaVersion: 1, status: "completed"},
    });
    expect(
      await emulatorDocumentExists(`users/${aliceUid}/privateCycles/current`),
    ).toBe(false);
    expect(
      await emulatorDocumentExists(
        `users/${aliceUid}/privateDailyLogs/2026-07-14`,
      ),
    ).toBe(false);
    expect(await emulatorDocumentExists(`pairs/${pairId}`)).toBe(false);
    expect(
      await emulatorDocumentExists(`accountDeletionStates/${aliceUid}`),
    ).toBe(true);
  });

  test("deletion barrier rejects Pair mutations without reopening deleted data", async () => {
    const owner = await createClient("barrier-pair-owner");
    const partner = await createClient("barrier-pair-partner");
    const ownerUid = owner.auth.currentUser!.uid;
    const invite = await httpsCallable(
      owner.functions,
      "createPairInvite",
    )({recordsCycle: true});
    const accepted = await httpsCallable(
      partner.functions,
      "acceptPairInvite",
    )({
      inviteToken: (invite.data as {inviteToken: string}).inviteToken,
      recordsCycle: false,
    });
    const pairId = (accepted.data as {pairId: string}).pairId;
    await emulatorAdminSetDocument(
      `users/${ownerUid}/cacheTombstones/manual-barrier`,
      {
        pairId: {stringValue: pairId},
        status: {stringValue: "pending"},
      },
    );
    await emulatorAdminSetDocument(`accountDeletionStates/${ownerUid}`, {
      schemaVersion: {integerValue: "1"},
      status: {stringValue: "in-progress"},
    });

    const blockedCalls = [
      () => httpsCallable(owner.functions, "createPairInvite")({recordsCycle: true}),
      () => httpsCallable(owner.functions, "upsertPairEvent")({
        pairId,
        mutationId: "barrier-upsert",
        event: {id: "barrier-event", title: "차단", date: "2026-07-14"},
      }),
      () => httpsCallable(owner.functions, "deletePairEvent")({
        pairId,
        mutationId: "barrier-delete",
        eventId: "barrier-event",
      }),
      () => httpsCallable(owner.functions, "sendPartnerNudge")({
        pairId,
        requestId: "barrier-nudge",
        type: "check-in-request",
      }),
      () => httpsCallable(owner.functions, "acknowledgePartnerNudge")({
        pairId,
        requestId: "barrier-nudge",
      }),
      () => httpsCallable(owner.functions, "revokePair")({pairId}),
      () => httpsCallable(owner.functions, "acknowledgeCacheTombstone")({
        tombstoneId: "manual-barrier",
      }),
    ];
    for (const blocked of blockedCalls) {
      await expect(blocked()).rejects.toMatchObject({
        code: "functions/failed-precondition",
      });
    }
    expect(
      await emulatorDocumentExists(`pairs/${pairId}/events/barrier-event`),
    ).toBe(false);
  });

  test("deletes durable account data, Pair access, events, and Auth last", async () => {
    const email = "delete-account@example.test";
    const password = "Delete-me-1234!";
    const owner = await createEmailClient("delete-owner", email, password);
    const partner = await createClient("delete-partner");
    const ownerUid = owner.auth.currentUser!.uid;
    const partnerUid = partner.auth.currentUser!.uid;
    const notificationToken =
      "fcm_registration_token:APA91b-delete_owner_1234567890";
    const notificationTokenHash = createHash("sha256")
      .update(notificationToken)
      .digest("hex");
    const purchaseBindingHash = createHash("sha256")
      .update("google-play:delete-account-purchase")
      .digest("hex");

    await httpsCallable(
      owner.functions,
      "registerNotificationDevice",
    )({
      token: notificationToken,
      platform: "ios",
      locale: "ko-KR",
      quietHours: {
        start: "22:00",
        end: "08:00",
        timeZone: "Asia/Seoul",
      },
    });
    await httpsCallable(
      owner.functions,
      "getPurchaseAccountToken",
    )({});

    await setDoc(
      doc(owner.firestore, `users/${ownerUid}/privateCycles/current`),
      {
        schemaVersion: 2,
        recordsCycle: true,
        consentAcceptedAt: "2026-07-14T00:00:00.000Z",
        consentVersion: "2026-08-09-v1",
        updatedAt: serverTimestamp(),
      },
    );
    await setDoc(
      doc(owner.firestore, `users/${ownerUid}/privateDailyLogs/2026-07-14`),
      {
        schemaVersion: 2,
        localDate: "2026-07-14",
        lastMutationId: "delete-owner-daily",
        note: "삭제되어야 하는 본인 메모",
        updatedAt: serverTimestamp(),
      },
    );

    const createInvite = httpsCallable(owner.functions, "createPairInvite");
    const invite = await createInvite({recordsCycle: true});
    const inviteToken = (invite.data as {inviteToken: string}).inviteToken;
    const inviteHash = createHash("sha256").update(inviteToken).digest("hex");
    const acceptInvite = httpsCallable(partner.functions, "acceptPairInvite");
    const accepted = await acceptInvite({inviteToken, recordsCycle: false});
    const pairId = (accepted.data as {pairId: string}).pairId;
    const upsertEvent = httpsCallable(owner.functions, "upsertPairEvent");
    await upsertEvent({
      pairId,
      mutationId: "delete-account-event-mutation",
      event: {
        id: "delete_account_event",
        title: "삭제 대상 일정",
        date: "2026-07-14",
        note: "삭제 대상 일정 메모",
      },
    });

    await emulatorAdminSetDocument(`subscriptions/${ownerUid}`, {
      status: {stringValue: "active"},
    });
    await emulatorAdminSetDocument(`purchaseTokens/${purchaseBindingHash}`, {
      uid: {stringValue: ownerUid},
      provider: {stringValue: "google-play"},
    });
    await emulatorAdminSetDocument(`notificationTokens/${ownerUid}`, {
      token: {stringValue: "server-only-placeholder"},
    });

    const requestExport = httpsCallable(
      owner.functions,
      "requestAccountDataExport",
    );
    await expect(requestExport({uid: partnerUid})).rejects.toMatchObject({
      code: "functions/permission-denied",
    });
    const ticket = (await requestExport({uid: ownerUid})).data as {
      schemaVersion: number;
      exportSubjectUid: string;
      expiresAt: string;
      filename: string;
      singleUse: boolean;
      downloadUrl: string;
    };
    expect(ticket).toMatchObject({
      schemaVersion: 1,
      exportSubjectUid: ownerUid,
      filename: expect.stringMatching(
        /^cycle-pair-data-export-\d{4}-\d{2}-\d{2}\.json$/,
      ),
      singleUse: true,
    });
    expect(new Date(ticket.expiresAt).toISOString()).toBe(
      ticket.expiresAt,
    );
    expect(ticket.downloadUrl).toMatch(
      /^https:\/\/asia-northeast3-demo-cyclepair\.cloudfunctions\.net\/downloadAccountDataExport#token=[A-Za-z0-9_-]{43}$/,
    );
    const exportToken = exportTokenFromTicket(ticket);
    const exportTokenHash = createHash("sha256")
      .update(exportToken)
      .digest("hex");
    const exportTicketPath = `accountExportTickets/${exportTokenHash}`;
    expect(await emulatorDocumentExists(exportTicketPath)).toBe(true);
    await expect(
      getDocFromServer(doc(owner.firestore, exportTicketPath)),
    ).rejects.toMatchObject({code: "permission-denied"});

    const bootstrap = await fetch(
      functionsHttpUrl("downloadAccountDataExport"),
    );
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get("cache-control")).toContain("no-store");
    expect(bootstrap.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(await bootstrap.text()).not.toContain(exportToken);

    const download = await fetch(
      functionsHttpUrl("downloadAccountDataExport"),
      {
        method: "POST",
        headers: {authorization: `Bearer ${exportToken}`},
      },
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain(
      "application/json",
    );
    expect(download.headers.get("content-disposition")).toMatch(
      /^attachment; filename="cycle-pair-data-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(download.headers.get("cache-control")).toContain("no-store");
    const exported = await download.json() as {
      schemaVersion: number;
      exportedAt: string;
      exportSubjectUid: string;
      data: {
        privateCycles: {documents: Array<{id: string; data: unknown}>};
        privateDailyLogs: {documents: Array<{id: string; data: unknown}>};
        activePairs: Array<{
          pairId: string;
          sharedEvents: {documents: Array<{id: string; data: unknown}>};
        }>;
      };
    };
    expect(exported).toMatchObject({
      schemaVersion: 1,
      exportSubjectUid: ownerUid,
      data: {
        privateCycles: {
          documents: [{
            id: "current",
            data: {
              schemaVersion: 2,
              consentVersion: "2026-08-09-v1",
            },
          }],
        },
        privateDailyLogs: {documents: [{id: "2026-07-14"}]},
        activePairs: [{pairId}],
      },
    });
    expect(new Date(exported.exportedAt).toISOString()).toBe(
      exported.exportedAt,
    );
    expect(exported.data.activePairs[0]?.sharedEvents.documents).toContainEqual(
      {
        id: "delete_account_event",
        data: expect.any(Object),
      },
    );
    expect(await emulatorDocumentExists(exportTicketPath)).toBe(false);
    expect(
      await emulatorDocumentExists(`accountExportStates/${ownerUid}`),
    ).toBe(false);
    const replay = await fetch(
      functionsHttpUrl("downloadAccountDataExport"),
      {
        method: "POST",
        headers: {authorization: `Bearer ${exportToken}`},
      },
    );
    expect(replay.status).toBe(404);

    const anonymousExport = httpsCallable(
      partner.functions,
      "requestAccountDataExport",
    );
    await expect(anonymousExport({uid: partnerUid})).rejects.toMatchObject({
      code: "functions/failed-precondition",
    });

    // Leave one valid ticket outstanding and verify account deletion revokes
    // both its hash metadata and per-user active pointer before Auth removal.
    const pendingTicket = (await requestExport({uid: ownerUid})).data;
    const pendingToken = exportTokenFromTicket(pendingTicket);
    const pendingTokenHash = createHash("sha256")
      .update(pendingToken)
      .digest("hex");
    const pendingTicketPath = `accountExportTickets/${pendingTokenHash}`;
    expect(await emulatorDocumentExists(pendingTicketPath)).toBe(true);
    expect(
      await emulatorDocumentExists(`accountExportStates/${ownerUid}`),
    ).toBe(true);

    const beginDeletion = httpsCallable(
      owner.functions,
      "beginAccountDeletion",
    );
    const preparation = (await beginDeletion({uid: ownerUid})).data as {
      recoveryReceipt: string;
    };
    expect(preparation.recoveryReceipt).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(beginDeletion({uid: ownerUid})).resolves.toMatchObject({
      data: {recoveryReceipt: preparation.recoveryReceipt},
    });
    const preparedStatus = httpsCallable(
      partner.functions,
      "getAccountDeletionStatus",
    );
    await expect(preparedStatus({
      uid: ownerUid,
      recoveryReceipt: preparation.recoveryReceipt,
    })).resolves.toMatchObject({
      data: {schemaVersion: 1, status: "prepared"},
    });
    const deleteAccount = httpsCallable(owner.functions, "deleteMyAccount");
    const deleted = await deleteAccount({
      uid: ownerUid,
      recoveryReceipt: preparation.recoveryReceipt,
    });
    expect(deleted.data).toMatchObject({schemaVersion: 1, deleted: true});

    const unauthenticatedStatusClient = await createClient(
      "deleted-owner-status",
      false,
    );
    const deletionStatus = httpsCallable(
      unauthenticatedStatusClient.functions,
      "getAccountDeletionStatus",
    );
    await expect(deletionStatus({
      uid: ownerUid,
      recoveryReceipt: preparation.recoveryReceipt,
    })).resolves.toMatchObject({
      data: {schemaVersion: 1, status: "completed"},
    });
    await expect(deletionStatus({
      uid: ownerUid,
      recoveryReceipt: "x".repeat(43),
    })).rejects.toMatchObject({code: "functions/not-found"});

    expect(await emulatorDocumentExists(`users/${ownerUid}`)).toBe(false);
    expect(
      await emulatorDocumentExists(`users/${ownerUid}/privateCycles/current`),
    ).toBe(false);
    expect(
      await emulatorDocumentExists(
        `users/${ownerUid}/privateDailyLogs/2026-07-14`,
      ),
    ).toBe(false);
    expect(
      await emulatorDocumentExists(
        `users/${ownerUid}/privateDailyLogTombstones/2026-07-14`,
      ),
    ).toBe(false);
    expect(
      await emulatorDocumentExists(
        `users/${ownerUid}/notificationDevices/${notificationTokenHash}`,
      ),
    ).toBe(false);
    expect(await emulatorDocumentExists(`subscriptions/${ownerUid}`)).toBe(
      false,
    );
    expect(await emulatorDocumentExists(`purchaseStates/${ownerUid}`)).toBe(
      false,
    );
    expect(
      await emulatorDocumentExists(`purchaseTokens/${purchaseBindingHash}`),
    ).toBe(false);
    expect(await emulatorDocumentExists(`notificationTokens/${ownerUid}`)).toBe(
      false,
    );
    expect(await emulatorDocumentExists(pendingTicketPath)).toBe(false);
    expect(
      await emulatorDocumentExists(`accountExportStates/${ownerUid}`),
    ).toBe(false);
    expect(await emulatorDocumentExists(`pairBindings/${ownerUid}`)).toBe(
      false,
    );
    expect(await emulatorDocumentExists(`pairInvites/${inviteHash}`)).toBe(
      false,
    );
    expect(await emulatorDocumentExists(`pairs/${pairId}`)).toBe(false);
    expect(
      await emulatorDocumentExists(
        `pairs/${pairId}/events/delete_account_event`,
      ),
    ).toBe(false);
    expect(await emulatorDocumentExists(`pairTombstones/${pairId}`)).toBe(
      false,
    );
    expect(
      await emulatorDocumentExists(`accountDeletionStates/${ownerUid}`),
    ).toBe(true);
    await expect(
      setDoc(
        doc(owner.firestore, `users/${ownerUid}/privateDailyLogs/2026-07-15`),
        {
          schemaVersion: 2,
          localDate: "2026-07-15",
          lastMutationId: "stale-token-recreate",
          updatedAt: serverTimestamp(),
        },
      ),
    ).rejects.toMatchObject({code: "permission-denied"});

    const partnerTombstone = await getDocFromServer(
      doc(partner.firestore, `users/${partnerUid}/cacheTombstones/${pairId}`),
    );
    expect(partnerTombstone.data()).toMatchObject({
      type: "account-deleted",
      pairId,
      status: "pending",
    });
    expect(partnerTombstone.data()).not.toHaveProperty("formerPartnerUid");
    expect(partnerTombstone.data()).not.toHaveProperty("projectionOwnerUids");
    const partnerMembership = await getDocFromServer(
      doc(partner.firestore, `users/${partnerUid}/pairMemberships/${pairId}`),
    );
    expect(partnerMembership.data()).toMatchObject({
      status: "revoked",
      reason: "account-deleted",
    });
    expect(partnerMembership.data()).not.toHaveProperty("partnerUid");
    expect(partnerMembership.data()).not.toHaveProperty("memberUids");

    const loginCheck = await createClient("deleted-login-check", false);
    await expect(
      signInWithEmailAndPassword(loginCheck.auth, email, password),
    ).rejects.toMatchObject({
      code: expect.stringMatching(
        /^auth\/(?:user-not-found|invalid-credential)$/,
      ),
    });
  });
});
