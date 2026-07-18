import { compareIsoTimestamps } from "./iso-timestamp.js";
import type { IsoTimestamp } from "./iso-timestamp.js";
import { compareLocalDates, parseLocalDate } from "./local-date.js";
import type { LocalDate } from "./local-date.js";
import type {
  Entitlement,
  EntitlementFeature,
  SubscriptionSnapshot,
} from "./models.js";

const FREE_FEATURES: readonly EntitlementFeature[] = Object.freeze([
  "cycle-tracking",
  "basic-prediction",
  "one-partner-sharing",
  "data-export",
]);

const PREMIUM_FEATURES: readonly EntitlementFeature[] = Object.freeze([
  ...FREE_FEATURES,
  "extended-history",
  "advanced-prediction",
  "full-care-tips",
]);

function free(reason: Entitlement["reason"]): Entitlement {
  return Object.freeze({ tier: "free", features: FREE_FEATURES, reason });
}

function premium(reason: Entitlement["reason"], validUntil: LocalDate): Entitlement {
  return Object.freeze({
    tier: "premium",
    features: PREMIUM_FEATURES,
    reason,
    validUntil,
  });
}

function isValidThrough(date: LocalDate | undefined, today: LocalDate): date is LocalDate {
  return date !== undefined && compareLocalDates(date, today) >= 0;
}

function expirationDate(subscription: SubscriptionSnapshot): LocalDate | undefined {
  if (subscription.expiresAt !== undefined) {
    return parseLocalDate(subscription.expiresAt.slice(0, 10));
  }
  return subscription.currentPeriodEnd;
}

function graceExpirationDate(subscription: SubscriptionSnapshot): LocalDate | undefined {
  if (subscription.gracePeriodExpiresAt !== undefined) {
    return parseLocalDate(subscription.gracePeriodExpiresAt.slice(0, 10));
  }
  return subscription.gracePeriodEnd ?? expirationDate(subscription);
}

function usesExactSnapshot(subscription: SubscriptionSnapshot): boolean {
  return (
    subscription.expiresAt !== undefined ||
    subscription.gracePeriodExpiresAt !== undefined ||
    subscription.verifiedAt !== undefined ||
    subscription.provider !== undefined ||
    subscription.productId !== undefined ||
    subscription.basePlanId !== undefined ||
    subscription.renewalState !== undefined ||
    subscription.paymentState !== undefined
  );
}

function hasCompleteExactMetadata(subscription: SubscriptionSnapshot): boolean {
  return (
    subscription.provider !== undefined &&
    subscription.productId !== undefined &&
    subscription.productId.trim().length > 0 &&
    subscription.basePlanId !== undefined &&
    subscription.basePlanId.trim().length > 0 &&
    subscription.renewalState !== undefined &&
    subscription.paymentState !== undefined &&
    subscription.verifiedAt !== undefined
  );
}

function isPaymentStateConsistent(subscription: SubscriptionSnapshot): boolean {
  if (!usesExactSnapshot(subscription)) {
    return true;
  }

  switch (subscription.status) {
    case "pending":
      return subscription.paymentState === "pending";
    case "trialing":
    case "active":
    case "canceled":
      return subscription.paymentState === "paid";
    case "grace-period":
      return subscription.paymentState === "grace-period";
    case "on-hold":
      return subscription.paymentState === "on-hold";
    case "expired":
      return subscription.paymentState === "expired";
    case "revoked":
      return subscription.paymentState === "revoked";
    case "refunded":
      return subscription.paymentState === "refunded";
    case "none":
    case "unknown":
      return true;
  }
}

function isUsableSnapshot(subscription: SubscriptionSnapshot): boolean {
  return (
    (!usesExactSnapshot(subscription) || hasCompleteExactMetadata(subscription)) &&
    isPaymentStateConsistent(subscription)
  );
}

export function determineEntitlement(
  subscription: SubscriptionSnapshot,
  today: LocalDate,
): Entitlement {
  if (!isUsableSnapshot(subscription)) {
    return free("invalid-subscription-state");
  }

  const paidThrough = expirationDate(subscription);
  const graceThrough = graceExpirationDate(subscription);

  switch (subscription.status) {
    case "trialing":
      return isValidThrough(paidThrough, today)
        ? premium("trial", paidThrough)
        : free("expired");
    case "active":
      return isValidThrough(paidThrough, today)
        ? premium("active-subscription", paidThrough)
        : free("invalid-subscription-state");
    case "canceled":
      return isValidThrough(paidThrough, today)
        ? premium("canceled-but-valid", paidThrough)
        : free("expired");
    case "grace-period":
      return isValidThrough(graceThrough, today)
        ? premium("grace-period", graceThrough)
        : free("expired");
    case "none":
      return free("no-subscription");
    case "pending":
      return free("pending-payment");
    case "on-hold":
      return free("account-hold");
    case "revoked":
      return free("revoked");
    case "refunded":
      return free("refunded");
    case "expired":
      return free("expired");
    case "unknown":
      return free("invalid-subscription-state");
  }
}

/**
 * Exact-instant entitlement evaluation for runtime access decisions.
 * The LocalDate overload above remains for migration and day-granular display code.
 */
export function determineEntitlementAt(
  subscription: SubscriptionSnapshot,
  now: IsoTimestamp,
): Entitlement {
  if (!isUsableSnapshot(subscription)) {
    return free("invalid-subscription-state");
  }
  if (!usesExactSnapshot(subscription)) {
    return subscription.status === "none"
      ? free("no-subscription")
      : free("invalid-subscription-state");
  }

  const exactExpiration =
    subscription.status === "grace-period"
      ? (subscription.gracePeriodExpiresAt ?? subscription.expiresAt)
      : subscription.expiresAt;

  const isExactlyValid =
    exactExpiration !== undefined && compareIsoTimestamps(exactExpiration, now) > 0;
  const validUntil =
    exactExpiration === undefined
      ? undefined
      : parseLocalDate(exactExpiration.slice(0, 10));

  switch (subscription.status) {
    case "trialing":
      return isExactlyValid && validUntil !== undefined
        ? premium("trial", validUntil)
        : free("expired");
    case "active":
      return isExactlyValid && validUntil !== undefined
        ? premium("active-subscription", validUntil)
        : free("expired");
    case "canceled":
      return isExactlyValid && validUntil !== undefined
        ? premium("canceled-but-valid", validUntil)
        : free("expired");
    case "grace-period":
      return isExactlyValid && validUntil !== undefined
        ? premium("grace-period", validUntil)
        : free("expired");
    case "none":
      return free("no-subscription");
    case "pending":
      return free("pending-payment");
    case "on-hold":
      return free("account-hold");
    case "expired":
      return free("expired");
    case "revoked":
      return free("revoked");
    case "refunded":
      return free("refunded");
    case "unknown":
      return free("invalid-subscription-state");
  }
}

export function hasEntitlement(
  entitlement: Entitlement,
  feature: EntitlementFeature,
): boolean {
  return entitlement.features.includes(feature);
}
