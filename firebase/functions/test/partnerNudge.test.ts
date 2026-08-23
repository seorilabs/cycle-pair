import {describe, expect, it} from "vitest";

import {
  PARTNER_NUDGE_COOLDOWN_MS,
  evaluatePartnerNudgeCooldown,
  parsePartnerNudgeType,
  partnerNudgeCooldownFields,
} from "../src/domain/partnerNudge.js";

describe("partner nudge policy", () => {
  it("accepts only the two fixed nudge types", () => {
    expect(parsePartnerNudgeType("check-in-request")).toBe("check-in-request");
    expect(parsePartnerNudgeType("care-acknowledgement"))
      .toBe("care-acknowledgement");
    expect(() => parsePartnerNudgeType("free-form-message")).toThrow(
      "넛지 종류가 올바르지 않습니다.",
    );
  });

  it("uses separate fields and cooldowns for each type", () => {
    expect(partnerNudgeCooldownFields("check-in-request")).toEqual({
      requestId: "checkInRequestId",
      sentAt: "checkInSentAt",
      nextAllowedAt: "checkInNextAllowedAt",
    });
    expect(partnerNudgeCooldownFields("care-acknowledgement"))
      .toEqual({
        requestId: "careAcknowledgementRequestId",
        sentAt: "careAcknowledgementSentAt",
        nextAllowedAt: "careAcknowledgementNextAllowedAt",
      });
  });

  it("allows the first request, makes retries idempotent, and blocks new IDs", () => {
    const now = Date.parse("2026-08-23T00:00:00.000Z");
    expect(evaluatePartnerNudgeCooldown({}, "nudge-1", now)).toEqual({
      kind: "allowed",
      nextAllowedAtMillis: now + PARTNER_NUDGE_COOLDOWN_MS,
    });
    expect(evaluatePartnerNudgeCooldown({
      requestId: "nudge-1",
      nextAllowedAtMillis: now + PARTNER_NUDGE_COOLDOWN_MS,
    }, "nudge-1", now + 1_000)).toEqual({
      kind: "idempotent",
      nextAllowedAtMillis: now + PARTNER_NUDGE_COOLDOWN_MS,
    });
    expect(evaluatePartnerNudgeCooldown({
      requestId: "nudge-1",
      nextAllowedAtMillis: now + PARTNER_NUDGE_COOLDOWN_MS,
    }, "nudge-2", now + 1_000)).toEqual({
      kind: "blocked",
      nextAllowedAtMillis: now + PARTNER_NUDGE_COOLDOWN_MS,
    });
  });
});
