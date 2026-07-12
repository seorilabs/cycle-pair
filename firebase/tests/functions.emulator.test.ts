import {FirebaseApp, deleteApp, initializeApp} from "firebase/app";
import {
  Auth,
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  Firestore,
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getFirestore,
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

const PROJECT_ID = "demo-moonmate";
const apps: FirebaseApp[] = [];

interface EmulatorClient {
  readonly app: FirebaseApp;
  readonly auth: Auth;
  readonly firestore: Firestore;
  readonly functions: Functions;
}

async function createClient(name: string, authenticate = true): Promise<EmulatorClient> {
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
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);

  if (authenticate) {
    await signInAnonymously(auth);
  }

  return {app, auth, firestore, functions};
}

async function waitForProjection(
  firestore: Firestore,
  path: string,
  predicate: (data: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const snapshot = await getDocFromServer(doc(firestore, path));
    const data = snapshot.data() as Record<string, unknown> | undefined;
    if (data !== undefined && predicate(data)) {
      return data;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`projection did not converge: ${path}`);
}

afterAll(async () => {
  await Promise.all(apps.map(app => deleteApp(app)));
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
    const projection = await getDocFromServer(doc(bob.firestore, projectionPath));
    expect(projection.data()).toMatchObject({
      pairId,
      ownerUid: alice.auth.currentUser?.uid,
      schemaVersion: 1,
    });
    expect(projection.data()).not.toHaveProperty("cyclePhase");
    await expect(
      updateDoc(doc(bob.firestore, projectionPath), {moodTag: "forged"}),
    ).rejects.toMatchObject({code: "permission-denied"});

    const aliceUid = alice.auth.currentUser!.uid;
    const settingsPath = `users/${aliceUid}/shareSettings/${pairId}`;
    await setDoc(doc(alice.firestore, `users/${aliceUid}/privateCycles/current`), {
      periodDates: {startDate: "2026-07-10"},
      cyclePhase: "luteal",
      shareSettings: {cyclePhase: true},
      updatedAt: Timestamp.now(),
    });
    await waitForProjection(
      bob.firestore,
      projectionPath,
      data => !Object.hasOwn(data, "cyclePhase"),
    );
    await setDoc(doc(alice.firestore, settingsPath), {
      periodDates: true,
      cyclePhase: true,
      updatedAt: Timestamp.now(),
    });
    await waitForProjection(
      bob.firestore,
      projectionPath,
      data =>
        data.cyclePhase === "luteal" &&
        (data.periodDates as {startDate?: string} | undefined)?.startDate ===
          "2026-07-10",
    );
    await updateDoc(doc(alice.firestore, settingsPath), {
      periodDates: false,
      cyclePhase: false,
    });
    await waitForProjection(
      bob.firestore,
      projectionPath,
      data =>
        !Object.hasOwn(data, "periodDates") &&
        !Object.hasOwn(data, "cyclePhase"),
    );

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
    const acknowledged = await getDocFromServer(doc(bob.firestore, tombstonePath));
    expect(acknowledged.data()).toMatchObject({status: "acknowledged"});
  });
});
