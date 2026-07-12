import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {doc, getDoc, setDoc, updateDoc} from "firebase/firestore";
import {afterAll, beforeAll, beforeEach, describe, test} from "vitest";

const PROJECT_ID = "demo-moonmate";

let testEnv: RulesTestEnvironment;

function emulatorAddress(): {host: string; port: number} {
  const raw = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const separator = raw.lastIndexOf(":");

  return {
    host: raw.slice(0, separator),
    port: Number(raw.slice(separator + 1)),
  };
}

beforeAll(async () => {
  const rulesPath = fileURLToPath(new URL("../firestore.rules", import.meta.url));
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      ...emulatorAddress(),
      rules: await readFile(rulesPath, "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function seedActivePair(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "pairs/pair-1"), {
      status: "active",
      memberUids: ["alice", "bob"],
      members: {
        alice: {recordsCycle: true},
        bob: {recordsCycle: false},
      },
    });
    await setDoc(doc(db, "pairs/pair-1/projections/alice"), {
      ownerUid: "alice",
      pairId: "pair-1",
      schemaVersion: 1,
      generatedAt: "2026-07-12T00:00:00.000Z",
      cyclePhase: "luteal",
    });
  });
}

describe("owner-only raw records", () => {
  test("owner can read and write cycle and daily-log documents", async () => {
    const ownerDb = testEnv.authenticatedContext("alice").firestore();
    const cycleRef = doc(ownerDb, "users/alice/privateCycles/current");
    const dailyRef = doc(ownerDb, "users/alice/privateDailyLogs/2026-07-12");

    await assertSucceeds(setDoc(cycleRef, {cyclePhase: "luteal"}));
    await assertSucceeds(setDoc(dailyRef, {moodTag: "calm"}));
    await assertSucceeds(getDoc(cycleRef));
    await assertSucceeds(getDoc(dailyRef));
  });

  test("another user and an unauthenticated client cannot access raw records", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(
        doc(context.firestore(), "users/alice/privateCycles/current"),
        {cyclePhase: "luteal"},
      );
    });

    const otherDb = testEnv.authenticatedContext("bob").firestore();
    const anonymousDb = testEnv.unauthenticatedContext().firestore();
    const ownerCyclePath = "users/alice/privateCycles/current";

    await assertFails(getDoc(doc(otherDb, ownerCyclePath)));
    await assertFails(setDoc(doc(otherDb, ownerCyclePath), {cyclePhase: "x"}));
    await assertFails(getDoc(doc(anonymousDb, ownerCyclePath)));
  });

  test("pair-scoped share settings remain owner-only", async () => {
    const ownerDb = testEnv.authenticatedContext("alice").firestore();
    const otherDb = testEnv.authenticatedContext("bob").firestore();
    const settingsPath = "users/alice/shareSettings/pair-1";

    await assertSucceeds(
      setDoc(doc(ownerDb, settingsPath), {cyclePhase: true, moodTag: false}),
    );
    await assertSucceeds(getDoc(doc(ownerDb, settingsPath)));
    await assertFails(getDoc(doc(otherDb, settingsPath)));
    await assertFails(setDoc(doc(otherDb, settingsPath), {cyclePhase: true}));
  });
});

describe("pair projection boundary", () => {
  test("both active members can read projections but neither can write them", async () => {
    await seedActivePair();
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const bobDb = testEnv.authenticatedContext("bob").firestore();
    const projectionPath = "pairs/pair-1/projections/alice";

    await assertSucceeds(getDoc(doc(aliceDb, projectionPath)));
    await assertSucceeds(getDoc(doc(bobDb, projectionPath)));
    await assertFails(updateDoc(doc(aliceDb, projectionPath), {cyclePhase: "x"}));
    await assertFails(updateDoc(doc(bobDb, projectionPath), {cyclePhase: "x"}));
  });

  test("an outsider cannot read a projection", async () => {
    await seedActivePair();
    const outsiderDb = testEnv.authenticatedContext("charlie").firestore();

    await assertFails(
      getDoc(doc(outsiderDb, "pairs/pair-1/projections/alice")),
    );
  });

  test("revoking the pair immediately blocks projection reads", async () => {
    await seedActivePair();
    await testEnv.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore(), "pairs/pair-1"), {
        status: "revoked",
      });
    });
    const bobDb = testEnv.authenticatedContext("bob").firestore();

    await assertFails(getDoc(doc(bobDb, "pairs/pair-1/projections/alice")));
  });
});

describe("server-managed lifecycle documents", () => {
  test("clients cannot create pairs, invites, bindings, or projections", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();

    await assertFails(setDoc(doc(db, "pairs/pair-2"), {status: "active"}));
    await assertFails(setDoc(doc(db, "pairInvites/hash"), {status: "pending"}));
    await assertFails(setDoc(doc(db, "pairBindings/alice"), {pairId: "pair-2"}));
    await assertFails(
      setDoc(doc(db, "pairs/pair-2/projections/alice"), {ownerUid: "alice"}),
    );
  });

  test("a user can read but cannot forge or acknowledge a cache tombstone", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(
        doc(context.firestore(), "users/alice/cacheTombstones/pair-1"),
        {pairId: "pair-1", status: "pending"},
      );
    });
    const ownerDb = testEnv.authenticatedContext("alice").firestore();
    const otherDb = testEnv.authenticatedContext("bob").firestore();
    const tombstonePath = "users/alice/cacheTombstones/pair-1";

    await assertSucceeds(getDoc(doc(ownerDb, tombstonePath)));
    await assertFails(updateDoc(doc(ownerDb, tombstonePath), {status: "acknowledged"}));
    await assertFails(getDoc(doc(otherDb, tombstonePath)));
  });
});
