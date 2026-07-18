import {parseIsoTimestamp} from '@cyclepair/product-core';
import type {
  MemberId,
  StorePurchase,
  SubscriptionSnapshot,
} from '@cyclepair/product-core';

import {
  CyclePairPurchaseAdapter,
  SubscriptionSalesDisabledError,
} from './CyclePairPurchaseAdapter';
import type {
  PurchaseObserver,
  PurchaseVerificationClient,
  ServerPurchaseVerificationResponse,
} from './CyclePairPurchaseAdapter';
import type {
  OpenIapClient,
  OpenIapManageRequest,
  OpenIapPurchase,
  OpenIapPurchaseError,
  OpenIapSubscriptionProduct,
  OpenIapSubscriptionRequest,
  PurchaseListenerSubscription,
} from './OpenIapClient';
import {CYCLE_PAIR_SUBSCRIPTION_CATALOG} from './subscriptionCatalog';
import type {CyclePairSubscriptionCatalog} from './subscriptionCatalog';

const MEMBER_ID = 'member-1' as MemberId;
const purchasedAt = parseIsoTimestamp('2026-07-14T10:00:00.000Z');

const enabledCatalog: CyclePairSubscriptionCatalog = {
  ...CYCLE_PAIR_SUBSCRIPTION_CATALOG,
  salesEnabled: true,
};

const activeSnapshot: SubscriptionSnapshot = {
  status: 'active',
  provider: 'google-play',
  productId: 'cyclepair_plus',
  basePlanId: 'monthly',
  renewalState: 'will-renew',
  paymentState: 'paid',
  expiresAt: parseIsoTimestamp('2026-08-14T10:00:00.000Z'),
  verifiedAt: parseIsoTimestamp('2026-07-14T10:00:01.000Z'),
};

function purchase(
  state: OpenIapPurchase['state'] = 'purchased',
): OpenIapPurchase {
  return {
    provider: 'google-play',
    productId: 'cyclepair_plus',
    basePlanId: 'monthly',
    transactionId: 'transaction-1',
    purchaseToken: 'redacted-purchase-token',
    purchasedAt,
    state,
    nativePurchase: {id: 'native-transaction-1'},
  };
}

class FakeOpenIapClient implements OpenIapClient {
  readonly provider = 'google-play' as const;
  readonly events: string[] = [];
  readonly requested: OpenIapSubscriptionRequest[] = [];
  readonly managed: OpenIapManageRequest[] = [];
  products: OpenIapSubscriptionProduct[] = [];
  restored: OpenIapPurchase[] = [];
  finishFailuresRemaining = 0;
  finishCount = 0;
  listenerFailure = false;
  private purchaseListener: ((purchase: OpenIapPurchase) => void) | undefined;
  private errorListener: ((error: OpenIapPurchaseError) => void) | undefined;

  async connect(): Promise<void> {
    this.events.push('connect');
  }

  async disconnect(): Promise<void> {
    this.events.push('disconnect');
  }

  addPurchaseUpdatedListener(
    listener: (purchase: OpenIapPurchase) => void,
  ): PurchaseListenerSubscription {
    if (this.listenerFailure) throw new Error('listener setup failed');
    this.purchaseListener = listener;
    return {remove: () => (this.purchaseListener = undefined)};
  }

  addPurchaseErrorListener(
    listener: (error: OpenIapPurchaseError) => void,
  ): PurchaseListenerSubscription {
    this.errorListener = listener;
    return {remove: () => (this.errorListener = undefined)};
  }

  emitPurchase(value: OpenIapPurchase): void {
    this.purchaseListener?.(value);
  }

  emitError(value: OpenIapPurchaseError): void {
    this.errorListener?.(value);
  }

  async fetchSubscriptions(): Promise<readonly OpenIapSubscriptionProduct[]> {
    return this.products;
  }

  async requestSubscription(request: OpenIapSubscriptionRequest): Promise<void> {
    this.requested.push(request);
  }

  async restoreSubscriptions(): Promise<readonly OpenIapPurchase[]> {
    return this.restored;
  }

  async finishSubscription(): Promise<void> {
    this.events.push('finish');
    this.finishCount += 1;
    if (this.finishFailuresRemaining > 0) {
      this.finishFailuresRemaining -= 1;
      throw new Error('finish failed');
    }
  }

  async openManageSubscriptions(request: OpenIapManageRequest): Promise<void> {
    this.managed.push(request);
  }
}

class FakeVerificationClient implements PurchaseVerificationClient {
  readonly events: string[];
  verifyCount = 0;
  response: ServerPurchaseVerificationResponse = {
    verified: true,
    verificationId: 'verification-1',
    subscription: activeSnapshot,
  };

  constructor(events: string[]) {
    this.events = events;
  }

  async getPurchaseAccountIdentity() {
    return {
      appAccountToken: '1c51e14d-7ce7-4ec0-88bd-b69850fb8be4',
      googleObfuscatedExternalAccountId:
        '1c51e14d-7ce7-4ec0-88bd-b69850fb8be4',
    };
  }

  async getSubscription(): Promise<SubscriptionSnapshot> {
    return activeSnapshot;
  }

  watchSubscription(
    _memberId: MemberId,
    onValue: (subscription: SubscriptionSnapshot) => void,
  ): () => void {
    onValue(activeSnapshot);
    return () => undefined;
  }

  async verifyPurchase(
    _memberId: MemberId,
    _purchase: StorePurchase,
  ): Promise<ServerPurchaseVerificationResponse> {
    this.events.push('verify');
    this.verifyCount += 1;
    return this.response;
  }
}

function observer(events: string[]): PurchaseObserver {
  return {
    onVerified: () => events.push('unlock'),
    onPending: () => events.push('pending'),
    onRejected: () => events.push('rejected'),
    onError: () => events.push('error'),
    onStoreError: () => events.push('store-error'),
  };
}

describe('CyclePairPurchaseAdapter', () => {
  it('disconnects when native listener setup fails after connecting', async () => {
    const iap = new FakeOpenIapClient();
    iap.listenerFailure = true;
    const adapter = new CyclePairPurchaseAdapter(
      iap,
      new FakeVerificationClient(iap.events),
    );

    await expect(adapter.start(MEMBER_ID, observer(iap.events))).rejects.toThrow(
      'listener setup failed',
    );
    expect(iap.events).toEqual(['connect', 'disconnect']);
  });

  it('keeps new sales disabled by default without touching the native SDK', async () => {
    const iap = new FakeOpenIapClient();
    const verifier = new FakeVerificationClient(iap.events);
    const adapter = new CyclePairPurchaseAdapter(iap, verifier);

    await expect(adapter.getProducts()).resolves.toEqual([]);
    await expect(
      adapter.purchase({
        memberId: MEMBER_ID,
        productId: 'cyclepair_plus',
        basePlanId: 'monthly',
      }),
    ).rejects.toBeInstanceOf(SubscriptionSalesDisabledError);
    expect(iap.events).toEqual([]);
  });

  it('maps catalog plans to localized OpenIAP products', async () => {
    const iap = new FakeOpenIapClient();
    iap.products = [
      {
        provider: 'google-play',
        productId: 'cyclepair_plus',
        basePlanId: 'monthly',
        title: 'Cycle Pair Plus',
        description: 'Plus monthly',
        displayPrice: '₩3,900',
        currencyCode: 'KRW',
        offerToken: 'monthly-offer',
      },
      {
        provider: 'google-play',
        productId: 'cyclepair_plus',
        basePlanId: 'yearly',
        title: 'Cycle Pair Plus',
        description: 'Plus yearly',
        displayPrice: '₩39,000',
        currencyCode: 'KRW',
        offerToken: 'yearly-offer',
      },
    ];
    const adapter = new CyclePairPurchaseAdapter(
      iap,
      new FakeVerificationClient(iap.events),
      enabledCatalog,
    );
    await adapter.start(MEMBER_ID, observer(iap.events));

    await expect(adapter.getProducts()).resolves.toEqual([
      expect.objectContaining({
        basePlanId: 'monthly',
        billingPeriod: 'P1M',
        offerToken: 'monthly-offer',
      }),
      expect.objectContaining({
        basePlanId: 'yearly',
        billingPeriod: 'P1Y',
        offerToken: 'yearly-offer',
      }),
    ]);
  });

  it('verifies on the server before finishing and notifying unlock', async () => {
    const iap = new FakeOpenIapClient();
    iap.restored = [purchase()];
    const verifier = new FakeVerificationClient(iap.events);
    const adapter = new CyclePairPurchaseAdapter(iap, verifier, enabledCatalog);
    await adapter.start(MEMBER_ID, observer(iap.events));

    const results = await adapter.restore(MEMBER_ID);

    expect(results[0]?.verified).toBe(true);
    expect(iap.events).toEqual(['connect', 'verify', 'finish', 'unlock']);
  });

  it('never finishes or unlocks a rejected verification', async () => {
    const iap = new FakeOpenIapClient();
    iap.restored = [purchase()];
    const verifier = new FakeVerificationClient(iap.events);
    verifier.response = {verified: false, reason: 'invalid'};
    const adapter = new CyclePairPurchaseAdapter(iap, verifier, enabledCatalog);
    await adapter.start(MEMBER_ID, observer(iap.events));

    await expect(adapter.restore(MEMBER_ID)).resolves.toEqual([
      expect.objectContaining({verified: false, reason: 'invalid'}),
    ]);
    expect(iap.events).toEqual(['connect', 'verify', 'rejected']);
    expect(iap.finishCount).toBe(0);
  });

  it('deduplicates concurrent callbacks by transaction ID', async () => {
    const iap = new FakeOpenIapClient();
    iap.restored = [purchase(), purchase()];
    const verifier = new FakeVerificationClient(iap.events);
    const adapter = new CyclePairPurchaseAdapter(iap, verifier, enabledCatalog);
    await adapter.start(MEMBER_ID, observer(iap.events));

    const results = await adapter.restore(MEMBER_ID);

    expect(results).toHaveLength(2);
    expect(verifier.verifyCount).toBe(1);
    expect(iap.finishCount).toBe(1);
    expect(iap.events.filter(event => event === 'unlock')).toHaveLength(1);
  });

  it('does not verify or finish a pending purchase and only notifies once', async () => {
    const iap = new FakeOpenIapClient();
    iap.restored = [purchase('pending'), purchase('pending')];
    const verifier = new FakeVerificationClient(iap.events);
    const adapter = new CyclePairPurchaseAdapter(iap, verifier, enabledCatalog);
    await adapter.start(MEMBER_ID, observer(iap.events));

    const results = await adapter.restore(MEMBER_ID);

    expect(results.every(result => !result.verified && result.reason === 'pending')).toBe(
      true,
    );
    expect(verifier.verifyCount).toBe(0);
    expect(iap.finishCount).toBe(0);
    expect(iap.events).toEqual(['connect', 'pending']);
  });

  it('retries finish without repeating verification or unlock after a transient failure', async () => {
    const iap = new FakeOpenIapClient();
    iap.restored = [purchase()];
    iap.finishFailuresRemaining = 1;
    const verifier = new FakeVerificationClient(iap.events);
    const adapter = new CyclePairPurchaseAdapter(iap, verifier, enabledCatalog);
    await adapter.start(MEMBER_ID, observer(iap.events));

    await expect(adapter.restore(MEMBER_ID)).rejects.toThrow('finish failed');
    await expect(adapter.restore(MEMBER_ID)).resolves.toHaveLength(1);

    expect(verifier.verifyCount).toBe(1);
    expect(iap.finishCount).toBe(2);
    expect(iap.events.filter(event => event === 'unlock')).toHaveLength(1);
  });

  it('keeps restore and manage available while new sales are disabled', async () => {
    const iap = new FakeOpenIapClient();
    iap.restored = [purchase()];
    const adapter = new CyclePairPurchaseAdapter(
      iap,
      new FakeVerificationClient(iap.events),
    );
    await adapter.start(MEMBER_ID, observer(iap.events));

    await expect(adapter.restore(MEMBER_ID)).resolves.toHaveLength(1);
    await adapter.openManageSubscriptions('google-play', 'cyclepair_plus');

    expect(iap.managed).toEqual([
      {
        provider: 'google-play',
        androidPackageName: 'com.seorilabs.cyclepair',
        productId: 'cyclepair_plus',
      },
    ]);
  });

  it('dispatches the selected base-plan offer without treating the return as success', async () => {
    const iap = new FakeOpenIapClient();
    const adapter = new CyclePairPurchaseAdapter(
      iap,
      new FakeVerificationClient(iap.events),
      enabledCatalog,
    );
    await adapter.start(MEMBER_ID, observer(iap.events));

    await adapter.purchase({
      memberId: MEMBER_ID,
      productId: 'cyclepair_plus',
      basePlanId: 'monthly',
      offerToken: 'monthly-offer',
      appAccountToken: 'obfuscated-account-id',
    });

    expect(iap.requested).toEqual([
      {
        provider: 'google-play',
        productId: 'cyclepair_plus',
        offerToken: 'monthly-offer',
        appAccountToken: 'obfuscated-account-id',
      },
    ]);
    expect(iap.events).toEqual(['connect']);
  });
});
