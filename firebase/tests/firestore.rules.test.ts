import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {afterAll, beforeAll, beforeEach, describe, test} from "vitest";

const PROJECT_ID = "demo-cyclepair";

let testEnv: RulesTestEnvironment;

function emulatorAddress(): {host: string; port: number} {
  const raw = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8380";
  const separator = raw.lastIndexOf(":");

  return {
    host: raw.slice(0, separator),
    port: Number(raw.slice(separator + 1)),
  };
}

beforeAll(async () => {
  const rulesPath = fileURLToPath(
    new URL("../firestore.rules", import.meta.url),
  );
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
    await setDoc(doc(db, "users/alice/privateCycles/current"), {
      schemaVersion: 2,
      recordsCycle: true,
      consentAcceptedAt: "2026-08-09T00:00:00.000Z",
      consentVersion: "2026-08-09-v1",
      updatedAt: new Date("2026-08-09T00:00:00.000Z"),
    });
    await setDoc(doc(db, "pairs/pair-1/events/event-1"), {
      title: "산책",
      date: "2026-07-14",
      createdBy: "alice",
      updatedBy: "alice",
    });
  });
}

describe("owner-only raw records", () => {
  test("owner can read, write, and delete daily-log documents", async () => {
    const ownerDb = testEnv.authenticatedContext("alice").firestore();
    const cycleRef = doc(ownerDb, "users/alice/privateCycles/current");
    const dailyRef = doc(ownerDb, "users/alice/privateDailyLogs/2026-07-12");

    await assertSucceeds(
      setDoc(cycleRef, {
        schemaVersion: 2,
        recordsCycle: true,
        consentAcceptedAt: "2026-07-14T00:00:00.000Z",
        consentVersion: "2026-08-09-v1",
        asOfDate: "2026-07-14",
        averageCycleLength: 28,
        averagePeriodLength: 5,
        periodDates: {startDate: "2026-07-01"},
        cyclePhase: "ovulatory",
        cycleStatus: "fertile-window",
        nextPeriodWindow: {
          startDate: "2026-07-22",
          endDate: "2026-08-05",
        },
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(dailyRef, {
        schemaVersion: 2,
        localDate: "2026-07-12",
        lastMutationId: "daily-1",
        updatedAt: serverTimestamp(),
        moodTag: "neutral",
        energyLevel: 5,
        conditionCode: "comfortable",
        note: "x".repeat(500),
      }),
    );
    await assertSucceeds(getDoc(cycleRef));
    await assertSucceeds(getDoc(dailyRef));
    await assertSucceeds(deleteDoc(dailyRef));
  });

  test("cycle setup rejects unknown fields, invalid LocalDates, and unsafe ranges", async () => {
    const ownerDb = testEnv.authenticatedContext("alice").firestore();
    const cycleRef = doc(ownerDb, "users/alice/privateCycles/current");
    const valid = {
      schemaVersion: 2,
      recordsCycle: true,
      consentAcceptedAt: "2026-07-14T00:00:00.000Z",
      consentVersion: "2026-08-09-v1",
      asOfDate: "2026-07-14",
      averageCycleLength: 28,
      averagePeriodLength: 5,
      periodDates: {startDate: "2026-07-01"},
      cyclePhase: "follicular",
      nextPeriodWindow: {
        startDate: "2026-07-22",
        endDate: "2026-08-05",
      },
      updatedAt: serverTimestamp(),
    };

    await assertFails(setDoc(cycleRef, {...valid, privateLeak: true}));
    await assertFails(setDoc(cycleRef, {...valid, asOfDate: "2026-02-30"}));
    await assertFails(setDoc(cycleRef, {...valid, asOfDate: "9999-12-31"}));
    await assertFails(
      setDoc(cycleRef, {...valid, averageCycleLength: 61}),
    );
    await assertFails(
      setDoc(cycleRef, {
        ...valid,
        nextPeriodWindow: {
          startDate: "2026-07-22",
          endDate: "2027-01-01",
        },
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, "users/alice/privateCycles/forged"), valid),
    );
    await assertFails(
      setDoc(cycleRef, {
        schemaVersion: 2,
        recordsCycle: false,
        consentAcceptedAt: "2026-07-14T00:00:00.000Z",
        consentVersion: "2026-08-09-v1",
        cyclePhase: "luteal",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(cycleRef, {
        schemaVersion: 2,
        recordsCycle: false,
        consentAcceptedAt: "2026-07-14T00:00:00.000Z",
        consentVersion: "2026-08-09-v1",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test("legacy consent remains readable but cannot authorize new health writes", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(
        doc(context.firestore(), "users/alice/privateCycles/current"),
        {
          schemaVersion: 1,
          recordsCycle: false,
          consentAcceptedAt: "2026-07-14T00:00:00.000Z",
          updatedAt: new Date("2026-07-14T00:00:00.000Z"),
        },
      );
    });
    const ownerDb = testEnv.authenticatedContext("alice").firestore();
    const cycleRef = doc(ownerDb, "users/alice/privateCycles/current");
    const dailyRef = doc(
      ownerDb,
      "users/alice/privateDailyLogs/2026-07-14",
    );
    const dailyLog = {
      schemaVersion: 2,
      localDate: "2026-07-14",
      lastMutationId: "legacy-consent-blocked",
      updatedAt: serverTimestamp(),
    };

    await assertSucceeds(getDoc(cycleRef));
    await assertFails(setDoc(dailyRef, dailyLog));
    await assertSucceeds(
      setDoc(cycleRef, {
        schemaVersion: 2,
        recordsCycle: false,
        consentAcceptedAt: "2026-08-09T00:00:00.000Z",
        consentVersion: "2026-08-09-v1",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(setDoc(dailyRef, dailyLog));
  });

  test("daily logs reject unknown fields, invalid dates, and oversized notes", async () => {
    const ownerDb = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(
      setDoc(doc(ownerDb, "users/alice/privateCycles/current"), {
        schemaVersion: 2,
        recordsCycle: false,
        consentAcceptedAt: "2026-08-09T00:00:00.000Z",
        consentVersion: "2026-08-09-v1",
        updatedAt: serverTimestamp(),
      }),
    );
    const base = {
      schemaVersion: 2,
      localDate: "2026-07-12",
      lastMutationId: "daily-1",
      updatedAt: serverTimestamp(),
    };

    await assertFails(
      setDoc(doc(ownerDb, "users/alice/privateDailyLogs/2026-07-12"), {
        ...base,
        privateLeak: true,
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, "users/alice/privateDailyLogs/2026-07-13"), base),
    );
    await assertFails(
      setDoc(doc(ownerDb, "users/alice/privateDailyLogs/2026-07-12"), {
        ...base,
        note: "x".repeat(501),
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, "users/alice/privateDailyLogs/2026-07-12"), {
        ...base,
        energyLevel: 0,
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, "users/alice/privateDailyLogs/2026-07-12"), {
        ...base,
        energyLevel: 6,
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, "users/alice/privateDailyLogs/2026-07-12"), {
        ...base,
        conditionCode: "arbitrary-private-state",
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, "users/alice/privateDailyLogs/2026-07-12"), {
        ...base,
        periodStarted: true,
        periodEnded: true,
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, "users/alice/privateDailyLogs/2026-02-30"), {
        ...base,
        localDate: "2026-02-30",
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, "users/alice/privateDailyLogs/9999-12-31"), {
        ...base,
        localDate: "9999-12-31",
      }),
    );
  });

  test("another user and an unauthenticated client cannot access raw records", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(
        doc(context.firestore(), "users/alice/privateCycles/current"),
        {cyclePhase: "luteal"},
      );
      await setDoc(
        doc(context.firestore(), "users/alice/privateDailyLogs/2026-07-12"),
        {localDate: "2026-07-12"},
      );
    });

    const otherDb = testEnv.authenticatedContext("bob").firestore();
    const anonymousDb = testEnv.unauthenticatedContext().firestore();
    const ownerCyclePath = "users/alice/privateCycles/current";
    const ownerDailyPath = "users/alice/privateDailyLogs/2026-07-12";

    await assertFails(getDoc(doc(otherDb, ownerCyclePath)));
    await assertFails(setDoc(doc(otherDb, ownerCyclePath), {cyclePhase: "x"}));
    await assertFails(getDoc(doc(anonymousDb, ownerCyclePath)));
    await assertFails(deleteDoc(doc(otherDb, ownerDailyPath)));
    await assertFails(deleteDoc(doc(anonymousDb, ownerDailyPath)));
  });

  test("pair-scoped share settings remain owner-only", async () => {
    await seedActivePair();
    const ownerDb = testEnv.authenticatedContext("alice").firestore();
    const otherDb = testEnv.authenticatedContext("bob").firestore();
    const settingsPath = "users/alice/shareSettings/pair-1";

    await assertSucceeds(
      setDoc(doc(ownerDb, settingsPath), {
        schemaVersion: 1,
        updatedAt: serverTimestamp(),
        cyclePhase: true,
        cycleStatus: true,
        fertilityStatus: true,
        nextPeriodWindow: false,
        periodDates: false,
        moodTag: false,
        symptomTags: false,
        energyLevel: false,
        conditionCode: false,
        carePreferences: false,
        note: false,
      }),
    );
    await assertSucceeds(getDoc(doc(ownerDb, settingsPath)));
    await assertFails(getDoc(doc(otherDb, settingsPath)));
    await assertFails(setDoc(doc(otherDb, settingsPath), {cyclePhase: true}));
  });

  test("deletion barrier immediately blocks every owner health write", async () => {
    await seedActivePair();
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "accountDeletionStates/alice"), {
        schemaVersion: 1,
        status: "in-progress",
      });
      await setDoc(
        doc(context.firestore(), "users/alice/privateDailyLogs/2026-07-13"),
        {localDate: "2026-07-13"},
      );
    });
    const ownerDb = testEnv.authenticatedContext("alice").firestore();

    await assertFails(
      setDoc(doc(ownerDb, "users/alice/privateCycles/current"), {
        schemaVersion: 2,
        recordsCycle: false,
        consentAcceptedAt: "2026-07-14T00:00:00.000Z",
        consentVersion: "2026-08-09-v1",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, "users/alice/privateDailyLogs/2026-07-14"), {
        schemaVersion: 2,
        localDate: "2026-07-14",
        lastMutationId: "blocked-daily",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      deleteDoc(
        doc(ownerDb, "users/alice/privateDailyLogs/2026-07-13"),
      ),
    );
    await assertFails(
      setDoc(doc(ownerDb, "users/alice/shareSettings/pair-1"), {
        schemaVersion: 1,
        updatedAt: serverTimestamp(),
        cyclePhase: false,
        nextPeriodWindow: false,
        periodDates: false,
        moodTag: false,
        symptomTags: false,
        energyLevel: false,
        conditionCode: false,
        carePreferences: false,
        note: false,
      }),
    );
  });

  test("share settings cannot be replayed after Pair revoke or without a Pair", async () => {
    await seedActivePair();
    const ownerDb = testEnv.authenticatedContext("alice").firestore();
    const settings = {
      schemaVersion: 1,
      updatedAt: serverTimestamp(),
      cyclePhase: false,
      nextPeriodWindow: false,
      periodDates: false,
      moodTag: false,
      symptomTags: false,
      energyLevel: false,
      conditionCode: false,
      carePreferences: false,
      note: false,
    };

    await assertFails(
      setDoc(doc(ownerDb, "users/alice/shareSettings/missing-pair"), settings),
    );
    await testEnv.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore(), "pairs/pair-1"), {
        status: "revoked",
      });
    });
    await assertFails(
      setDoc(doc(ownerDb, "users/alice/shareSettings/pair-1"), settings),
    );
  });
});

describe("server-only notification devices", () => {
  test("no client can read or write an FCM registration document", async () => {
    const path = "users/alice/notificationDevices/token-hash";
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), path), {
        schemaVersion: 1,
        token: "server-only-registration-token",
        platform: "ios",
        locale: "ko-KR",
        quietHours: {
          start: "22:00",
          end: "08:00",
          timeZone: "Asia/Seoul",
        },
      });
    });
    const ownerDb = testEnv.authenticatedContext("alice").firestore();
    const otherDb = testEnv.authenticatedContext("bob").firestore();
    const anonymousDb = testEnv.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(ownerDb, path)));
    await assertFails(getDoc(doc(otherDb, path)));
    await assertFails(getDoc(doc(anonymousDb, path)));
    await assertFails(setDoc(doc(ownerDb, path), {token: "forged"}));
    await assertFails(updateDoc(doc(ownerDb, path), {locale: "en-US"}));
    await assertFails(deleteDoc(doc(ownerDb, path)));
  });
});

describe("server-only account export tickets", () => {
  test("no client can read, list, forge, update, or delete ticket metadata", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, "accountExportTickets/token-hash"), {
        schemaVersion: 1,
        uid: "alice",
        expiresAt: serverTimestamp(),
      });
      await setDoc(doc(db, "accountExportStates/alice"), {
        schemaVersion: 1,
        uid: "alice",
        activeTicketHash: "token-hash",
      });
    });
    const ownerDb = testEnv.authenticatedContext("alice").firestore();
    const otherDb = testEnv.authenticatedContext("bob").firestore();
    const anonymousDb = testEnv.unauthenticatedContext().firestore();

    for (const db of [ownerDb, otherDb, anonymousDb]) {
      await assertFails(getDoc(doc(db, "accountExportTickets/token-hash")));
      await assertFails(getDocs(collection(db, "accountExportTickets")));
      await assertFails(getDoc(doc(db, "accountExportStates/alice")));
    }
    await assertFails(
      setDoc(doc(ownerDb, "accountExportTickets/forged"), {uid: "alice"}),
    );
    await assertFails(
      updateDoc(doc(ownerDb, "accountExportStates/alice"), {
        activeTicketHash: "forged",
      }),
    );
    await assertFails(
      deleteDoc(doc(ownerDb, "accountExportTickets/token-hash")),
    );
  });
});

describe("server-verified subscription boundary", () => {
  test("owners can read their normalized state but no client can write it", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, "subscriptions/alice"), {
        schemaVersion: 1,
        status: "active",
        provider: "google-play",
        productId: "cyclepair_plus",
        basePlanId: "monthly",
      });
      await setDoc(doc(db, "purchaseStates/alice"), {
        schemaVersion: 1,
        accountToken: "11111111-1111-4111-8111-111111111111",
      });
      await setDoc(doc(db, "purchaseTokens/token-hash"), {
        schemaVersion: 1,
        uid: "alice",
        provider: "google-play",
      });
    });
    const ownerDb = testEnv.authenticatedContext("alice").firestore();
    const otherDb = testEnv.authenticatedContext("bob").firestore();
    const anonymousDb = testEnv.unauthenticatedContext().firestore();

    for (const path of ["subscriptions/alice", "purchaseStates/alice"]) {
      await assertSucceeds(getDoc(doc(ownerDb, path)));
      await assertFails(getDoc(doc(otherDb, path)));
      await assertFails(getDoc(doc(anonymousDb, path)));
      await assertFails(setDoc(doc(ownerDb, path), {status: "active"}));
      await assertFails(updateDoc(doc(ownerDb, path), {status: "active"}));
      await assertFails(deleteDoc(doc(ownerDb, path)));
    }

    await assertSucceeds(getDoc(doc(ownerDb, "purchaseTokens/token-hash")));
    await assertFails(getDoc(doc(otherDb, "purchaseTokens/token-hash")));
    await assertFails(
      setDoc(doc(ownerDb, "purchaseTokens/forged"), {uid: "alice"}),
    );
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
    await assertFails(
      updateDoc(doc(aliceDb, projectionPath), {cyclePhase: "x"}),
    );
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

  test("legacy consent immediately blocks an existing projection read", async () => {
    await seedActivePair();
    await testEnv.withSecurityRulesDisabled(async context => {
      await updateDoc(
        doc(context.firestore(), "users/alice/privateCycles/current"),
        {
          schemaVersion: 1,
          consentVersion: null,
        },
      );
    });
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const bobDb = testEnv.authenticatedContext("bob").firestore();
    const projectionPath = "pairs/pair-1/projections/alice";

    await assertFails(getDoc(doc(aliceDb, projectionPath)));
    await assertFails(getDoc(doc(bobDb, projectionPath)));
  });
});

describe("shared pair event boundary", () => {
  test("active members can read event documents and list the collection", async () => {
    await seedActivePair();
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const bobDb = testEnv.authenticatedContext("bob").firestore();
    const eventPath = "pairs/pair-1/events/event-1";

    await assertSucceeds(getDoc(doc(aliceDb, eventPath)));
    await assertSucceeds(getDoc(doc(bobDb, eventPath)));
    await assertSucceeds(getDocs(collection(bobDb, "pairs/pair-1/events")));
  });

  test("clients cannot directly create, update, or delete events", async () => {
    await seedActivePair();
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const eventPath = "pairs/pair-1/events/event-1";

    await assertFails(
      setDoc(doc(aliceDb, "pairs/pair-1/events/event-2"), {
        title: "위조 일정",
        date: "2026-07-14",
      }),
    );
    await assertFails(updateDoc(doc(aliceDb, eventPath), {title: "위조"}));
    await assertFails(deleteDoc(doc(aliceDb, eventPath)));
  });

  test("outsiders cannot read events or mutation receipts", async () => {
    await seedActivePair();
    const outsiderDb = testEnv.authenticatedContext("charlie").firestore();

    await assertFails(getDoc(doc(outsiderDb, "pairs/pair-1/events/event-1")));
    await assertFails(getDocs(collection(outsiderDb, "pairs/pair-1/events")));
    await assertFails(
      getDoc(doc(outsiderDb, "pairs/pair-1/eventMutations/mutation-1")),
    );
  });

  test("revoking the pair immediately blocks event reads", async () => {
    await seedActivePair();
    await testEnv.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore(), "pairs/pair-1"), {
        status: "revoked",
      });
    });
    const bobDb = testEnv.authenticatedContext("bob").firestore();

    await assertFails(getDoc(doc(bobDb, "pairs/pair-1/events/event-1")));
    await assertFails(getDocs(collection(bobDb, "pairs/pair-1/events")));
  });
});

describe("server-managed lifecycle documents", () => {
  test("clients cannot create pairs, invites, bindings, or projections", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();

    await assertFails(setDoc(doc(db, "pairs/pair-2"), {status: "active"}));
    await assertFails(setDoc(doc(db, "pairInvites/hash"), {status: "pending"}));
    await assertFails(
      setDoc(doc(db, "pairBindings/alice"), {pairId: "pair-2"}),
    );
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
    await assertFails(
      updateDoc(doc(ownerDb, tombstonePath), {status: "acknowledged"}),
    );
    await assertFails(getDoc(doc(otherDb, tombstonePath)));
  });
});
