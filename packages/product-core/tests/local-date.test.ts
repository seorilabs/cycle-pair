import { describe, expect, it } from "vitest";

import {
  addDays,
  compareLocalDates,
  daysBetween,
  isLocalDate,
  localDate,
  parseLocalDate,
  sortUniqueLocalDates,
} from "../src/index.js";

describe("LocalDate", () => {
  it("validates real Gregorian calendar dates", () => {
    expect(parseLocalDate("2024-02-29")).toBe("2024-02-29");
    expect(isLocalDate("2025-02-29")).toBe(false);
    expect(() => parseLocalDate("2025-02-29")).toThrow("Invalid LocalDate");
    expect(() => parseLocalDate("2026-2-01")).toThrow("Invalid LocalDate");
    expect(() => localDate(0, 1, 1)).toThrow("Invalid LocalDate");
  });

  it("does calendar arithmetic without local time-zone conversion", () => {
    const leapDay = parseLocalDate("2024-02-29");
    expect(addDays(leapDay, 1)).toBe("2024-03-01");
    expect(addDays(parseLocalDate("2025-01-01"), -1)).toBe("2024-12-31");
    expect(daysBetween(parseLocalDate("2024-02-28"), parseLocalDate("2024-03-01"))).toBe(2);
    expect(() => addDays(leapDay, 0.5)).toThrow("integer");
  });

  it("compares and deduplicates dates", () => {
    const first = parseLocalDate("2026-01-01");
    const second = parseLocalDate("2026-01-02");
    expect(compareLocalDates(first, second)).toBe(-1);
    expect(sortUniqueLocalDates([second, first, second])).toEqual([first, second]);
  });
});
