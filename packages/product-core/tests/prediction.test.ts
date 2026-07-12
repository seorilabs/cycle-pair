import { describe, expect, it } from "vitest";

import {
  addDays,
  calculateAverageCycleLength,
  createCycle,
  parseLocalDate,
  predictFromCycleSeed,
  predictNextPeriod,
} from "../src/index.js";
import type { Cycle, LocalDate } from "../src/index.js";

const date = parseLocalDate;

function cyclesFromIntervals(start: LocalDate, intervals: readonly number[], memberId = "member-a"): Cycle[] {
  const starts = [start];
  for (const interval of intervals) {
    const previous = starts.at(-1);
    if (!previous) {
      throw new Error("missing cycle start");
    }
    starts.push(addDays(previous, interval));
  }
  return starts.map((startedOn, index) =>
    createCycle({ id: `cycle-${index}`, memberId, startedOn }),
  );
}

describe("cycle prediction", () => {
  it("keeps user-entered seed estimates explicitly low confidence", () => {
    const prediction = predictFromCycleSeed({
      memberId: "member-a",
      generatedOn: date("2026-07-12"),
      lastPeriodStart: date("2026-07-08"),
      averageCycleLengthDays: 28,
    });

    expect(prediction).toMatchObject({
      confidence: "low",
      sampleSize: 0,
      observedCycleLengths: [],
      nextPeriodDate: "2026-08-05",
      confidenceWindow: { start: "2026-07-29", end: "2026-08-12" },
    });
  });

  it("averages valid intervals and predicts from the latest start", () => {
    const cycles = cyclesFromIntervals(date("2026-01-01"), [28, 30, 29]);
    expect(calculateAverageCycleLength(cycles)).toBe(29);

    const prediction = predictNextPeriod(cycles, date("2026-04-01"));
    expect(prediction).not.toBeNull();
    expect(prediction).toMatchObject({
      averageCycleLengthDays: 29,
      confidence: "medium",
      sampleSize: 3,
      nextPeriodDate: "2026-04-27",
    });
    expect(prediction?.confidenceWindow).toEqual({
      start: "2026-04-23",
      end: "2026-05-01",
    });
  });

  it("assigns high confidence only to sufficient stable history", () => {
    const prediction = predictNextPeriod(
      cyclesFromIntervals(date("2026-01-01"), [28, 28, 29, 27, 28]),
      date("2026-05-20"),
    );
    expect(prediction?.confidence).toBe("high");
    expect(prediction?.sampleSize).toBe(5);
  });

  it("returns low confidence for sparse or partially excluded history", () => {
    expect(
      predictNextPeriod(cyclesFromIntervals(date("2026-01-01"), [28]), date("2026-01-10"))
        ?.confidence,
    ).toBe("low");

    const withGap = predictNextPeriod(
      cyclesFromIntervals(date("2026-01-01"), [28, 75, 28, 28]),
      date("2026-07-01"),
    );
    expect(withGap?.excludedIntervalCount).toBe(1);
    expect(withGap?.confidence).toBe("low");
  });

  it("needs at least one valid interval and rejects mixed-member history", () => {
    expect(
      predictNextPeriod(cyclesFromIntervals(date("2026-01-01"), []), date("2026-01-02")),
    ).toBeNull();

    const mixed = [
      ...cyclesFromIntervals(date("2026-01-01"), [], "member-a"),
      ...cyclesFromIntervals(date("2026-02-01"), [], "member-b"),
    ];
    expect(() => predictNextPeriod(mixed, date("2026-02-02"))).toThrow("one member");
  });
});
