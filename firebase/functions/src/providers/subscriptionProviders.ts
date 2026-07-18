import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type LastTransactionsItem,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import {defineSecret, type SecretParam} from "firebase-functions/params";
import {google, type androidpublisher_v3} from "googleapis";

import {
  CYCLE_PAIR_APP_ID,
  ProviderPurchase,
  SubscriptionPolicyError,
  VerifySubscriptionRequest,
  normalizeAppleSubscription,
  normalizeGoogleSubscription,
} from "../domain/subscription.js";

const ANDROID_PUBLISHER_SCOPE =
  "https://www.googleapis.com/auth/androidpublisher";

const appleIapPrivateKeyBase64 = defineSecret(
  "APPLE_IAP_PRIVATE_KEY_BASE64",
);
const appleIapKeyId = defineSecret("APPLE_IAP_KEY_ID");
const appleIapIssuerId = defineSecret("APPLE_IAP_ISSUER_ID");
const appleAppId = defineSecret("APPLE_APP_ID");
const appleIapRootCertificatesBase64Json = defineSecret(
  "APPLE_IAP_ROOT_CERTIFICATES_BASE64_JSON",
);

export const APPLE_IAP_SECRETS = Object.freeze([
  appleIapPrivateKeyBase64,
  appleIapKeyId,
  appleIapIssuerId,
  appleAppId,
  appleIapRootCertificatesBase64Json,
]);

export interface GooglePlaySubscriptionProvider {
  verifyPurchase(input: {
    readonly purchaseToken: string;
    readonly expectedProductId?: string;
    readonly expectedBasePlanId?: string;
    readonly now: string;
    readonly override?: "revoked" | "refunded";
  }): Promise<ProviderPurchase>;
}

export class GooglePlayDeveloperApiProvider
implements GooglePlaySubscriptionProvider {
  private readonly publisher: androidpublisher_v3.Androidpublisher;

  constructor(publisher?: androidpublisher_v3.Androidpublisher) {
    this.publisher = publisher ?? google.androidpublisher({
      version: "v3",
      auth: new google.auth.GoogleAuth({scopes: [ANDROID_PUBLISHER_SCOPE]}),
    });
  }

  async verifyPurchase(input: {
    readonly purchaseToken: string;
    readonly expectedProductId?: string;
    readonly expectedBasePlanId?: string;
    readonly now: string;
    readonly override?: "revoked" | "refunded";
  }): Promise<ProviderPurchase> {
    let purchase: androidpublisher_v3.Schema$SubscriptionPurchaseV2;
    try {
      const response = await this.publisher.purchases.subscriptionsv2.get({
        packageName: CYCLE_PAIR_APP_ID,
        token: input.purchaseToken,
      });
      purchase = response.data;
    } catch {
      throw new SubscriptionPolicyError(
        "failed-precondition",
        "unknown",
        "Google Play 구독 상태를 확인할 수 없습니다.",
      );
    }
    return normalizeGoogleSubscription({
      purchase,
      purchaseToken: input.purchaseToken,
      ...(input.expectedProductId === undefined
        ? {}
        : {expectedProductId: input.expectedProductId}),
      ...(input.expectedBasePlanId === undefined
        ? {}
        : {expectedBasePlanId: input.expectedBasePlanId}),
      now: input.now,
      ...(input.override === undefined ? {} : {override: input.override}),
    });
  }
}

interface AppleEnvironmentClient {
  readonly environment: Environment;
  readonly verifier: SignedDataVerifier;
  readonly api: AppStoreServerAPIClient;
}

export type AppleNotificationVerification =
  | {
      readonly kind: "ignored";
      readonly eventId: string;
      readonly occurredAtMillis: number;
    }
  | {
      readonly kind: "subscription";
      readonly eventId: string;
      readonly occurredAtMillis: number;
      readonly purchase: ProviderPurchase;
    };

export interface AppleAppStoreSubscriptionProvider {
  verifyPurchase(
    request: VerifySubscriptionRequest,
    now: string,
  ): Promise<ProviderPurchase>;
  verifyNotification(
    signedPayload: string,
    now: string,
  ): Promise<AppleNotificationVerification>;
}

interface VerifiedAppleValue<T> {
  readonly client: AppleEnvironmentClient;
  readonly value: T;
}

function providerUnavailable(): SubscriptionPolicyError {
  return new SubscriptionPolicyError(
    "failed-precondition",
    "unknown",
    "App Store 구독 검증 구성이 완료되지 않았습니다.",
  );
}

function requiredSecret(secret: SecretParam): string {
  let value: string;
  try {
    value = secret.value();
  } catch {
    throw providerUnavailable();
  }
  if (value === undefined || value.trim().length === 0) {
    throw providerUnavailable();
  }
  return value;
}

function appleRootCertificates(): Buffer[] {
  let values: unknown;
  try {
    values = JSON.parse(
      requiredSecret(appleIapRootCertificatesBase64Json),
    );
  } catch {
    throw providerUnavailable();
  }
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    !values.every(value => typeof value === "string" && value.length > 0)
  ) {
    throw providerUnavailable();
  }
  return values.map(value => Buffer.from(value as string, "base64"));
}

function createAppleEnvironmentClients(): readonly AppleEnvironmentClient[] {
  const roots = appleRootCertificates();
  const signingKey = Buffer.from(
    requiredSecret(appleIapPrivateKeyBase64),
    "base64",
  ).toString("utf8");
  const keyId = requiredSecret(appleIapKeyId);
  const issuerId = requiredSecret(appleIapIssuerId);
  const appAppleId = Number(requiredSecret(appleAppId));
  if (!Number.isSafeInteger(appAppleId) || appAppleId <= 0) {
    throw providerUnavailable();
  }
  return [Environment.PRODUCTION, Environment.SANDBOX].map(environment => ({
    environment,
    verifier: new SignedDataVerifier(
      roots,
      true,
      environment,
      CYCLE_PAIR_APP_ID,
      environment === Environment.PRODUCTION ? appAppleId : undefined,
    ),
    api: new AppStoreServerAPIClient(
      signingKey,
      keyId,
      issuerId,
      CYCLE_PAIR_APP_ID,
      environment,
    ),
  }));
}

export class OfficialAppleAppStoreProvider
implements AppleAppStoreSubscriptionProvider {
  private clients: readonly AppleEnvironmentClient[] | undefined;

  constructor(clients?: readonly AppleEnvironmentClient[]) {
    this.clients = clients;
  }

  private environmentClients(): readonly AppleEnvironmentClient[] {
    this.clients ??= createAppleEnvironmentClients();
    return this.clients;
  }

  private async verifyInEnvironment<T>(
    verify: (verifier: SignedDataVerifier) => Promise<T>,
  ): Promise<VerifiedAppleValue<T>> {
    for (const client of this.environmentClients()) {
      try {
        return {client, value: await verify(client.verifier)};
      } catch (error) {
        if (
          error instanceof VerificationException &&
          error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
        ) {
          throw providerUnavailable();
        }
        // The signed environment is not trusted until one configured verifier
        // validates the complete Apple certificate chain and app identity.
      }
    }
    throw new SubscriptionPolicyError(
      "failed-precondition",
      "invalid",
      "App Store 서명을 검증할 수 없습니다.",
    );
  }

  async verifyPurchase(
    request: VerifySubscriptionRequest,
    now: string,
  ): Promise<ProviderPurchase> {
    const initial = await this.verifyInEnvironment(verifier =>
      verifier.verifyAndDecodeTransaction(request.purchaseToken),
    );
    const initialPurchase = normalizeAppleSubscription({
      transaction: initial.value,
      status: 1,
      expectedTransactionId: request.transactionId,
      expectedProductId: request.productId,
      expectedBasePlanId: request.basePlanId,
      now,
    });

    let latest: LastTransactionsItem | undefined;
    try {
      const response = await initial.client.api.getAllSubscriptionStatuses(
        initialPurchase.stablePurchaseId,
      );
      if (response.bundleId !== CYCLE_PAIR_APP_ID) {
        throw new Error("bundle mismatch");
      }
      latest = response.data
        ?.flatMap(group => group.lastTransactions ?? [])
        .find(item =>
          item.originalTransactionId === initialPurchase.stablePurchaseId,
        );
    } catch {
      throw new SubscriptionPolicyError(
        "failed-precondition",
        "unknown",
        "App Store 구독 상태를 확인할 수 없습니다.",
      );
    }
    if (
      latest?.signedTransactionInfo === undefined ||
      latest.signedRenewalInfo === undefined
    ) {
      throw new SubscriptionPolicyError(
        "failed-precondition",
        "invalid",
        "App Store 구독 상태 응답이 불완전합니다.",
      );
    }
    let transaction: JWSTransactionDecodedPayload;
    let renewal: JWSRenewalInfoDecodedPayload;
    try {
      [transaction, renewal] = await Promise.all([
        initial.client.verifier.verifyAndDecodeTransaction(
          latest.signedTransactionInfo,
        ),
        initial.client.verifier.verifyAndDecodeRenewalInfo(
          latest.signedRenewalInfo,
        ),
      ]);
    } catch {
      throw new SubscriptionPolicyError(
        "failed-precondition",
        "invalid",
        "App Store 상태 서명을 검증할 수 없습니다.",
      );
    }
    const authoritative = normalizeAppleSubscription({
      transaction,
      renewal,
      ...(latest.status === undefined ? {} : {status: latest.status}),
      expectedProductId: request.productId,
      expectedBasePlanId: request.basePlanId,
      now,
    });
    if (
      authoritative.stablePurchaseId !== initialPurchase.stablePurchaseId ||
      authoritative.accountToken !== initialPurchase.accountToken
    ) {
      throw new SubscriptionPolicyError(
        "failed-precondition",
        "account-mismatch",
        "App Store 구매 계정 연결이 일치하지 않습니다.",
      );
    }
    return authoritative;
  }

  async verifyNotification(
    signedPayload: string,
    now: string,
  ): Promise<AppleNotificationVerification> {
    const verified = await this.verifyInEnvironment(verifier =>
      verifier.verifyAndDecodeNotification(signedPayload),
    );
    return this.notificationPurchase(verified.client, verified.value, now);
  }

  private async notificationPurchase(
    client: AppleEnvironmentClient,
    notification: ResponseBodyV2DecodedPayload,
    now: string,
  ): Promise<AppleNotificationVerification> {
    const eventId = notification.notificationUUID;
    const occurredAtMillis = notification.signedDate;
    if (
      eventId === undefined ||
      eventId.length === 0 ||
      occurredAtMillis === undefined ||
      !Number.isSafeInteger(occurredAtMillis)
    ) {
      throw new SubscriptionPolicyError(
        "invalid-argument",
        "invalid",
        "App Store 알림 식별자가 없습니다.",
      );
    }
    const signedTransaction = notification.data?.signedTransactionInfo;
    if (
      notification.notificationType === "TEST" ||
      signedTransaction === undefined
    ) {
      return {kind: "ignored", eventId, occurredAtMillis};
    }
    let transaction: JWSTransactionDecodedPayload;
    let renewal: JWSRenewalInfoDecodedPayload | undefined;
    try {
      transaction = await client.verifier.verifyAndDecodeTransaction(
        signedTransaction,
      );
      const signedRenewal = notification.data?.signedRenewalInfo;
      renewal = signedRenewal === undefined
        ? undefined
        : await client.verifier.verifyAndDecodeRenewalInfo(signedRenewal);
    } catch {
      throw new SubscriptionPolicyError(
        "failed-precondition",
        "invalid",
        "App Store 알림 내부 서명을 검증할 수 없습니다.",
      );
    }
    return {
      kind: "subscription",
      eventId,
      occurredAtMillis,
      purchase: normalizeAppleSubscription({
        transaction,
        ...(renewal === undefined ? {} : {renewal}),
        ...(notification.data?.status === undefined
          ? {}
          : {status: notification.data.status}),
        ...(notification.notificationType === undefined
          ? {}
          : {notificationType: notification.notificationType}),
        now,
      }),
    };
  }
}
