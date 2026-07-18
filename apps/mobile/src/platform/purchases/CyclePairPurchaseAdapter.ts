import type {
  MemberId,
  PurchasePort,
  PurchaseVerificationFailureReason,
  PurchaseVerificationResult,
  StorePurchase,
  SubscriptionProduct,
  SubscriptionProvider,
  SubscriptionPurchaseRequest,
  SubscriptionSnapshot,
  VerifiedPurchase,
} from '@cyclepair/product-core';

import type {
  OpenIapClient,
  OpenIapPurchase,
  OpenIapPurchaseError,
  PurchaseListenerSubscription,
} from './OpenIapClient';
import {
  CYCLE_PAIR_SUBSCRIPTION_CATALOG,
  catalogPlansForProvider,
} from './subscriptionCatalog';
import type {
  CatalogSubscriptionPlan,
  CyclePairSubscriptionCatalog,
} from './subscriptionCatalog';

export type ServerPurchaseVerificationResponse =
  | {
      readonly verified: true;
      readonly verificationId: string;
      readonly subscription: SubscriptionSnapshot;
    }
  | {
      readonly verified: false;
      readonly reason: Exclude<PurchaseVerificationFailureReason, 'pending'>;
    };

export interface PurchaseAccountIdentity {
  readonly appAccountToken: string;
  readonly googleObfuscatedExternalAccountId: string;
}

/** This is expected to call an authenticated backend; it must not verify locally. */
export interface PurchaseVerificationClient {
  getPurchaseAccountIdentity(
    memberId: MemberId,
  ): Promise<PurchaseAccountIdentity>;
  getSubscription(memberId: MemberId): Promise<SubscriptionSnapshot>;
  watchSubscription(
    memberId: MemberId,
    onValue: (subscription: SubscriptionSnapshot) => void,
    onError: (error: unknown) => void,
  ): () => void;
  verifyPurchase(
    memberId: MemberId,
    purchase: StorePurchase,
  ): Promise<ServerPurchaseVerificationResponse>;
}

export interface PurchaseObserver {
  onVerified(purchase: VerifiedPurchase): void;
  onPending?(purchase: StorePurchase): void;
  onRejected?(result: Extract<PurchaseVerificationResult, {verified: false}>): void;
  onError?(error: unknown): void;
  onStoreError?(error: OpenIapPurchaseError): void;
}

interface ProcessingState {
  readonly purchase: StorePurchase;
  verification: PurchaseVerificationResult | undefined;
  finished: boolean;
  notified: boolean;
}

export class SubscriptionSalesDisabledError extends Error {
  constructor() {
    super('Cycle Pair subscription sales are not enabled.');
    this.name = 'SubscriptionSalesDisabledError';
  }
}

export class UnknownSubscriptionProductError extends Error {
  constructor(productId: string, basePlanId: string) {
    super(`Unknown subscription product: ${productId}/${basePlanId}`);
    this.name = 'UnknownSubscriptionProductError';
  }
}

export class PurchaseAdapterNotStartedError extends Error {
  constructor() {
    super('Purchase adapter must be started before using the store.');
    this.name = 'PurchaseAdapterNotStartedError';
  }
}

export class UnverifiedPurchaseFinishError extends Error {
  constructor(transactionId: string) {
    super(`Purchase has not passed server verification: ${transactionId}`);
    this.name = 'UnverifiedPurchaseFinishError';
  }
}

function transactionKey(purchase: StorePurchase): string {
  return `${purchase.provider}:${purchase.transactionId}`;
}

function processingKey(memberId: MemberId, purchase: StorePurchase): string {
  return `${memberId}:${transactionKey(purchase)}`;
}

function sameSubscriptionIdentity(
  snapshot: SubscriptionSnapshot,
  purchase: StorePurchase,
  plan: CatalogSubscriptionPlan,
): boolean {
  return (
    snapshot.provider === purchase.provider &&
    snapshot.productId === purchase.productId &&
    snapshot.basePlanId === plan.basePlanId
  );
}

export class CyclePairPurchaseAdapter implements PurchasePort {
  private readonly processing = new Map<string, ProcessingState>();
  private readonly inFlight = new Map<string, Promise<PurchaseVerificationResult>>();
  private readonly nativePurchases = new Map<string, OpenIapPurchase>();
  private readonly verifiedTransactions = new Set<string>();
  private readonly finishedTransactions = new Set<string>();
  private readonly pendingNotifications = new Set<string>();
  private subscriptions: PurchaseListenerSubscription[] = [];
  private activeMemberId: MemberId | undefined;
  private observer: PurchaseObserver | undefined;
  private connected = false;

  constructor(
    private readonly iap: OpenIapClient,
    private readonly verificationClient: PurchaseVerificationClient,
    private readonly catalog: CyclePairSubscriptionCatalog =
      CYCLE_PAIR_SUBSCRIPTION_CATALOG,
  ) {}

  get provider(): SubscriptionProvider {
    return this.iap.provider;
  }

  get salesEnabled(): boolean {
    return this.catalog.salesEnabled;
  }

  async start(memberId: MemberId, observer: PurchaseObserver): Promise<void> {
    if (this.connected) {
      await this.stop();
    }

    await this.iap.connect();
    this.connected = true;
    this.activeMemberId = memberId;
    this.observer = observer;
    try {
      this.subscriptions = [
        this.iap.addPurchaseUpdatedListener(purchase => {
          this.processPurchase(memberId, purchase, observer).catch(error => {
            observer.onError?.(error);
          });
        }),
        this.iap.addPurchaseErrorListener(error => {
          observer.onStoreError?.(error);
        }),
      ];
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.subscriptions.forEach(subscription => subscription.remove());
    this.subscriptions = [];
    this.activeMemberId = undefined;
    this.observer = undefined;
    if (this.connected) {
      await this.iap.disconnect();
      this.connected = false;
    }
  }

  async getProducts(): Promise<readonly SubscriptionProduct[]> {
    if (!this.catalog.salesEnabled) {
      return [];
    }
    this.assertStarted();

    const plans = catalogPlansForProvider(this.catalog, this.iap.provider);
    const productIds = [...new Set(plans.map(plan => plan.productId))];
    const storeProducts = await this.iap.fetchSubscriptions(productIds);

    return plans.flatMap(plan => {
      const storeProduct = storeProducts.find(product =>
        product.provider === plan.provider &&
        product.productId === plan.productId &&
        (plan.provider === 'app-store' || product.basePlanId === plan.basePlanId),
      );
      if (!storeProduct) {
        return [];
      }

      const product: SubscriptionProduct = {
        provider: plan.provider,
        productId: plan.productId,
        basePlanId: plan.basePlanId,
        title: storeProduct.title,
        description: storeProduct.description,
        displayPrice: storeProduct.displayPrice,
        currencyCode: storeProduct.currencyCode,
        billingPeriod: plan.billingPeriod,
        ...(storeProduct.offerToken
          ? {offerToken: storeProduct.offerToken}
          : {}),
      };
      return [product];
    });
  }

  getSubscription(memberId: MemberId): Promise<SubscriptionSnapshot> {
    return this.verificationClient.getSubscription(memberId);
  }

  watchSubscription(
    memberId: MemberId,
    onValue: (subscription: SubscriptionSnapshot) => void,
    onError: (error: unknown) => void,
  ): () => void {
    return this.verificationClient.watchSubscription(
      memberId,
      onValue,
      onError,
    );
  }

  getPurchaseAccountIdentity(
    memberId: MemberId,
  ): Promise<PurchaseAccountIdentity> {
    return this.verificationClient.getPurchaseAccountIdentity(memberId);
  }

  async purchase(request: SubscriptionPurchaseRequest): Promise<void> {
    if (!this.catalog.salesEnabled) {
      throw new SubscriptionSalesDisabledError();
    }
    this.assertStarted();
    if (request.memberId !== this.activeMemberId) {
      throw new Error('Purchase member does not match the active store session.');
    }

    const plan = this.findPlan(
      this.iap.provider,
      request.productId,
      request.basePlanId,
    );
    if (!plan) {
      throw new UnknownSubscriptionProductError(
        request.productId,
        request.basePlanId,
      );
    }
    if (plan.provider === 'google-play' && !request.offerToken) {
      throw new Error('Google Play subscription offer token is required.');
    }

    await this.iap.requestSubscription({
      provider: plan.provider,
      productId: plan.productId,
      ...(request.offerToken ? {offerToken: request.offerToken} : {}),
      ...(request.appAccountToken
        ? {appAccountToken: request.appAccountToken}
        : {}),
    });
  }

  async restore(memberId: MemberId): Promise<readonly PurchaseVerificationResult[]> {
    this.assertStarted();
    const purchases = await this.iap.restoreSubscriptions();
    const observer = this.activeMemberId === memberId ? this.observer : undefined;
    return Promise.all(
      purchases.map(purchase => this.processPurchase(memberId, purchase, observer)),
    );
  }

  async serverVerify(
    memberId: MemberId,
    purchase: StorePurchase,
  ): Promise<PurchaseVerificationResult> {
    if (purchase.state !== 'purchased') {
      return {
        verified: false,
        purchase,
        reason: purchase.state === 'pending' ? 'pending' : 'unknown',
      };
    }

    const plan = this.findPlan(
      purchase.provider,
      purchase.productId,
      purchase.basePlanId,
    );
    if (!plan) {
      return {verified: false, purchase, reason: 'product-mismatch'};
    }

    const response = await this.verificationClient.verifyPurchase(memberId, purchase);
    if (!response.verified) {
      return {verified: false, purchase, reason: response.reason};
    }
    if (
      response.verificationId.trim().length === 0 ||
      !sameSubscriptionIdentity(response.subscription, purchase, plan)
    ) {
      return {verified: false, purchase, reason: 'product-mismatch'};
    }

    const verifiedPurchase: VerifiedPurchase = {
      verificationId: response.verificationId,
      purchase,
      subscription: response.subscription,
    };
    this.verifiedTransactions.add(transactionKey(purchase));
    return {verified: true, verifiedPurchase};
  }

  async finish(purchase: VerifiedPurchase): Promise<void> {
    const key = transactionKey(purchase.purchase);
    if (!this.verifiedTransactions.has(key)) {
      throw new UnverifiedPurchaseFinishError(purchase.purchase.transactionId);
    }
    if (this.finishedTransactions.has(key)) {
      return;
    }

    const nativePurchase = this.nativePurchases.get(key);
    if (!nativePurchase) {
      throw new Error(`Native purchase is unavailable: ${purchase.purchase.transactionId}`);
    }
    await this.iap.finishSubscription(nativePurchase);
    this.finishedTransactions.add(key);
  }

  async openManageSubscriptions(
    provider: SubscriptionProvider,
    productId?: string,
  ): Promise<void> {
    if (provider !== this.iap.provider) {
      throw new Error(`Subscription provider is not available on this device: ${provider}`);
    }
    await this.iap.openManageSubscriptions({
      provider,
      androidPackageName: this.catalog.androidPackageName,
      ...(productId ? {productId} : {}),
    });
  }

  private assertStarted(): void {
    if (!this.connected) {
      throw new PurchaseAdapterNotStartedError();
    }
  }

  private findPlan(
    provider: SubscriptionProvider,
    productId: string,
    basePlanId: string | undefined,
  ): CatalogSubscriptionPlan | undefined {
    return this.catalog.plans.find(
      plan =>
        plan.provider === provider &&
        plan.productId === productId &&
        (provider === 'app-store' || plan.basePlanId === basePlanId),
    );
  }

  private toStorePurchase(purchase: OpenIapPurchase): StorePurchase {
    const plan = this.findPlan(
      purchase.provider,
      purchase.productId,
      purchase.basePlanId,
    );
    const basePlanId = purchase.basePlanId ?? plan?.basePlanId;
    const storePurchase: StorePurchase = {
      provider: purchase.provider,
      productId: purchase.productId,
      ...(basePlanId ? {basePlanId} : {}),
      transactionId: purchase.transactionId,
      ...(purchase.purchaseToken
        ? {purchaseToken: purchase.purchaseToken}
        : {}),
      purchasedAt: purchase.purchasedAt,
      state: purchase.state,
    };
    this.nativePurchases.set(transactionKey(storePurchase), purchase);
    return storePurchase;
  }

  private processPurchase(
    memberId: MemberId,
    nativePurchase: OpenIapPurchase,
    observer: PurchaseObserver | undefined,
  ): Promise<PurchaseVerificationResult> {
    const purchase = this.toStorePurchase(nativePurchase);
    const key = processingKey(memberId, purchase);

    if (purchase.state === 'pending') {
      if (!this.pendingNotifications.has(key)) {
        this.pendingNotifications.add(key);
        observer?.onPending?.(purchase);
      }
      return Promise.resolve({verified: false, purchase, reason: 'pending'});
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const task = this.processOnce(memberId, purchase, observer).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
    return task;
  }

  private async processOnce(
    memberId: MemberId,
    purchase: StorePurchase,
    observer: PurchaseObserver | undefined,
  ): Promise<PurchaseVerificationResult> {
    const key = processingKey(memberId, purchase);
    let state = this.processing.get(key);
    if (!state) {
      state = {
        purchase,
        verification: undefined,
        finished: false,
        notified: false,
      };
      this.processing.set(key, state);
    }

    if (!state.verification) {
      state.verification = await this.serverVerify(memberId, state.purchase);
    }

    if (!state.verification.verified) {
      if (!state.notified) {
        state.notified = true;
        observer?.onRejected?.(state.verification);
      }
      return state.verification;
    }

    if (!state.finished) {
      await this.finish(state.verification.verifiedPurchase);
      state.finished = true;
    }
    if (!state.notified) {
      state.notified = true;
      observer?.onVerified(state.verification.verifiedPurchase);
    }
    return state.verification;
  }
}
