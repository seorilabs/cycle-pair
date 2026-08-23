import {
  hasEntitlement,
  parseLocalDate,
  type Entitlement,
} from '@cyclepair/product-core';

import {
  FREE_CARE_TIP_LIMIT,
  FREE_HISTORY_LOOKBACK_DAYS,
  PREMIUM_CARE_TIP_LIMIT,
  PREMIUM_HISTORY_LOOKBACK_DAYS,
  resolveCycleFeaturePolicy,
} from './cycleFeaturePolicy';

const freeEntitlement: Entitlement = {
  tier: 'free',
  features: [
    'cycle-tracking',
    'basic-prediction',
    'one-partner-sharing',
    'data-export',
  ],
  reason: 'no-subscription',
};

const premiumEntitlement: Entitlement = {
  tier: 'premium',
  features: [
    ...freeEntitlement.features,
    'extended-history',
    'advanced-prediction',
    'full-care-tips',
  ],
  reason: 'active-subscription',
  validUntil: parseLocalDate('2027-08-23'),
};

function policyFor(entitlement: Entitlement) {
  return resolveCycleFeaturePolicy(feature =>
    hasEntitlement(entitlement, feature),
  );
}

describe('cycle premium feature policy', () => {
  it('keeps all three premium features locked for free users', () => {
    expect(policyFor(freeEntitlement)).toEqual({
      extendedHistoryEnabled: false,
      advancedPredictionEnabled: false,
      fullCareTipsEnabled: false,
      historyLookbackDays: FREE_HISTORY_LOOKBACK_DAYS,
      careTipLimit: FREE_CARE_TIP_LIMIT,
    });
  });

  it('unlocks all three premium features with named limits', () => {
    expect(policyFor(premiumEntitlement)).toEqual({
      extendedHistoryEnabled: true,
      advancedPredictionEnabled: true,
      fullCareTipsEnabled: true,
      historyLookbackDays: PREMIUM_HISTORY_LOOKBACK_DAYS,
      careTipLimit: PREMIUM_CARE_TIP_LIMIT,
    });
  });
});
