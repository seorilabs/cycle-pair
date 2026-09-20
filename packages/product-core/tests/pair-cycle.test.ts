import { describe, expect, it } from "vitest";

import {
  CONDITION_CODES,
  MAX_EMOTIONS_PER_LOG,
  createCycle,
  createCycleLog,
  createPair,
  determineCyclePhase,
  isPairMember,
  otherMemberId,
  parseLocalDate,
} from "../src/index.js";
import type { EmotionCode, EnergyLevel } from "../src/index.js";

const date = parseLocalDate;

describe("Pair", () => {
  it("accepts exactly two distinct members", () => {
    const pair = createPair({
      id: "pair-1",
      memberIds: ["member-a", "member-b"],
      createdOn: date("2026-07-12"),
    });

    expect(pair.memberIds).toEqual(["member-a", "member-b"]);
    expect(isPairMember(pair, "member-a")).toBe(true);
    expect(otherMemberId(pair, "member-a")).toBe("member-b");
  });

  it.each([
    { memberIds: [] },
    { memberIds: ["member-a"] },
    { memberIds: ["member-a", "member-b", "member-c"] },
  ])("rejects a member list whose size is not two: $memberIds", ({ memberIds }) => {
    expect(() =>
      createPair({ id: "pair-1", memberIds, createdOn: date("2026-07-12") }),
    ).toThrow("exactly two");
  });

  it("rejects duplicate identities and non-member lookups", () => {
    expect(() =>
      createPair({
        id: "pair-1",
        memberIds: ["member-a", "member-a"],
        createdOn: date("2026-07-12"),
      }),
    ).toThrow("distinct");

    const pair = createPair({
      id: "pair-1",
      memberIds: ["member-a", "member-b"],
      createdOn: date("2026-07-12"),
    });
    expect(() => otherMemberId(pair, "member-c")).toThrow("does not belong");
  });
});

describe("Cycle and CycleLog", () => {
  it("enforces cycle and energy bounds", () => {
    expect(() =>
      createCycle({
        id: "cycle-1",
        memberId: "member-a",
        startedOn: date("2026-07-10"),
        endedOn: date("2026-07-09"),
      }),
    ).toThrow("must not precede");

    expect(() =>
      createCycleLog({
        id: "log-1",
        memberId: "member-a",
        date: date("2026-07-12"),
        energy: 6 as EnergyLevel,
      }),
    ).toThrow("between 1 and 5");
  });

  it("determines phase within one estimated cycle", () => {
    const common = {
      lastPeriodStart: date("2026-01-01"),
      averageCycleLengthDays: 28,
    };
    expect(determineCyclePhase({ ...common, on: date("2026-01-01") })).toMatchObject({
      phase: "menstrual",
      cycleDay: 1,
    });
    expect(determineCyclePhase({ ...common, on: date("2026-01-07") }).phase).toBe("follicular");
    expect(determineCyclePhase({ ...common, on: date("2026-01-14") }).phase).toBe("ovulatory");
    expect(determineCyclePhase({ ...common, on: date("2026-01-16") }).phase).toBe("luteal");
    expect(determineCyclePhase({ ...common, on: date("2026-01-29") })).toEqual({
      phase: "unknown",
      cycleDay: null,
      estimated: true,
    });
  });
});

describe("감정 축", () => {
  const log = (emotions: readonly EmotionCode[]) =>
    createCycleLog({
      id: "log-emotion",
      memberId: "member-a",
      date: parseLocalDate("2026-09-20"),
      emotions,
    });

  it("여러 감정을 동시에 담는다", () => {
    // 불안하면서 서운할 수 있다. 단일 선택으로는 담기지 않던 상태다.
    expect(log(["anxious", "hurt"]).emotions).toEqual(["anxious", "hurt"]);
  });

  it("상한까지는 받는다", () => {
    expect(log(["calm", "happy", "affectionate"]).emotions).toHaveLength(
      MAX_EMOTIONS_PER_LOG,
    );
  });

  it("상한을 넘기면 거절한다", () => {
    // 전부 고르면 아무 정보도 되지 않는다.
    expect(() => log(["calm", "happy", "affectionate", "lonely"])).toThrow(
      /at most 3/,
    );
  });

  it("같은 감정을 두 번 담지 않는다", () => {
    expect(() => log(["anxious", "anxious"])).toThrow(/must not repeat/);
  });

  it("기록을 바꿔도 원본 배열이 따라 바뀌지 않는다", () => {
    const source: EmotionCode[] = ["calm"];
    const created = log(source);
    source.push("hurt");
    expect(created.emotions).toEqual(["calm"]);
  });

  it("기력 축과 겹치던 몸 상태 값이 사라졌다", () => {
    // tired, low-energy 는 EnergyLevel 이, sensitive 는 EmotionCode 가 담는다.
    expect(CONDITION_CODES).toEqual([
      "comfortable",
      "cramps",
      "headache",
      "needs-space",
      "other",
    ]);
  });
});
