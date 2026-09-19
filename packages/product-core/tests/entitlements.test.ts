import { describe, expect, it } from "vitest";

import {
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
    const entitlement = determineEntitlementAt({ status: "none" }, now);
    expect(entitlement.tier).toBe("free");
    expect(hasEntitlement(entitlement, "cycle-tracking")).toBe(true);
    expect(hasEntitlement(entitlement, "data-export")).toBe(true);
    expect(hasEntitlement(entitlement, "full-care-tips")).toBe(false);
  });

  it("grants the premium feature set through the paid period", () => {
    const entitlement = determineEntitlementAt(
      exactSnapshot("active", "paid", "will-renew"),
      now,
    );
    expect(entitlement).toMatchObject({
      tier: "premium",
      reason: "active-subscription",
    });
    expect(hasEntitlement(entitlement, "full-care-tips")).toBe(true);
    expect(hasEntitlement(entitlement, "extended-history")).toBe(true);
    expect(hasEntitlement(entitlement, "advanced-prediction")).toBe(true);
  });

  it("reserves multiple-connections without enabling it in the MVP", () => {
    const premium = determineEntitlementAt(
      exactSnapshot("active", "paid", "will-renew"),
      now,
    );
    expect(hasEntitlement(premium, "multiple-connections")).toBe(false);
  });

  it("keeps a trial premium until its exact expiry", () => {
    const snapshot = exactSnapshot("trialing", "paid", "will-renew");
    expect(determineEntitlementAt(snapshot, now)).toMatchObject({
      tier: "premium",
      reason: "trial",
      validUntil: "2026-08-12",
    });
    expect(
      determineEntitlementAt(snapshot, instant("2026-08-12T12:00:00.000Z")),
    ).toMatchObject({ tier: "free", reason: "expired" });
  });

  it("fails closed on an unknown status", () => {
    expect(determineEntitlementAt({ status: "unknown" }, now).tier).toBe("free");
    expect(determineEntitlementAt({ status: "unknown" }, now)).toMatchObject({
      reason: "invalid-subscription-state",
    });
  });

  it("fails closed on a snapshot without exact store metadata", () => {
    // 정밀 필드가 없는 스냅샷은 신뢰할 수 없다. 예전에는 날짜 단위 판정이
    // 같은 입력을 premium 으로 읽어 화면과 런타임 접근이 갈렸다.
    expect(determineEntitlementAt({ status: "active" }, now)).toMatchObject({
      tier: "free",
      reason: "invalid-subscription-state",
    });
    expect(determineEntitlementAt({ status: "canceled" }, now)).toMatchObject({
      tier: "free",
      reason: "invalid-subscription-state",
    });
    expect(
      determineEntitlementAt({ status: "grace-period" }, now),
    ).toMatchObject({ tier: "free", reason: "invalid-subscription-state" });
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
