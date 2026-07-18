import type {
  SubscriptionPlanInterval,
  SubscriptionProvider,
} from '@cyclepair/product-core';

export interface CatalogSubscriptionPlan {
  readonly provider: SubscriptionProvider;
  readonly productId: string;
  readonly basePlanId: string;
  readonly billingPeriod: SubscriptionPlanInterval;
}

export interface CyclePairSubscriptionCatalog {
  readonly salesEnabled: boolean;
  readonly entitlementId: 'cyclepair_plus';
  readonly androidPackageName: 'com.seorilabs.cyclepair';
  readonly plans: readonly CatalogSubscriptionPlan[];
}

/**
 * Single source of truth for store identifiers. Console products are not created
 * yet, so new sales remain disabled while restore/manage paths stay available.
 */
export const CYCLE_PAIR_SUBSCRIPTION_CATALOG: CyclePairSubscriptionCatalog =
  Object.freeze({
    salesEnabled: false,
    entitlementId: 'cyclepair_plus',
    androidPackageName: 'com.seorilabs.cyclepair',
    plans: Object.freeze([
      Object.freeze({
        provider: 'google-play',
        productId: 'cyclepair_plus',
        basePlanId: 'monthly',
        billingPeriod: 'P1M',
      }),
      Object.freeze({
        provider: 'google-play',
        productId: 'cyclepair_plus',
        basePlanId: 'yearly',
        billingPeriod: 'P1Y',
      }),
      Object.freeze({
        provider: 'app-store',
        productId: 'com.seorilabs.cyclepair.plus.monthly',
        basePlanId: 'monthly',
        billingPeriod: 'P1M',
      }),
      Object.freeze({
        provider: 'app-store',
        productId: 'com.seorilabs.cyclepair.plus.yearly',
        basePlanId: 'yearly',
        billingPeriod: 'P1Y',
      }),
    ]),
  });

export function catalogPlansForProvider(
  catalog: CyclePairSubscriptionCatalog,
  provider: SubscriptionProvider,
): readonly CatalogSubscriptionPlan[] {
  return catalog.plans.filter(plan => plan.provider === provider);
}

