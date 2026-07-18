import {parseIsoTimestamp} from '@cyclepair/product-core';
import {Platform} from 'react-native';
import {
  deepLinkToSubscriptions,
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  restorePurchases,
} from 'react-native-iap';
import type {
  ProductSubscription,
  ProductSubscriptionAndroid,
  Purchase,
} from 'react-native-iap';

import type {
  OpenIapClient,
  OpenIapManageRequest,
  OpenIapPurchase,
  OpenIapPurchaseError,
  OpenIapSubscriptionProduct,
  OpenIapSubscriptionRequest,
  PurchaseListenerSubscription,
} from './OpenIapClient';

function providerForPlatform(): OpenIapClient['provider'] {
  if (Platform.OS === 'android') {
    return 'google-play';
  }
  if (Platform.OS === 'ios') {
    return 'app-store';
  }
  throw new Error(`Unsupported in-app purchase platform: ${Platform.OS}`);
}

function lastPricingPhase(product: ProductSubscriptionAndroid, offerIndex: number) {
  const offer = product.subscriptionOfferDetailsAndroid[offerIndex];
  if (!offer) {
    return undefined;
  }
  const phases = offer.pricingPhases.pricingPhaseList;
  return phases[phases.length - 1];
}

function toProducts(product: ProductSubscription): readonly OpenIapSubscriptionProduct[] {
  if (product.platform === 'ios') {
    return [
      {
        provider: 'app-store',
        productId: product.id,
        title: product.title,
        description: product.description,
        displayPrice: product.displayPrice,
        currencyCode: product.currency,
      },
    ];
  }

  return product.subscriptionOfferDetailsAndroid.map((offer, index) => {
    const phase = lastPricingPhase(product, index);
    return {
      provider: 'google-play' as const,
      productId: product.id,
      basePlanId: offer.basePlanId,
      title: product.title,
      description: product.description,
      displayPrice: phase?.formattedPrice ?? product.displayPrice,
      currencyCode: phase?.priceCurrencyCode ?? product.currency,
      offerToken: offer.offerToken,
    };
  });
}

function toPurchase(purchase: Purchase): OpenIapPurchase {
  const provider = purchase.platform === 'android' ? 'google-play' : 'app-store';
  const transactionId = purchase.transactionId ?? purchase.id;
  const purchasedAt = parseIsoTimestamp(new Date(purchase.transactionDate).toISOString());

  return {
    provider,
    productId: purchase.productId,
    ...(provider === 'google-play' && purchase.currentPlanId
      ? {basePlanId: purchase.currentPlanId}
      : {}),
    transactionId,
    ...(purchase.purchaseToken ? {purchaseToken: purchase.purchaseToken} : {}),
    purchasedAt,
    state: purchase.purchaseState,
    nativePurchase: purchase,
  };
}

export class ReactNativeIapClient implements OpenIapClient {
  readonly provider = providerForPlatform();

  async connect(): Promise<void> {
    const connected = await initConnection();
    if (!connected) {
      throw new Error('Store billing connection was not established.');
    }
  }

  async disconnect(): Promise<void> {
    await endConnection();
  }

  addPurchaseUpdatedListener(
    listener: (purchase: OpenIapPurchase) => void,
  ): PurchaseListenerSubscription {
    return purchaseUpdatedListener(purchase => listener(toPurchase(purchase)));
  }

  addPurchaseErrorListener(
    listener: (error: OpenIapPurchaseError) => void,
  ): PurchaseListenerSubscription {
    return purchaseErrorListener(error =>
      listener({
        code: error.code,
        message: error.message,
        ...(error.productId ? {productId: error.productId} : {}),
      }),
    );
  }

  async fetchSubscriptions(
    productIds: readonly string[],
  ): Promise<readonly OpenIapSubscriptionProduct[]> {
    const products = await fetchProducts({skus: [...productIds], type: 'subs'});
    if (!products) {
      return [];
    }

    const subscriptions: ProductSubscription[] = [];
    for (const product of products) {
      if (product.type === 'subs') {
        subscriptions.push(product as ProductSubscription);
      }
    }
    return subscriptions.flatMap(toProducts);
  }

  async requestSubscription(request: OpenIapSubscriptionRequest): Promise<void> {
    if (request.provider === 'google-play') {
      if (!request.offerToken) {
        throw new Error('Google Play subscription offer token is required.');
      }
      await requestPurchase({
        type: 'subs',
        request: {
          google: {
            skus: [request.productId],
            subscriptionOffers: [
              {sku: request.productId, offerToken: request.offerToken},
            ],
            ...(request.appAccountToken
              ? {obfuscatedAccountId: request.appAccountToken}
              : {}),
          },
        },
      });
      return;
    }

    await requestPurchase({
      type: 'subs',
      request: {
        apple: {
          sku: request.productId,
          andDangerouslyFinishTransactionAutomatically: false,
          ...(request.appAccountToken
            ? {appAccountToken: request.appAccountToken}
            : {}),
        },
      },
    });
  }

  async restoreSubscriptions(): Promise<readonly OpenIapPurchase[]> {
    await restorePurchases();
    const purchases = await getAvailablePurchases({
      includeSuspendedAndroid: true,
      onlyIncludeActiveItemsIOS: false,
    });
    return purchases.map(toPurchase);
  }

  async finishSubscription(purchase: OpenIapPurchase): Promise<void> {
    await finishTransaction({
      purchase: purchase.nativePurchase as Purchase,
      isConsumable: false,
    });
  }

  async openManageSubscriptions(request: OpenIapManageRequest): Promise<void> {
    if (request.provider === 'google-play') {
      await deepLinkToSubscriptions({
        packageNameAndroid: request.androidPackageName,
        ...(request.productId ? {skuAndroid: request.productId} : {}),
      });
      return;
    }
    await deepLinkToSubscriptions();
  }
}
