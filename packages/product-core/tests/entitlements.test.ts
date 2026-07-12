import { describe, expect, it } from "vitest";

import { determineEntitlement, hasEntitlement, parseLocalDate } from "../src/index.js";

const date = parseLocalDate;
const today = date("2026-07-12");

describe("subscription entitlements", () => {
  it("grants the free feature set when there is no subscription", () => {
    const entitlement = determineEntitlement({ status: "none" }, today);
    expect(entitlement.tier).toBe("free");
    expect(hasEntitlement(entitlement, "cycle-tracking")).toBe(true);
    expect(hasEntitlement(entitlement, "full-care-tips")).toBe(false);
  });

  it("grants premium through the inclusive active period end", () => {
    const entitlement = determineEntitlement(
      { status: "active", currentPeriodEnd: date("2026-07-12") },
      today,
    );
    expect(entitlement).toMatchObject({
      tier: "premium",
      reason: "active-subscription",
      validUntil: "2026-07-12",
    });
    expect(hasEntitlement(entitlement, "full-care-tips")).toBe(true);
  });

  it("keeps a canceled subscription until its paid-through date", () => {
    expect(
      determineEntitlement(
        { status: "canceled", currentPeriodEnd: date("2026-07-20") },
        today,
      ).tier,
    ).toBe("premium");
    expect(
      determineEntitlement(
        { status: "canceled", currentPeriodEnd: date("2026-07-11") },
        today,
      ).tier,
    ).toBe("free");
  });

  it("honors a bounded grace period and fails closed on incomplete state", () => {
    expect(
      determineEntitlement(
        { status: "grace-period", gracePeriodEnd: date("2026-07-13") },
        today,
      ).tier,
    ).toBe("premium");
    expect(determineEntitlement({ status: "active" }, today)).toMatchObject({
      tier: "free",
      reason: "invalid-subscription-state",
    });
    expect(determineEntitlement({ status: "unknown" }, today).tier).toBe("free");
  });

  it("reserves multiple-connections without enabling it in the MVP", () => {
    const premium = determineEntitlement(
      { status: "active", currentPeriodEnd: date("2026-08-01") },
      today,
    );
    expect(hasEntitlement(premium, "multiple-connections")).toBe(false);
  });
});
