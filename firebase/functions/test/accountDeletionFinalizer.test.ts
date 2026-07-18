import {describe, expect, test, vi} from "vitest";

import {finalizeAccountDeletion} from "../src/services/accountDeletionFinalizer.js";

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
