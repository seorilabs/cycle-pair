import { describe, expect, it } from "vitest";

import {
  createCycle,
  createCycleLog,
  createPair,
  determineCyclePhase,
  isPairMember,
  otherMemberId,
  parseLocalDate,
} from "../src/index.js";
import type { EnergyLevel } from "../src/index.js";

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
