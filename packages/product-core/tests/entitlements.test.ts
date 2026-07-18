import { describe, expect, it } from "vitest";

import {
  determineEntitlement,
  determineEntitlementAt,
  hasEntitlement,
  parseIsoTimestamp,
  parseLocalDate,
} from "../src/index.js";
import type {
  SubscriptionPaymentState,
  SubscriptionRenewalState,
  SubscriptionSnapshot,
  SubscriptionStatus,
} from "../src/index.js";

const date = parseLocalDate;
const today = date("2026-07-12");
const instant = parseIsoTimestamp;
const now = instant("2026-07-12T12:00:00.000Z");

function exactSnapshot(
  status: SubscriptionStatus,
  paymentState: SubscriptionPaymentState,
  renewalState: SubscriptionRenewalState,
  expiresAt = "2026-08-12T12:00:00.000Z",
): SubscriptionSnapshot {
  return {
    status,
    provider: "google-play",
    productId: "cyclepair_plus",
    basePlanId: "monthly",
    renewalState,
    paymentState,
    expiresAt: instant(expiresAt),
    verifiedAt: instant("2026-07-12T11:59:00.000Z"),
  };
}

describe("subscription entitlements", () => {
  it("maps an exact-time evaluation with no subscription to the free tier", () => {
    expect(determineEntitlementAt({ status: "none" }, now)).toMatchObject({
      tier: "free",
      reason: "no-subscription",
    });
  });

  it("grants the free feature set when there is no subscription", () => {
    const entitlement = determineEntitlement({ status: "none" }, today);
    expect(entitlement.tier).toBe("free");
    expect(hasEntitlement(entitlement, "cycle-tracking")).toBe(true);
    expect(hasEntitlement(entitlement, "data-export")).toBe(true);
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

  it("maps a pending store payment to free without finishing the entitlement", () => {
    expect(
      determineEntitlementAt(exactSnapshot("pending", "pending", "unknown"), now),
    ).toMatchObject({ tier: "free", reason: "pending-payment" });
  });

  it("maps an exact active paid period to premium", () => {
    expect(
      determineEntitlementAt(exactSnapshot("active", "paid", "will-renew"), now),
    ).toMatchObject({
      tier: "premium",
      reason: "active-subscription",
      validUntil: "2026-08-12",
    });
  });

  it("keeps an exact grace period only until its grace expiry", () => {
    const snapshot: SubscriptionSnapshot = {
      ...exactSnapshot("grace-period", "grace-period", "billing-retry"),
      expiresAt: instant("2026-07-10T12:00:00.000Z"),
      gracePeriodExpiresAt: instant("2026-07-14T12:00:00.000Z"),
    };

    expect(determineEntitlementAt(snapshot, now)).toMatchObject({
      tier: "premium",
      reason: "grace-period",
    });
    expect(
      determineEntitlementAt(snapshot, instant("2026-07-14T12:00:00.000Z")),
    ).toMatchObject({ tier: "free", reason: "expired" });
  });

  it("fails closed during account hold", () => {
    expect(
      determineEntitlementAt(
        exactSnapshot("on-hold", "on-hold", "billing-retry"),
        now,
      ),
    ).toMatchObject({ tier: "free", reason: "account-hold" });
  });

  it("keeps canceled access through the exact paid-through instant", () => {
    const snapshot = exactSnapshot("canceled", "paid", "canceled");
    expect(determineEntitlementAt(snapshot, now)).toMatchObject({
      tier: "premium",
      reason: "canceled-but-valid",
    });
    expect(
      determineEntitlementAt(snapshot, instant("2026-08-12T12:00:00.000Z")),
    ).toMatchObject({ tier: "free", reason: "expired" });
  });

  it("maps expired, revoked, and refunded provider states to free", () => {
    expect(
      determineEntitlementAt(
        exactSnapshot(
          "expired",
          "expired",
          "canceled",
          "2026-07-11T12:00:00.000Z",
        ),
        now,
      ),
    ).toMatchObject({ tier: "free", reason: "expired" });
    expect(
      determineEntitlementAt(exactSnapshot("revoked", "revoked", "canceled"), now),
    ).toMatchObject({ tier: "free", reason: "revoked" });
    expect(
      determineEntitlementAt(exactSnapshot("refunded", "refunded", "canceled"), now),
    ).toMatchObject({ tier: "free", reason: "refunded" });
  });

  it("rejects incomplete or contradictory exact snapshots", () => {
    expect(
      determineEntitlementAt(
        {
          status: "active",
          expiresAt: instant("2026-08-12T12:00:00.000Z"),
        },
        now,
      ),
    ).toMatchObject({ tier: "free", reason: "invalid-subscription-state" });
    expect(
      determineEntitlementAt(
        exactSnapshot("active", "on-hold", "billing-retry"),
        now,
      ),
    ).toMatchObject({ tier: "free", reason: "invalid-subscription-state" });
  });
});
