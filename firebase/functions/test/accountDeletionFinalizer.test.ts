import {describe, expect, test, vi} from "vitest";

import {
  accountDeletionFinalizationFailureMessage,
  finalizeAccountDeletion,
  summarizeAccountDeletionFinalizations,
} from "../src/services/accountDeletionFinalizer.js";

describe("account deletion finalization", () => {
  test("marks the permanent barrier completed only after owner data and Auth deletion", async () => {
    const calls: string[] = [];
    await finalizeAccountDeletion({
      deleteRemainingData: vi.fn(async () => {
        calls.push("data");
      }),
      deleteAuthUser: vi.fn(async () => {
        calls.push("auth");
      }),
      completeDeletionState: vi.fn(async () => {
        calls.push("state");
      }),
    });
    expect(calls).toEqual(["data", "auth", "state"]);
  });

  test("keeps the retry barrier when Firebase Auth deletion fails", async () => {
    const transientFailure = new Error("transient auth failure");
    const completeDeletionState = vi.fn(async () => undefined);
    await expect(finalizeAccountDeletion({
      deleteRemainingData: vi.fn(async () => undefined),
      deleteAuthUser: vi.fn(async () => {
        throw transientFailure;
      }),
      completeDeletionState,
    })).rejects.toBe(transientFailure);
    expect(completeDeletionState).not.toHaveBeenCalled();
  });
});

describe("account deletion finalization report", () => {
  const settle = (
    entries: readonly ({value: string | null} | {reason: unknown})[],
  ): PromiseSettledResult<string | null>[] =>
    entries.map(entry =>
      "reason" in entry
        ? {status: "rejected", reason: entry.reason}
        : {status: "fulfilled", value: entry.value},
    );
  const code = (reason: unknown) =>
    typeof (reason as {code?: unknown})?.code === "string"
      ? (reason as {code: string}).code
      : "unknown";

  test("counts completed, busy, and failed results apart", () => {
    const report = summarizeAccountDeletionFinalizations(
      settle([
        {value: "2026-09-19T13:20:58.204Z"},
        {value: null},
        {reason: {code: "auth/insufficient-permission"}},
      ]),
      code,
    );
    expect(report).toEqual({
      completed: 1,
      busy: 1,
      failed: 1,
      failureCodes: ["auth/insufficient-permission"],
    });
  });

  test("records why a finalization failed instead of only counting it", () => {
    // 이 증거가 없으면 예약 재시도가 원인을 남기지 않은 채 무한히 실패한다.
    const report = summarizeAccountDeletionFinalizations(
      settle([{reason: {code: "auth/insufficient-permission"}}]),
      code,
    );
    expect(report.failureCodes).toEqual(["auth/insufficient-permission"]);
  });

  test("folds duplicate codes and keeps a stable order", () => {
    const report = summarizeAccountDeletionFinalizations(
      settle([
        {reason: {code: "unavailable"}},
        {reason: {code: "auth/insufficient-permission"}},
        {reason: {code: "unavailable"}},
      ]),
      code,
    );
    expect(report.failureCodes).toEqual([
      "auth/insufficient-permission",
      "unavailable",
    ]);
    expect(report.failed).toBe(3);
  });

  test("carries the failure codes into the thrown message", () => {
    // ERROR 로그 한 줄만 봐도 원인이 남아야 한다.
    const message = accountDeletionFinalizationFailureMessage({
      completed: 0,
      busy: 0,
      failed: 1,
      failureCodes: ["auth/insufficient-permission"],
    });
    expect(message).toContain("auth/insufficient-permission");
  });
});
