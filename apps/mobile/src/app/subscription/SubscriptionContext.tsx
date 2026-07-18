import {
  determineEntitlementAt,
  parseIsoTimestamp,
  type Entitlement,
  type MemberId,
  type SubscriptionProduct,
  type SubscriptionSnapshot,
  type VerifiedPurchase,
} from '@cyclepair/product-core';
import React, {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  CyclePairPurchaseAdapter,
  PurchaseObserver,
} from '../../platform/purchases/CyclePairPurchaseAdapter';
import type {ProductAnalytics} from '../../platform/observability/ProductAnalytics';

export interface SubscriptionState {
  readonly hydrating: boolean;
  readonly busy: boolean;
  readonly salesEnabled: boolean;
  readonly products: readonly SubscriptionProduct[];
  readonly subscription: SubscriptionSnapshot;
  readonly entitlement: Entitlement;
  readonly error: string | null;
  readonly notice: string | null;
}

export interface SubscriptionContextValue {
  readonly state: SubscriptionState;
  clearFeedback(): void;
  refresh(): Promise<boolean>;
  loadProducts(): Promise<boolean>;
  purchase(product: SubscriptionProduct): Promise<boolean>;
  restore(): Promise<boolean>;
  manage(): Promise<boolean>;
}

export type SubscriptionRuntime = Pick<
  CyclePairPurchaseAdapter,
  | 'provider'
  | 'salesEnabled'
  | 'start'
  | 'stop'
  | 'getSubscription'
  | 'watchSubscription'
  | 'getProducts'
  | 'getPurchaseAccountIdentity'
  | 'purchase'
  | 'restore'
  | 'openManageSubscriptions'
>;

function entitlementFor(snapshot: SubscriptionSnapshot): Entitlement {
  return determineEntitlementAt(
    snapshot,
    parseIsoTimestamp(new Date().toISOString()),
  );
}

function entitlementDeadline(
  snapshot: SubscriptionSnapshot,
): string | undefined {
  if (snapshot.status === 'grace-period') {
    return snapshot.gracePeriodExpiresAt ?? snapshot.expiresAt;
  }
  if (
    snapshot.status === 'trialing' ||
    snapshot.status === 'active' ||
    snapshot.status === 'canceled'
  ) {
    return snapshot.expiresAt;
  }
  return undefined;
}

const MAX_ENTITLEMENT_TIMER_MS = 2_147_000_000;

function subscriptionErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as {code?: unknown}).code).toLowerCase()
      : '';
  if (code.includes('cancel')) return '구매가 취소되었습니다.';
  if (code.includes('network'))
    return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
  if (code.includes('not-found'))
    return '스토어에서 구독 상품을 찾지 못했습니다.';
  if (code.includes('permission') || code.includes('unauthenticated'))
    return '로그인 상태를 확인한 뒤 다시 시도해 주세요.';
  return '구독 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

const emptySubscription: SubscriptionSnapshot = {status: 'none'};
const noopAnalytics: ProductAnalytics = {
  async setEnabled() {},
  async track() {},
};
const SubscriptionContext = createContext<SubscriptionContextValue | null>(
  null,
);

export function SubscriptionProvider({
  memberId,
  purchaseClient,
  analytics = noopAnalytics,
  children,
}: PropsWithChildren<{
  memberId: MemberId;
  purchaseClient?: SubscriptionRuntime;
  analytics?: ProductAnalytics;
}>) {
  const [state, setState] = useState<SubscriptionState>({
    hydrating: Boolean(purchaseClient),
    busy: false,
    salesEnabled: purchaseClient?.salesEnabled ?? false,
    products: [],
    subscription: emptySubscription,
    entitlement: entitlementFor(emptySubscription),
    error: null,
    notice: null,
  });
  const active = useRef(true);
  const started = useRef(false);
  const startPromise = useRef<Promise<void> | null>(null);

  const applySubscription = useCallback((subscription: SubscriptionSnapshot) => {
    if (!active.current) return;
    setState(current => ({
      ...current,
      hydrating: false,
      busy: false,
      subscription,
      entitlement: entitlementFor(subscription),
      error: null,
    }));
  }, []);

  const applyWatchedSubscription = useCallback(
    (subscription: SubscriptionSnapshot) => {
      if (!active.current) return;
      setState(current => ({
        ...current,
        hydrating: false,
        subscription,
        entitlement: entitlementFor(subscription),
        error: null,
      }));
    },
    [],
  );

  const applyError = useCallback((error: unknown) => {
    if (!active.current) return;
    setState(current => ({
      ...current,
      hydrating: false,
      busy: false,
      error: subscriptionErrorMessage(error),
      notice: null,
    }));
  }, []);

  const observer = useMemo<PurchaseObserver>(
    () => ({
      onVerified(purchase: VerifiedPurchase) {
        if (!active.current) return;
        applySubscription(purchase.subscription);
        setState(current => ({
          ...current,
          notice: '구독 구매를 서버에서 확인했습니다.',
        }));
        analytics
          .track({name: 'cp_subscription_completed'})
          .catch(() => undefined);
      },
      onPending() {
        if (!active.current) return;
        setState(current => ({
          ...current,
          busy: false,
          notice: '결제가 보류 중입니다. 스토어 확인 후 자동 반영됩니다.',
          error: null,
        }));
      },
      onRejected() {
        if (!active.current) return;
        setState(current => ({
          ...current,
          busy: false,
          error: '구매 내역을 서버에서 확인하지 못했습니다.',
          notice: null,
        }));
      },
      onError: applyError,
      onStoreError: applyError,
    }),
    [analytics, applyError, applySubscription],
  );

  const ensureStarted = useCallback(async () => {
    if (!purchaseClient) {
      throw new Error('Subscription runtime is unavailable.');
    }
    if (started.current) return;
    if (!startPromise.current) {
      startPromise.current = purchaseClient
        .start(memberId, observer)
        .then(() => {
          if (active.current) started.current = true;
        })
        .finally(() => {
          startPromise.current = null;
        });
    }
    await startPromise.current;
  }, [memberId, observer, purchaseClient]);

  const refresh = useCallback(async () => {
    if (!purchaseClient) return true;
    setState(current => ({
      ...current,
      busy: true,
      error: null,
      notice: null,
    }));
    try {
      applySubscription(await purchaseClient.getSubscription(memberId));
      return true;
    } catch (error) {
      applyError(error);
      return false;
    }
  }, [applyError, applySubscription, memberId, purchaseClient]);

  useEffect(() => {
    active.current = true;
    let stopSubscription: () => void = () => undefined;
    if (purchaseClient) {
      try {
        stopSubscription = purchaseClient.watchSubscription(
          memberId,
          applyWatchedSubscription,
          applyError,
        );
      } catch (error) {
        applyError(error);
      }
    }
    return () => {
      active.current = false;
      stopSubscription();
      const shouldStop = started.current;
      const pendingStart = startPromise.current;
      started.current = false;
      if (pendingStart) {
        pendingStart
          .then(() => purchaseClient?.stop())
          .catch(() => undefined);
      } else if (shouldStop) {
        purchaseClient?.stop().catch(() => undefined);
      }
    };
  }, [applyError, applyWatchedSubscription, memberId, purchaseClient]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = state.subscription;

    const refreshEntitlement = () => {
      if (cancelled) return;
      setState(current =>
        current.subscription === subscription
          ? {...current, entitlement: entitlementFor(subscription)}
          : current,
      );
      const deadline = entitlementDeadline(subscription);
      const remaining = deadline ? Date.parse(deadline) - Date.now() : NaN;
      if (!Number.isFinite(remaining) || remaining <= 0) return;
      timer = setTimeout(
        refreshEntitlement,
        Math.min(remaining + 50, MAX_ENTITLEMENT_TIMER_MS),
      );
    };

    refreshEntitlement();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [state.subscription]);

  const clearFeedback = useCallback(() => {
    setState(current => ({...current, error: null, notice: null}));
  }, []);

  const loadProducts = useCallback(async () => {
    if (!purchaseClient?.salesEnabled) return true;
    setState(current => ({
      ...current,
      busy: true,
      error: null,
      notice: null,
    }));
    try {
      await ensureStarted();
      const products = await purchaseClient.getProducts();
      if (!active.current) return false;
      setState(current => ({
        ...current,
        busy: false,
        products,
        error: products.length === 0 ? '스토어에서 구독 상품을 찾지 못했습니다.' : null,
      }));
      return products.length > 0;
    } catch (error) {
      applyError(error);
      return false;
    }
  }, [applyError, ensureStarted, purchaseClient]);

  const purchase = useCallback(
    async (product: SubscriptionProduct) => {
      if (!purchaseClient?.salesEnabled) return false;
      setState(current => ({
        ...current,
        busy: true,
        error: null,
        notice: null,
      }));
      try {
        await ensureStarted();
        const identity = await purchaseClient.getPurchaseAccountIdentity(
          memberId,
        );
        await purchaseClient.purchase({
          memberId,
          productId: product.productId,
          basePlanId: product.basePlanId,
          ...(product.offerToken ? {offerToken: product.offerToken} : {}),
          appAccountToken:
            product.provider === 'app-store'
              ? identity.appAccountToken
              : identity.googleObfuscatedExternalAccountId,
        });
        if (!active.current) return false;
        setState(current => ({
          ...current,
          busy: false,
          notice: '스토어 결제 결과를 확인하고 있습니다.',
        }));
        return true;
      } catch (error) {
        applyError(error);
        return false;
      }
    },
    [applyError, ensureStarted, memberId, purchaseClient],
  );

  const restore = useCallback(async () => {
    if (!purchaseClient) return false;
    setState(current => ({
      ...current,
      busy: true,
      error: null,
      notice: null,
    }));
    try {
      await ensureStarted();
      const results = await purchaseClient.restore(memberId);
      const subscription = await purchaseClient.getSubscription(memberId);
      applySubscription(subscription);
      if (!active.current) return false;
      const verified = results.filter(result => result.verified).length;
      setState(current => ({
        ...current,
        notice:
          verified > 0
            ? '구매 내역을 서버에서 확인해 복원했습니다.'
            : '복원할 구매 내역이 없습니다.',
      }));
      return true;
    } catch (error) {
      applyError(error);
      return false;
    }
  }, [applyError, applySubscription, ensureStarted, memberId, purchaseClient]);

  const manage = useCallback(async () => {
    if (!purchaseClient) return false;
    setState(current => ({
      ...current,
      busy: true,
      error: null,
      notice: null,
    }));
    try {
      await ensureStarted();
      await purchaseClient.openManageSubscriptions(
        state.subscription.provider ?? purchaseClient.provider,
        state.subscription.productId,
      );
      if (!active.current) return false;
      setState(current => ({...current, busy: false}));
      return true;
    } catch (error) {
      applyError(error);
      return false;
    }
  }, [applyError, ensureStarted, purchaseClient, state.subscription]);

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      state,
      clearFeedback,
      refresh,
      loadProducts,
      purchase,
      restore,
      manage,
    }),
    [
      clearFeedback,
      loadProducts,
      manage,
      purchase,
      refresh,
      restore,
      state,
    ],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextValue {
  const value = useContext(SubscriptionContext);
  if (!value) {
    throw new Error('useSubscription must be used inside SubscriptionProvider.');
  }
  return value;
}
