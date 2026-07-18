import {createHash, randomUUID} from "node:crypto";

export const SUBSCRIPTION_SCHEMA_VERSION = 1;
export const CYCLE_PAIR_APP_ID = "com.seorilabs.cyclepair";
export const SUBSCRIPTION_SALES_ENABLED = false;

export type SubscriptionProvider = "google-play" | "app-store";
export type SubscriptionStatus =
  | "none"
  | "pending"
  | "trialing"
  | "active"
  | "grace-period"
  | "on-hold"
  | "canceled"
  | "expired"
  | "revoked"
  | "refunded"
  | "unknown";
export type SubscriptionRenewalState =
  | "will-renew"
  | "canceled"
  | "billing-retry"
  | "paused"
  | "unknown";
export type SubscriptionPaymentState =
  | "pending"
  | "paid"
  | "grace-period"
  | "on-hold"
  | "expired"
  | "revoked"
  | "refunded"
  | "unknown";

export interface SubscriptionSnapshot {
  readonly status: SubscriptionStatus;
  readonly provider: SubscriptionProvider;
  readonly productId: string;
  readonly basePlanId: string;
  readonly renewalState: SubscriptionRenewalState;
  readonly paymentState: SubscriptionPaymentState;
  readonly expiresAt?: string;
  readonly gracePeriodExpiresAt?: string;
  readonly verifiedAt: string;
}

export interface CatalogPlan {
  readonly provider: SubscriptionProvider;
  readonly productId: string;
  readonly basePlanId: "monthly" | "yearly";
}

export const CYCLE_PAIR_SUBSCRIPTION_PLANS: readonly CatalogPlan[] =
  Object.freeze([
    Object.freeze({
      provider: "google-play" as const,
      productId: "cyclepair_plus",
      basePlanId: "monthly" as const,
    }),
    Object.freeze({
      provider: "google-play" as const,
      productId: "cyclepair_plus",
      basePlanId: "yearly" as const,
    }),
    Object.freeze({
      provider: "app-store" as const,
      productId: "com.seorilabs.cyclepair.plus.monthly",
      basePlanId: "monthly" as const,
    }),
    Object.freeze({
      provider: "app-store" as const,
      productId: "com.seorilabs.cyclepair.plus.yearly",
      basePlanId: "yearly" as const,
    }),
  ]);

export type SubscriptionPolicyCode =
  | "invalid-argument"
  | "failed-precondition"
  | "permission-denied"
  | "already-exists";

export type PurchaseVerificationFailureReason =
  | "invalid"
  | "product-mismatch"
  | "account-mismatch"
  | "revoked"
  | "unknown";

export class SubscriptionPolicyError extends Error {
  constructor(
    readonly code: SubscriptionPolicyCode,
    readonly reason: PurchaseVerificationFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "SubscriptionPolicyError";
  }
}

export interface VerifySubscriptionRequest {
  readonly provider: SubscriptionProvider;
  readonly productId: string;
  readonly basePlanId: string;
  readonly transactionId: string;
  /** Signed transaction JWS on iOS; Play purchase token on Android. */
  readonly purchaseToken: string;
}

export interface GoogleSubscriptionLineItem {
  readonly productId?: string | null;
  readonly expiryTime?: string | null;
  readonly offerDetails?: {
    readonly basePlanId?: string | null;
  } | null;
  readonly offerPhase?: {
    readonly freeTrial?: unknown;
  } | null;
  readonly autoRenewingPlan?: {
    readonly autoRenewEnabled?: boolean | null;
  } | null;
}

export interface GoogleSubscriptionPurchase {
  readonly subscriptionState?: string | null;
  readonly lineItems?: readonly GoogleSubscriptionLineItem[] | null;
  readonly externalAccountIdentifiers?: {
    readonly obfuscatedExternalAccountId?: string | null;
  } | null;
}

export interface AppleTransaction {
  readonly originalTransactionId?: string;
  readonly transactionId?: string;
  readonly bundleId?: string;
  readonly productId?: string;
  readonly type?: string;
  readonly appAccountToken?: string;
  readonly purchaseDate?: number;
  readonly expiresDate?: number;
  readonly revocationDate?: number;
  readonly revocationReason?: number;
  readonly offerDiscountType?: string;
}

export interface AppleRenewalInfo {
  readonly originalTransactionId?: string;
  readonly productId?: string;
  readonly appAccountToken?: string;
  readonly autoRenewStatus?: number;
  readonly isInBillingRetryPeriod?: boolean;
  readonly gracePeriodExpiresDate?: number;
}

export interface ProviderPurchase {
  readonly provider: SubscriptionProvider;
  readonly stablePurchaseId: string;
  readonly accountToken: string;
  readonly snapshot: SubscriptionSnapshot;
}

export interface GoogleNotification {
  readonly packageName: string;
  readonly eventTimeMillis: number;
  readonly kind: "subscription" | "voided" | "test";
  readonly purchaseToken?: string;
  readonly notificationType?: number;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function requiredString(
  data: JsonRecord,
  field: string,
  maxLength: number,
): string {
  const value = data[field];
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new SubscriptionPolicyError(
      "invalid-argument",
      "invalid",
      `${field}가 올바르지 않습니다.`,
    );
  }
  return value;
}

export function findCatalogPlan(
  provider: SubscriptionProvider,
  productId: string,
  basePlanId: string,
): CatalogPlan | undefined {
  return CYCLE_PAIR_SUBSCRIPTION_PLANS.find(plan =>
    plan.provider === provider &&
    plan.productId === productId &&
    plan.basePlanId === basePlanId,
  );
}

export function parseVerifySubscriptionRequest(
  value: unknown,
): VerifySubscriptionRequest {
  const data = asRecord(value);
  if (data === undefined) {
    throw new SubscriptionPolicyError(
      "invalid-argument",
      "invalid",
      "구독 검증 요청 형식이 올바르지 않습니다.",
    );
  }
  const provider = requiredString(data, "provider", 32);
  if (provider !== "google-play" && provider !== "app-store") {
    throw new SubscriptionPolicyError(
      "invalid-argument",
      "invalid",
      "지원하지 않는 구독 제공자입니다.",
    );
  }
  const productId = requiredString(data, "productId", 160);
  const basePlanId = requiredString(data, "basePlanId", 64);
  const transactionId = requiredString(data, "transactionId", 256);
  const purchaseToken = requiredString(data, "purchaseToken", 32_768);
  if (findCatalogPlan(provider, productId, basePlanId) === undefined) {
    throw new SubscriptionPolicyError(
      "invalid-argument",
      "product-mismatch",
      "허용되지 않은 구독 상품입니다.",
    );
  }
  return {provider, productId, basePlanId, transactionId, purchaseToken};
}

export function newPurchaseAccountToken(): string {
  return randomUUID();
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function purchaseBindingId(
  provider: SubscriptionProvider,
  stablePurchaseId: string,
): string {
  return createHash("sha256")
    .update(`${provider}:${stablePurchaseId}`)
    .digest("hex");
}

function isoInstant(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const millis = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}

function expiryRequired(
  value: string | number | null | undefined,
  status: SubscriptionStatus,
): string | undefined {
  const expiry = isoInstant(value);
  if (
    expiry === undefined &&
    ["trialing", "active", "grace-period", "canceled"].includes(status)
  ) {
    throw new SubscriptionPolicyError(
      "failed-precondition",
      "invalid",
      "구독 만료 정보가 없습니다.",
    );
  }
  return expiry;
}

function googleRenewalState(
  subscriptionState: string,
  autoRenewEnabled: boolean,
): SubscriptionRenewalState {
  if (subscriptionState === "SUBSCRIPTION_STATE_PAUSED") {
    return "paused";
  }
  if (
    subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" ||
    subscriptionState === "SUBSCRIPTION_STATE_ON_HOLD"
  ) {
    return "billing-retry";
  }
  return autoRenewEnabled ? "will-renew" : "canceled";
}

function googleStatus(
  subscriptionState: string,
  autoRenewEnabled: boolean,
  freeTrial: boolean,
  expiresAt: string | undefined,
  now: string,
  override: "revoked" | "refunded" | undefined,
): SubscriptionStatus {
  if (override !== undefined) {
    return override;
  }
  switch (subscriptionState) {
    case "SUBSCRIPTION_STATE_PENDING":
      return "pending";
    case "SUBSCRIPTION_STATE_ACTIVE":
      if (freeTrial) {
        return "trialing";
      }
      return autoRenewEnabled ? "active" : "canceled";
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      return "grace-period";
    case "SUBSCRIPTION_STATE_ON_HOLD":
    case "SUBSCRIPTION_STATE_PAUSED":
      return "on-hold";
    case "SUBSCRIPTION_STATE_CANCELED":
      return expiresAt !== undefined && Date.parse(expiresAt) > Date.parse(now)
        ? "canceled"
        : "expired";
    case "SUBSCRIPTION_STATE_EXPIRED":
    case "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED":
      return "expired";
    default:
      return "unknown";
  }
}

function paymentState(status: SubscriptionStatus): SubscriptionPaymentState {
  switch (status) {
    case "pending":
      return "pending";
    case "trialing":
    case "active":
    case "canceled":
      return "paid";
    case "grace-period":
      return "grace-period";
    case "on-hold":
      return "on-hold";
    case "expired":
      return "expired";
    case "revoked":
      return "revoked";
    case "refunded":
      return "refunded";
    case "none":
    case "unknown":
      return "unknown";
  }
}

export function normalizeGoogleSubscription(input: {
  readonly purchase: GoogleSubscriptionPurchase;
  readonly purchaseToken: string;
  readonly expectedProductId?: string;
  readonly expectedBasePlanId?: string;
  readonly now: string;
  readonly override?: "revoked" | "refunded";
}): ProviderPurchase {
  const lines = (input.purchase.lineItems ?? []).filter(line => {
    const productId = line.productId ?? "";
    const basePlanId = line.offerDetails?.basePlanId ?? "";
    const catalogPlan = findCatalogPlan("google-play", productId, basePlanId);
    return catalogPlan !== undefined &&
      (input.expectedProductId === undefined ||
        input.expectedProductId === productId) &&
      (input.expectedBasePlanId === undefined ||
        input.expectedBasePlanId === basePlanId);
  });
  lines.sort((left, right) =>
    Date.parse(right.expiryTime ?? "") - Date.parse(left.expiryTime ?? ""),
  );
  const line = lines[0];
  if (line === undefined) {
    throw new SubscriptionPolicyError(
      "failed-precondition",
      "product-mismatch",
      "Play 구독 상품이 허용 목록과 일치하지 않습니다.",
    );
  }
  const productId = line.productId ?? "";
  const basePlanId = line.offerDetails?.basePlanId ?? "";
  const accountToken =
    input.purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (accountToken === null || accountToken === undefined || !isUuid(accountToken)) {
    throw new SubscriptionPolicyError(
      "failed-precondition",
      "account-mismatch",
      "Play 구매 계정 바인딩이 없습니다.",
    );
  }
  const subscriptionState = input.purchase.subscriptionState ?? "";
  const autoRenewEnabled = line.autoRenewingPlan?.autoRenewEnabled === true;
  const provisionalExpiry = isoInstant(line.expiryTime);
  const status = googleStatus(
    subscriptionState,
    autoRenewEnabled,
    line.offerPhase?.freeTrial !== undefined,
    provisionalExpiry,
    input.now,
    input.override,
  );
  const expiresAt = expiryRequired(line.expiryTime, status);
  const snapshot: SubscriptionSnapshot = {
    status,
    provider: "google-play",
    productId,
    basePlanId,
    renewalState: googleRenewalState(subscriptionState, autoRenewEnabled),
    paymentState: paymentState(status),
    ...(expiresAt === undefined ? {} : {expiresAt}),
    ...(status === "grace-period" && expiresAt !== undefined
      ? {gracePeriodExpiresAt: expiresAt}
      : {}),
    verifiedAt: isoInstant(input.now) ?? new Date(0).toISOString(),
  };
  return {
    provider: "google-play",
    stablePurchaseId: input.purchaseToken,
    accountToken,
    snapshot,
  };
}

function applePlan(productId: string): CatalogPlan | undefined {
  return CYCLE_PAIR_SUBSCRIPTION_PLANS.find(plan =>
    plan.provider === "app-store" && plan.productId === productId,
  );
}

function appleRenewalState(
  status: number | undefined,
  renewal: AppleRenewalInfo | undefined,
): SubscriptionRenewalState {
  if (status === 3 || renewal?.isInBillingRetryPeriod === true) {
    return "billing-retry";
  }
  if (renewal?.autoRenewStatus === 1) {
    return "will-renew";
  }
  if (renewal?.autoRenewStatus === 0) {
    return "canceled";
  }
  return "unknown";
}

function appleStatus(input: {
  readonly status?: number;
  readonly transaction: AppleTransaction;
  readonly renewal?: AppleRenewalInfo;
  readonly notificationType?: string;
  readonly now: string;
}): SubscriptionStatus {
  if (input.notificationType === "REFUND") {
    return "refunded";
  }
  if (
    input.notificationType === "REVOKE" ||
    input.transaction.revocationDate !== undefined ||
    input.status === 5
  ) {
    return "revoked";
  }
  switch (input.status) {
    case 1:
      if (input.transaction.offerDiscountType === "FREE_TRIAL") {
        return "trialing";
      }
      return input.renewal?.autoRenewStatus === 0 ? "canceled" : "active";
    case 2:
      return "expired";
    case 3:
      return "on-hold";
    case 4:
      return "grace-period";
    default: {
      const expiresAt = isoInstant(input.transaction.expiresDate);
      return expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(input.now)
        ? "expired"
        : "unknown";
    }
  }
}

export function normalizeAppleSubscription(input: {
  readonly transaction: AppleTransaction;
  readonly renewal?: AppleRenewalInfo;
  readonly status?: number;
  readonly notificationType?: string;
  readonly expectedTransactionId?: string;
  readonly expectedProductId?: string;
  readonly expectedBasePlanId?: string;
  readonly now: string;
}): ProviderPurchase {
  const transaction = input.transaction;
  if (
    transaction.bundleId !== CYCLE_PAIR_APP_ID ||
    transaction.type !== "Auto-Renewable Subscription"
  ) {
    throw new SubscriptionPolicyError(
      "failed-precondition",
      "product-mismatch",
      "App Store 앱 또는 상품 유형이 일치하지 않습니다.",
    );
  }
  const productId = transaction.productId ?? "";
  const plan = applePlan(productId);
  if (
    plan === undefined ||
    (input.expectedProductId !== undefined &&
      input.expectedProductId !== productId) ||
    (input.expectedBasePlanId !== undefined &&
      input.expectedBasePlanId !== plan.basePlanId)
  ) {
    throw new SubscriptionPolicyError(
      "failed-precondition",
      "product-mismatch",
      "App Store 구독 상품이 허용 목록과 일치하지 않습니다.",
    );
  }
  if (
    input.expectedTransactionId !== undefined &&
    transaction.transactionId !== input.expectedTransactionId
  ) {
    throw new SubscriptionPolicyError(
      "failed-precondition",
      "invalid",
      "App Store 거래 식별자가 일치하지 않습니다.",
    );
  }
  const stablePurchaseId = transaction.originalTransactionId;
  const transactionToken = transaction.appAccountToken;
  const renewalToken = input.renewal?.appAccountToken;
  if (
    stablePurchaseId === undefined ||
    stablePurchaseId.length === 0 ||
    transactionToken === undefined ||
    !isUuid(transactionToken) ||
    (renewalToken !== undefined && renewalToken !== transactionToken)
  ) {
    throw new SubscriptionPolicyError(
      "failed-precondition",
      "account-mismatch",
      "App Store 구매 계정 바인딩이 일치하지 않습니다.",
    );
  }
  const status = appleStatus(input);
  const expiresAt = expiryRequired(transaction.expiresDate, status);
  const gracePeriodExpiresAt = status === "grace-period"
    ? expiryRequired(input.renewal?.gracePeriodExpiresDate, status)
    : undefined;
  const snapshot: SubscriptionSnapshot = {
    status,
    provider: "app-store",
    productId,
    basePlanId: plan.basePlanId,
    renewalState: appleRenewalState(input.status, input.renewal),
    paymentState: paymentState(status),
    ...(expiresAt === undefined ? {} : {expiresAt}),
    ...(gracePeriodExpiresAt === undefined ? {} : {gracePeriodExpiresAt}),
    verifiedAt: isoInstant(input.now) ?? new Date(0).toISOString(),
  };
  return {
    provider: "app-store",
    stablePurchaseId,
    accountToken: transactionToken,
    snapshot,
  };
}

export function decodeGoogleDeveloperNotification(
  encodedData: string,
): GoogleNotification {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encodedData, "base64").toString("utf8"));
  } catch {
    throw new SubscriptionPolicyError(
      "invalid-argument",
      "invalid",
      "Play 알림 형식이 올바르지 않습니다.",
    );
  }
  const data = asRecord(value);
  const packageName = data?.packageName;
  const eventTimeMillis = Number(data?.eventTimeMillis);
  if (
    packageName !== CYCLE_PAIR_APP_ID ||
    !Number.isSafeInteger(eventTimeMillis) ||
    eventTimeMillis <= 0
  ) {
    throw new SubscriptionPolicyError(
      "invalid-argument",
      "product-mismatch",
      "Play 알림 앱 식별자가 일치하지 않습니다.",
    );
  }
  if (asRecord(data?.testNotification) !== undefined) {
    return {packageName, eventTimeMillis, kind: "test"};
  }
  const subscription = asRecord(data?.subscriptionNotification);
  if (subscription !== undefined) {
    const purchaseToken = subscription.purchaseToken;
    const notificationType = subscription.notificationType;
    if (
      typeof purchaseToken !== "string" ||
      purchaseToken.length === 0 ||
      purchaseToken.length > 4_096 ||
      typeof notificationType !== "number" ||
      !Number.isSafeInteger(notificationType)
    ) {
      throw new SubscriptionPolicyError(
        "invalid-argument",
        "invalid",
        "Play 구독 알림이 올바르지 않습니다.",
      );
    }
    return {
      packageName,
      eventTimeMillis,
      kind: "subscription",
      purchaseToken,
      notificationType,
    };
  }
  const voided = asRecord(data?.voidedPurchaseNotification);
  if (voided !== undefined && voided.productType === 1) {
    const purchaseToken = voided.purchaseToken;
    if (typeof purchaseToken !== "string" || purchaseToken.length === 0) {
      throw new SubscriptionPolicyError(
        "invalid-argument",
        "invalid",
        "Play 환불 알림이 올바르지 않습니다.",
      );
    }
    return {packageName, eventTimeMillis, kind: "voided", purchaseToken};
  }
  throw new SubscriptionPolicyError(
    "invalid-argument",
    "invalid",
    "지원하지 않는 Play 알림입니다.",
  );
}

export function googleNotificationOverride(
  notification: GoogleNotification,
): "revoked" | "refunded" | undefined {
  if (notification.kind === "voided") {
    return "refunded";
  }
  return notification.notificationType === 12 ? "revoked" : undefined;
}

export interface ProviderEventOrder {
  readonly occurredAtMillis: number;
  readonly eventId: string;
}

export function shouldApplyProviderEvent(
  current: ProviderEventOrder | undefined,
  incoming: ProviderEventOrder,
): boolean {
  return current === undefined ||
    incoming.occurredAtMillis > current.occurredAtMillis ||
    (incoming.occurredAtMillis === current.occurredAtMillis &&
      incoming.eventId > current.eventId);
}
