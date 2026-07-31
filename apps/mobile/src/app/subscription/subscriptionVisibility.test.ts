import {parseIsoTimestamp} from '@cyclepair/product-core';

import {shouldShowSubscriptionEntry} from './subscriptionVisibility';

describe('subscription visibility', () => {
  it('hides an unavailable subscription entry for users without a purchase', () => {
    expect(
      shouldShowSubscriptionEntry({
        salesEnabled: false,
        subscription: {status: 'none'},
      }),
    ).toBe(false);
  });

  it('shows the entry when sales are available or an existing purchase needs management', () => {
    expect(
      shouldShowSubscriptionEntry({
        salesEnabled: true,
        subscription: {status: 'none'},
      }),
    ).toBe(true);
    expect(
      shouldShowSubscriptionEntry({
        salesEnabled: false,
        subscription: {
          status: 'active',
          provider: 'app-store',
          productId: 'com.seorilabs.cyclepair.plus.monthly',
          basePlanId: 'monthly',
          expiresAt: parseIsoTimestamp('2026-08-31T00:00:00.000Z'),
          renewalState: 'will-renew',
        },
      }),
    ).toBe(true);
  });
});
