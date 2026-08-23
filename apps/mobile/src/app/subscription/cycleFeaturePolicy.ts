import type {EntitlementFeature} from '@cyclepair/product-core';

export const FREE_HISTORY_LOOKBACK_DAYS = 365;
export const PREMIUM_HISTORY_LOOKBACK_DAYS = 3650;
export const FREE_CARE_TIP_LIMIT = 1;
export const PREMIUM_CARE_TIP_LIMIT = 3;

export interface CycleFeaturePolicy {
  readonly extendedHistoryEnabled: boolean;
  readonly advancedPredictionEnabled: boolean;
  readonly fullCareTipsEnabled: boolean;
  readonly historyLookbackDays: number;
  readonly careTipLimit: number;
}

export function resolveCycleFeaturePolicy(
  hasFeature: (feature: EntitlementFeature) => boolean,
): CycleFeaturePolicy {
  const extendedHistoryEnabled = hasFeature('extended-history');
  const advancedPredictionEnabled = hasFeature('advanced-prediction');
  const fullCareTipsEnabled = hasFeature('full-care-tips');

  return Object.freeze({
    extendedHistoryEnabled,
    advancedPredictionEnabled,
    fullCareTipsEnabled,
    historyLookbackDays: extendedHistoryEnabled
      ? PREMIUM_HISTORY_LOOKBACK_DAYS
      : FREE_HISTORY_LOOKBACK_DAYS,
    careTipLimit: fullCareTipsEnabled
      ? PREMIUM_CARE_TIP_LIMIT
      : FREE_CARE_TIP_LIMIT,
  });
}
