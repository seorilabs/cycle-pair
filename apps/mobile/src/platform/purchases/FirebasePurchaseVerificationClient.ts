import {getApp} from '@react-native-firebase/app';
import {getAuth} from '@react-native-firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
} from '@react-native-firebase/firestore';
import {getFunctions, httpsCallable} from '@react-native-firebase/functions';
import {
  parseIsoTimestamp,
  type MemberId,
  type StorePurchase,
  type SubscriptionPaymentState,
  type SubscriptionProvider,
  type SubscriptionRenewalState,
  type SubscriptionSnapshot,
  type SubscriptionStatus,
} from '@cyclepair/product-core';

import type {
  PurchaseAccountIdentity,
  PurchaseVerificationClient,
  ServerPurchaseVerificationResponse,
} from './CyclePairPurchaseAdapter';

const FUNCTIONS_REGION = 'asia-northeast3';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const statuses = new Set<SubscriptionStatus>([
  'none',
  'pending',
  'trialing',
  'active',
  'grace-period',
  'on-hold',
  'canceled',
  'expired',
  'revoked',
  'refunded',
  'unknown',
]);
const providers = new Set<SubscriptionProvider>([
  'google-play',
  'app-store',
]);
const renewalStates = new Set<SubscriptionRenewalState>([
  'will-renew',
  'canceled',
  'billing-retry',
  'paused',
  'unknown',
]);
const paymentStates = new Set<SubscriptionPaymentState>([
  'pending',
  'paid',
  'grace-period',
  'on-hold',
  'expired',
  'revoked',
  'refunded',
  'unknown',
]);
const failureReasons = new Set<
  Exclude<ServerPurchaseVerificationResponse, {verified: true}>['reason']
>([
  'invalid',
  'product-mismatch',
  'account-mismatch',
  'revoked',
  'unknown',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(
  value: unknown,
  field: string,
  maxLength = 256,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`Invalid subscription response field: ${field}`);
  }
  return value;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength = 256,
): string | undefined {
  return value === undefined || value === null
    ? undefined
    : requiredString(value, field, maxLength);
}

function optionalIsoTimestamp(value: unknown, field: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const toDate = (value as {toDate?: unknown}).toDate;
    if (typeof toDate === 'function') {
      return parseIsoTimestamp(
        (toDate as () => Date).call(value).toISOString(),
      );
    }
  }
  try {
    return parseIsoTimestamp(requiredString(value, field, 64));
  } catch {
    throw new Error(`Invalid subscription response field: ${field}`);
  }
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  field: string,
): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    throw new Error(`Invalid subscription response field: ${field}`);
  }
  return value as T;
}

export function parseSubscriptionSnapshot(value: unknown): SubscriptionSnapshot {
  const data = asRecord(value);
  const status = optionalEnum(data?.status, statuses, 'status');
  if (!data || !status) {
    throw new Error('Invalid subscription response.');
  }
  if (status === 'none') return {status};

  const provider = optionalEnum(data.provider, providers, 'provider');
  const productId = optionalString(data.productId, 'productId');
  const basePlanId = optionalString(data.basePlanId, 'basePlanId');
  const renewalState = optionalEnum(
    data.renewalState,
    renewalStates,
    'renewalState',
  );
  const paymentState = optionalEnum(
    data.paymentState,
    paymentStates,
    'paymentState',
  );
  const expiresAt = optionalIsoTimestamp(data.expiresAt, 'expiresAt');
  const gracePeriodExpiresAt = optionalIsoTimestamp(
    data.gracePeriodExpiresAt,
    'gracePeriodExpiresAt',
  );
  const verifiedAt = optionalIsoTimestamp(data.verifiedAt, 'verifiedAt');

  return {
    status,
    ...(provider ? {provider} : {}),
    ...(productId ? {productId} : {}),
    ...(basePlanId ? {basePlanId} : {}),
    ...(renewalState ? {renewalState} : {}),
    ...(paymentState ? {paymentState} : {}),
    ...(expiresAt ? {expiresAt} : {}),
    ...(gracePeriodExpiresAt ? {gracePeriodExpiresAt} : {}),
    ...(verifiedAt ? {verifiedAt} : {}),
  };
}

export function parsePurchaseAccountIdentity(
  value: unknown,
): PurchaseAccountIdentity {
  const data = asRecord(value);
  const appAccountToken = requiredString(
    data?.appAccountToken,
    'appAccountToken',
    36,
  );
  const googleObfuscatedExternalAccountId = requiredString(
    data?.googleObfuscatedExternalAccountId,
    'googleObfuscatedExternalAccountId',
    64,
  );
  if (
    data?.schemaVersion !== 1 ||
    !UUID.test(appAccountToken) ||
    appAccountToken !== googleObfuscatedExternalAccountId
  ) {
    throw new Error('Invalid purchase account identity response.');
  }
  return {appAccountToken, googleObfuscatedExternalAccountId};
}

export function parsePurchaseVerificationResponse(
  value: unknown,
): ServerPurchaseVerificationResponse {
  const data = asRecord(value);
  if (data?.verified === true) {
    return {
      verified: true,
      verificationId: requiredString(
        data.verificationId,
        'verificationId',
        256,
      ),
      subscription: parseSubscriptionSnapshot(data.subscription),
    };
  }
  if (
    data?.verified === false &&
    typeof data.reason === 'string' &&
    failureReasons.has(
      data.reason as Exclude<
        ServerPurchaseVerificationResponse,
        {verified: true}
      >['reason'],
    )
  ) {
    return {
      verified: false,
      reason: data.reason as Exclude<
        ServerPurchaseVerificationResponse,
        {verified: true}
      >['reason'],
    };
  }
  throw new Error('Invalid purchase verification response.');
}

function requireCurrentMember(memberId: MemberId): string {
  const uid = getAuth().currentUser?.uid;
  if (!uid || uid !== memberId) {
    throw new Error('Purchase member does not match the authenticated user.');
  }
  return uid;
}

async function callPurchaseFunction<Response>(
  name: 'getPurchaseAccountToken' | 'verifySubscriptionPurchase',
  data: Readonly<Record<string, unknown>>,
): Promise<Response> {
  const result = await httpsCallable<Record<string, unknown>, Response>(
    getFunctions(getApp(), FUNCTIONS_REGION),
    name,
  )({...data});
  return result.data;
}

export const firebasePurchaseVerificationClient: PurchaseVerificationClient = {
  async getPurchaseAccountIdentity(memberId) {
    requireCurrentMember(memberId);
    return parsePurchaseAccountIdentity(
      await callPurchaseFunction<unknown>('getPurchaseAccountToken', {}),
    );
  },

  async getSubscription(memberId) {
    requireCurrentMember(memberId);
    const snapshot = await getDoc(
      doc(getFirestore(getApp()), 'subscriptions', memberId),
    );
    return snapshot.exists()
      ? parseSubscriptionSnapshot(snapshot.data())
      : {status: 'none'};
  },

  watchSubscription(memberId, onValue, onError) {
    requireCurrentMember(memberId);
    return onSnapshot(
      doc(getFirestore(getApp()), 'subscriptions', memberId),
      snapshot => {
        try {
          onValue(
            snapshot.exists()
              ? parseSubscriptionSnapshot(snapshot.data())
              : {status: 'none'},
          );
        } catch (error) {
          onError(error);
        }
      },
      onError,
    );
  },

  async verifyPurchase(memberId, purchase: StorePurchase) {
    requireCurrentMember(memberId);
    if (!purchase.purchaseToken || !purchase.basePlanId) {
      return {verified: false, reason: 'invalid'};
    }
    return parsePurchaseVerificationResponse(
      await callPurchaseFunction<unknown>('verifySubscriptionPurchase', {
        provider: purchase.provider,
        productId: purchase.productId,
        basePlanId: purchase.basePlanId,
        transactionId: purchase.transactionId,
        purchaseToken: purchase.purchaseToken,
      }),
    );
  },
};
