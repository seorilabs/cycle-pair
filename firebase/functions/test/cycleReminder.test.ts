import {describe, expect, test} from "vitest";

import {
  predictedPeriodDateFor,
  sharesCycleReminderFields,
  shouldDeliverCycleReminderOn,
} from "../src/domain/cycleReminder.js";
import {deliverPredictedPeriodReminders} from "../src/services/cycleReminder.js";
import {neutralNotificationContent} from "../src/domain/notification.js";

type JsonRecord = Record<string, unknown>;

const OWNER = "owner-uid";
const PARTNER = "partner-uid";
const PAIR_ID = "pair-1";

/** 마지막 시작일 2026-07-01, 평균 28일 -> 예정일 2026-07-29 */
function storedCycle(overrides: JsonRecord = {}): JsonRecord {
  return {
    recordsCycle: true,
    averageCycleLength: 28,
    averagePeriodLength: 5,
    periodDates: {startDate: "2026-07-01"},
    ...overrides,
  };
}

function baseInput(today: string, overrides: JsonRecord = {}) {
  return {
    privateCycle: storedCycle(),
    shareSettings: {cycleStatus: true},
    today,
    ...overrides,
  };
}

describe("cycle reminder domain", () => {
  test("예정일 3일 전과 당일에만 배달일로 본다", () => {
    expect(shouldDeliverCycleReminderOn(baseInput("2026-07-26"))).toBe(true);
    expect(shouldDeliverCycleReminderOn(baseInput("2026-07-29"))).toBe(true);
    expect(shouldDeliverCycleReminderOn(baseInput("2026-07-25"))).toBe(false);
    expect(shouldDeliverCycleReminderOn(baseInput("2026-07-27"))).toBe(false);
    expect(shouldDeliverCycleReminderOn(baseInput("2026-07-28"))).toBe(false);
  });

  test("공유 동의가 없으면 어떤 날에도 배달하지 않는다", () => {
    for (const today of ["2026-07-26", "2026-07-29"]) {
      expect(
        shouldDeliverCycleReminderOn(
          baseInput(today, {shareSettings: {moodTag: true}}),
        ),
      ).toBe(false);
      expect(
        shouldDeliverCycleReminderOn(baseInput(today, {shareSettings: {}})),
      ).toBe(false);
      expect(
        shouldDeliverCycleReminderOn(
          baseInput(today, {shareSettings: undefined}),
        ),
      ).toBe(false);
    }
  });

  test("nextPeriodWindow 동의만 있어도 배달한다", () => {
    expect(
      shouldDeliverCycleReminderOn(
        baseInput("2026-07-26", {shareSettings: {nextPeriodWindow: true}}),
      ),
    ).toBe(true);
  });

  test("동의 값이 불리언 true 가 아니면 동의로 보지 않는다", () => {
    expect(sharesCycleReminderFields({cycleStatus: "true"})).toBe(false);
    expect(sharesCycleReminderFields({cycleStatus: 1})).toBe(false);
    expect(sharesCycleReminderFields({cycleStatus: true})).toBe(true);
  });

  test("손상된 주기 기록으로 예정일을 단정하지 않는다", () => {
    const invalid: JsonRecord[] = [
      storedCycle({averageCycleLength: 0}),
      storedCycle({averageCycleLength: 14}),
      storedCycle({averageCycleLength: 61}),
      storedCycle({averageCycleLength: 28.5}),
      storedCycle({periodDates: {startDate: "2026-7-1"}}),
      storedCycle({periodDates: undefined}),
      {},
    ];
    for (const privateCycle of invalid) {
      expect(predictedPeriodDateFor(privateCycle)).toBeNull();
      expect(
        shouldDeliverCycleReminderOn(baseInput("2026-07-26", {privateCycle})),
      ).toBe(false);
    }
  });

  test("알림 본문에 주기·건강 정보가 없다", () => {
    const content = neutralNotificationContent("pair-update");
    const serialized = JSON.stringify(content);

    expect(content.notification.title).toBe("사이클 페어");
    expect(content.notification.body).toBe("함께 확인할 업데이트가 있어요.");
    // 국면·상태·증상·날짜가 본문으로 새지 않는다.
    expect(serialized).not.toMatch(
      /menstrual|follicular|ovulatory|luteal|fertile|period|생리|배란|가임|예정일|증상|\d{4}-\d{2}-\d{2}/,
    );
  });
});

interface FakeDoc {
  readonly path: string;
}

function fakeFirestore(seed: Record<string, JsonRecord>) {
  const store = new Map<string, JsonRecord>(Object.entries(seed));
  const transactionRuns: number[] = [];
  const db = {
    doc(path: string): FakeDoc {
      return {path};
    },
    collection(name: string) {
      return {
        where(field: string, _operator: string, value: unknown) {
          return {
            limit(_count: number) {
              return {
                async get() {
                  const docs = [...store.entries()]
                    .filter(
                      ([path, data]) =>
                        path.startsWith(`${name}/`) &&
                        path.split("/").length === 2 &&
                        data[field] === value,
                    )
                    .map(([path, data]) => ({
                      id: path.split("/")[1] as string,
                      data: () => data,
                    }));
                  return {docs, size: docs.length};
                },
              };
            },
          };
        },
      };
    },
    async runTransaction<T>(
      run: (transaction: {
        get(reference: FakeDoc): Promise<{exists: boolean}>;
        set(reference: FakeDoc, data: JsonRecord): void;
      }) => Promise<T>,
    ): Promise<T> {
      transactionRuns.push(1);
      const writes: [string, JsonRecord][] = [];
      const result = await run({
        async get(reference) {
          return {exists: store.has(reference.path)};
        },
        set(reference, data) {
          writes.push([reference.path, data]);
        },
      });
      for (const [path, data] of writes) store.set(path, data);
      return result;
    },
  };
  // db.doc(path).get() 지원
  const originalDoc = db.doc.bind(db);
  db.doc = (path: string) =>
    Object.assign(originalDoc(path), {
      async get() {
        const data = store.get(path);
        return {exists: data !== undefined, data: () => data};
      },
    }) as FakeDoc;
  return {db, store, transactionRuns};
}

function seedForPair(overrides: Record<string, JsonRecord> = {}) {
  return {
    [`pairs/${PAIR_ID}`]: {
      status: "active",
      members: {[OWNER]: {recordsCycle: true}, [PARTNER]: {}},
    },
    [`users/${OWNER}/privateCycles/current`]: storedCycle(),
    [`users/${OWNER}/shareSettings/${PAIR_ID}`]: {cycleStatus: true},
    ...overrides,
  };
}

describe("cycle reminder delivery", () => {
  test("배달일에 파트너 한 명에게 한 번 보낸다", async () => {
    const {db} = fakeFirestore(seedForPair());
    const delivered: string[] = [];

    const report = await deliverPredictedPeriodReminders(db as never, {
      today: "2026-07-26",
      deliver: async uid => {
        delivered.push(uid);
      },
    });

    expect(delivered).toEqual([PARTNER]);
    expect(report).toMatchObject({
      pairCandidates: 1,
      eligibleRecipients: 1,
      delivered: 1,
      alreadyDelivered: 0,
    });
  });

  test("같은 배달일에 두 번 실행해도 발송은 1회다", async () => {
    const {db} = fakeFirestore(seedForPair());
    const delivered: string[] = [];
    const run = () =>
      deliverPredictedPeriodReminders(db as never, {
        today: "2026-07-26",
        deliver: async uid => {
          delivered.push(uid);
        },
      });

    await run();
    const second = await run();

    expect(delivered).toEqual([PARTNER]);
    expect(second).toMatchObject({delivered: 0, alreadyDelivered: 1});
  });

  test("공유 동의가 없는 페어에는 리마인더를 만들지 않는다", async () => {
    const {db} = fakeFirestore(
      seedForPair({
        [`users/${OWNER}/shareSettings/${PAIR_ID}`]: {moodTag: true},
      }),
    );
    const delivered: string[] = [];

    const report = await deliverPredictedPeriodReminders(db as never, {
      today: "2026-07-26",
      deliver: async uid => {
        delivered.push(uid);
      },
    });

    expect(delivered).toEqual([]);
    expect(report).toMatchObject({eligibleRecipients: 0, delivered: 0});
  });

  test("주기를 기록하지 않는 멤버는 대상이 아니다", async () => {
    const {db} = fakeFirestore(
      seedForPair({
        [`users/${OWNER}/privateCycles/current`]: storedCycle({
          recordsCycle: false,
        }),
      }),
    );
    const delivered: string[] = [];

    await deliverPredictedPeriodReminders(db as never, {
      today: "2026-07-26",
      deliver: async uid => {
        delivered.push(uid);
      },
    });

    expect(delivered).toEqual([]);
  });

  test("배달일이 아니면 아무에게도 보내지 않는다", async () => {
    const {db} = fakeFirestore(seedForPair());
    const delivered: string[] = [];

    await deliverPredictedPeriodReminders(db as never, {
      today: "2026-07-20",
      deliver: async uid => {
        delivered.push(uid);
      },
    });

    expect(delivered).toEqual([]);
  });
});
