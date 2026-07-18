import type {
  IsoTimestamp,
  StorePurchaseState,
  SubscriptionProvider,
} from '@cyclepair/product-core';

export interface OpenIapSubscriptionProduct {
  readonly provider: SubscriptionProvider;
  readonly productId: string;
  readonly basePlanId?: string;
  readonly title: string;
  readonly description: string;
  readonly displayPrice: string;
  readonly currencyCode: string;
  readonly offerToken?: string;
}

/** Native purchase reference is kept inside the platform boundary and never sent to the server. */
export interface OpenIapPurchase {
  readonly provider: SubscriptionProvider;
  readonly productId: string;
  readonly basePlanId?: string;
  readonly transactionId: string;
  readonly purchaseToken?: string;
  readonly purchasedAt: IsoTimestamp;
  readonly state: StorePurchaseState;
  readonly nativePurchase: unknown;
}

export interface OpenIapSubscriptionRequest {
  readonly provider: SubscriptionProvider;
  readonly productId: string;
  readonly offerToken?: string;
  readonly appAccountToken?: string;
}

export interface OpenIapManageRequest {
  readonly provider: SubscriptionProvider;
  readonly androidPackageName: string;
  readonly productId?: string;
}

export interface OpenIapPurchaseError {
  readonly code: string;
  readonly message: string;
  readonly productId?: string;
}

export interface PurchaseListenerSubscription {
  remove(): void;
}

/** Minimal OpenIAP surface; native SDK details stop at this interface. */
export interface OpenIapClient {
  readonly provider: SubscriptionProvider;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  addPurchaseUpdatedListener(
    listener: (purchase: OpenIapPurchase) => void,
  ): PurchaseListenerSubscription;
  addPurchaseErrorListener(
    listener: (error: OpenIapPurchaseError) => void,
  ): PurchaseListenerSubscription;
  fetchSubscriptions(
    productIds: readonly string[],
  ): Promise<readonly OpenIapSubscriptionProduct[]>;
  requestSubscription(request: OpenIapSubscriptionRequest): Promise<void>;
  restoreSubscriptions(): Promise<readonly OpenIapPurchase[]>;
  finishSubscription(purchase: OpenIapPurchase): Promise<void>;
  openManageSubscriptions(request: OpenIapManageRequest): Promise<void>;
}

