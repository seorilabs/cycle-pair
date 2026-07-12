import { compareLocalDates } from "./local-date.js";
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
]);

const PREMIUM_FEATURES: readonly EntitlementFeature[] = Object.freeze([
  ...FREE_FEATURES,
  "extended-history",
  "advanced-prediction",
  "full-care-tips",
  "data-export",
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

export function determineEntitlement(
  subscription: SubscriptionSnapshot,
  today: LocalDate,
): Entitlement {
  switch (subscription.status) {
    case "trialing":
      return isValidThrough(subscription.currentPeriodEnd, today)
        ? premium("trial", subscription.currentPeriodEnd)
        : free("expired");
    case "active":
      return isValidThrough(subscription.currentPeriodEnd, today)
        ? premium("active-subscription", subscription.currentPeriodEnd)
        : free("invalid-subscription-state");
    case "canceled":
      return isValidThrough(subscription.currentPeriodEnd, today)
        ? premium("canceled-but-valid", subscription.currentPeriodEnd)
        : free("expired");
    case "grace-period":
      return isValidThrough(subscription.gracePeriodEnd, today)
        ? premium("grace-period", subscription.gracePeriodEnd)
        : free("expired");
    case "none":
      return free("no-subscription");
    case "expired":
    case "revoked":
      return free("expired");
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
