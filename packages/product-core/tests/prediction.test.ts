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
      daysLate: 0,
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
      daysLate: 0,
    });
    expect(prediction?.confidenceWindow).toEqual({
      start: "2026-04-23",
      end: "2026-05-01",
    });
  });

  it("reports lateness from the generated date without moving the predicted date", () => {
    const seedPrediction = predictFromCycleSeed({
      memberId: "member-a",
      generatedOn: date("2026-08-15"),
      lastPeriodStart: date("2026-07-08"),
      averageCycleLengthDays: 28,
    });
    expect(seedPrediction.nextPeriodDate).toBe("2026-08-05");
    expect(seedPrediction.daysLate).toBe(10);

    const observedPrediction = predictNextPeriod(
      cyclesFromIntervals(date("2026-05-08"), [28, 28, 28]),
      date("2026-08-15"),
    );
    expect(observedPrediction?.nextPeriodDate).toBe("2026-08-28");
    expect(observedPrediction?.daysLate).toBe(0);
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

  it("recovers high confidence when an excluded interval is older than recent history", () => {
    const prediction = predictNextPeriod(
      cyclesFromIntervals(date("2024-01-01"), [75, ...Array(20).fill(28)]),
      date("2026-01-01"),
    );

    expect(prediction).not.toBeNull();
    if (!prediction) {
      throw new Error("prediction fixture failed");
    }
    expect(prediction?.excludedIntervalCount).toBe(1);
    expect(prediction?.confidence).toBe("high");
    expect(prediction?.confidenceWindow).toEqual({
      start: addDays(prediction.nextPeriodDate, -2),
      end: addDays(prediction.nextPeriodDate, 2),
    });
  });

  it("keeps low confidence when the most recent interval is excluded", () => {
    const prediction = predictNextPeriod(
      cyclesFromIntervals(date("2026-01-01"), [28, 28, 28, 28, 28, 75]),
      date("2026-08-01"),
    );

    expect(prediction?.excludedIntervalCount).toBe(1);
    expect(prediction?.confidence).toBe("low");
  });

  it("limits exclusion impact to the latest six interval positions", () => {
    const excludedSixthFromLatest = predictNextPeriod(
      cyclesFromIntervals(date("2025-01-01"), [28, 28, 28, 28, 28, 28, 75, 28, 28, 28, 28, 28]),
      date("2026-03-01"),
    );
    const excludedSeventhFromLatest = predictNextPeriod(
      cyclesFromIntervals(date("2025-01-01"), [28, 28, 28, 28, 28, 75, 28, 28, 28, 28, 28, 28]),
      date("2026-03-01"),
    );

    expect(excludedSixthFromLatest?.confidence).toBe("low");
    expect(excludedSeventhFromLatest?.confidence).toBe("high");
    expect(excludedSeventhFromLatest?.excludedIntervalCount).toBe(1);
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
