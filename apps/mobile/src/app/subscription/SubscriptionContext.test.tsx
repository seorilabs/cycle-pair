import {
  parseIsoTimestamp,
  type MemberId,
  type SubscriptionSnapshot,
} from '@cyclepair/product-core';
import {act, render} from '@testing-library/react-native';
import React from 'react';
import {Text} from 'react-native';

import {
  SubscriptionProvider,
  type SubscriptionRuntime,
  useSubscription,
} from './SubscriptionContext';

const memberId = 'member-1' as MemberId;

function activeSubscription(expiresAt: string): SubscriptionSnapshot {
  return {
    status: 'active',
    provider: 'google-play',
    productId: 'cyclepair_plus',
    basePlanId: 'monthly',
    renewalState: 'will-renew',
    paymentState: 'paid',
    expiresAt: parseIsoTimestamp(expiresAt),
    verifiedAt: parseIsoTimestamp('2026-07-14T00:00:00.000Z'),
  };
}

function runtime() {
  let subscriptionListener:
    | ((subscription: SubscriptionSnapshot) => void)
    | undefined;
  const unsubscribe = jest.fn();
  const client: SubscriptionRuntime = {
    provider: 'google-play',
    salesEnabled: false,
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    getSubscription: jest.fn(
      async (): Promise<SubscriptionSnapshot> => ({status: 'none'}),
    ),
    watchSubscription: jest.fn((_uid, onValue) => {
      subscriptionListener = onValue;
      return unsubscribe;
    }),
    getProducts: jest.fn(async () => []),
    getPurchaseAccountIdentity: jest.fn(async () => ({
      appAccountToken: '1c51e14d-7ce7-4ec0-88bd-b69850fb8be4',
      googleObfuscatedExternalAccountId:
        '1c51e14d-7ce7-4ec0-88bd-b69850fb8be4',
    })),
    purchase: jest.fn(async () => undefined),
    restore: jest.fn(async () => []),
    openManageSubscriptions: jest.fn(async () => undefined),
  };
  return {
    client,
    unsubscribe,
    emit(subscription: SubscriptionSnapshot) {
      if (!subscriptionListener) throw new Error('listener unavailable');
      subscriptionListener(subscription);
    },
  };
}

function Harness() {
  const {state} = useSubscription();
  return (
    <Text>{`${state.subscription.status}:${state.entitlement.tier}:${state.entitlement.reason}`}</Text>
  );
}

describe('SubscriptionProvider server state lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-14T10:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('applies RTDN/App Store server snapshots while the app remains open', async () => {
    const store = runtime();
    const view = await render(
      <SubscriptionProvider memberId={memberId} purchaseClient={store.client}>
        <Harness />
      </SubscriptionProvider>,
    );

    await act(async () => {
      store.emit(activeSubscription('2026-08-14T10:00:00.000Z'));
    });
    expect(view.getByText('active:premium:active-subscription')).toBeTruthy();

    await act(async () => {
      store.emit({
        ...activeSubscription('2026-08-14T10:00:00.000Z'),
        status: 'refunded',
        renewalState: 'canceled',
        paymentState: 'refunded',
      });
    });
    expect(view.getByText('refunded:free:refunded')).toBeTruthy();

    await act(async () => view.unmount());
    expect(store.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('locks premium exactly when a locally observed server expiry passes', async () => {
    const store = runtime();
    const view = await render(
      <SubscriptionProvider memberId={memberId} purchaseClient={store.client}>
        <Harness />
      </SubscriptionProvider>,
    );

    await act(async () => {
      store.emit(activeSubscription('2026-07-14T10:00:01.000Z'));
    });
    expect(view.getByText('active:premium:active-subscription')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(1_100);
    });
    expect(view.getByText('active:free:expired')).toBeTruthy();
  });
});
