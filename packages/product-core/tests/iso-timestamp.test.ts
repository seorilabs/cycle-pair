import { describe, expect, it } from "vitest";

import {
  compareIsoTimestamps,
  isIsoTimestamp,
  parseIsoTimestamp,
} from "../src/index.js";

describe("IsoTimestamp", () => {
  it("accepts only canonical millisecond UTC timestamps", () => {
    expect(isIsoTimestamp("2026-07-12T12:34:56.789Z")).toBe(true);
    expect(isIsoTimestamp("2026-07-12T12:34:56Z")).toBe(false);
    expect(isIsoTimestamp("2026-07-12T21:34:56.789+09:00")).toBe(false);
    expect(() => parseIsoTimestamp("2026-02-30T00:00:00.000Z")).toThrow();
  });

  it("orders canonical instants chronologically", () => {
    expect(
      compareIsoTimestamps(
        parseIsoTimestamp("2026-07-12T12:00:00.000Z"),
        parseIsoTimestamp("2026-07-12T12:00:00.001Z"),
      ),
    ).toBe(-1);
  });
});
