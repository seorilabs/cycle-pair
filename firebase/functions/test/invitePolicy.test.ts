import {describe, expect, test} from "vitest";

import {
  INVITE_RATE_LIMIT_MAX,
  INVITE_RATE_LIMIT_WINDOW_MS,
  evaluateInviteRateLimit,
  inviteIsUsable,
} from "../src/domain/invitePolicy.js";

describe("invite rate policy", () => {
  test("starts a new window and permits up to the configured maximum", () => {
    const start = 1_000_000;
    let state = {windowStartedAtMillis: null, count: 0};

    for (let index = 0; index < INVITE_RATE_LIMIT_MAX; index += 1) {
      const decision = evaluateInviteRateLimit(state, start + index);
      expect(decision.allowed).toBe(true);
      state = decision.nextState;
    }

    const blocked = evaluateInviteRateLimit(state, start + 100);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMillis).toBeGreaterThan(0);
  });

  test("resets after the rate window", () => {
    const state = {windowStartedAtMillis: 1_000, count: INVITE_RATE_LIMIT_MAX};
    const decision = evaluateInviteRateLimit(
      state,
      1_000 + INVITE_RATE_LIMIT_WINDOW_MS,
    );

    expect(decision).toEqual({
      allowed: true,
      nextState: {
        windowStartedAtMillis: 1_000 + INVITE_RATE_LIMIT_WINDOW_MS,
        count: 1,
      },
      retryAfterMillis: 0,
    });
  });
});

describe("one-time invite policy", () => {
  const pendingInvite = {
    status: "pending",
    inviterUid: "alice",
    inviteEpoch: 3,
    expiresAtMillis: 5_000,
  };

  test("accepts only an unexpired pending invite at the current epoch", () => {
    expect(inviteIsUsable(pendingInvite, 3, "bob", 4_999)).toBe(true);
    expect(inviteIsUsable({...pendingInvite, status: "accepted"}, 3, "bob", 4_000)).toBe(false);
    expect(inviteIsUsable(pendingInvite, 4, "bob", 4_000)).toBe(false);
    expect(inviteIsUsable(pendingInvite, 3, "bob", 5_000)).toBe(false);
  });

  test("blocks self-invites", () => {
    expect(inviteIsUsable(pendingInvite, 3, "alice", 4_000)).toBe(false);
  });
});
