import {describe, expect, it} from "vitest";

import {
  ProviderEventOrder,
  ProviderPurchase,
  SubscriptionPolicyError,
  VerifySubscriptionRequest,
  decodeGoogleDeveloperNotification,
  newPurchaseAccountToken,
  normalizeAppleSubscription,
  normalizeGoogleSubscription,
  parseVerifySubscriptionRequest,
  purchaseBindingId,
  shouldApplyProviderEvent,
} from "../src/domain/subscription.js";
import {
  APPLE_IAP_SECRETS,
  AppleAppStoreSubscriptionProvider,
  AppleNotificationVerification,
  GooglePlaySubscriptionProvider,
} from "../src/providers/subscriptionProviders.js";
import {
  PurchaseBinding,
  SavedSubscription,
  SubscriptionRepository,
  SubscriptionService,
} from "../src/services/subscriptionService.js";

const now = "2026-07-14T00:00:00.000Z";
const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "22222222-2222-4222-8222-222222222222";

describe("Apple IAP secret boundary", () => {
  it("declares only the credentials required by Apple verification", () => {
    expect(APPLE_IAP_SECRETS.map(secret => secret.name)).toEqual([
      "APPLE_IAP_PRIVATE_KEY_BASE64",
      "APPLE_IAP_KEY_ID",
      "APPLE_IAP_ISSUER_ID",
      "APPLE_APP_ID",
      "APPLE_IAP_ROOT_CERTIFICATES_BASE64_JSON",
    ]);
    expect(new Set(APPLE_IAP_SECRETS).size).toBe(APPLE_IAP_SECRETS.length);
  });
});

function googlePurchase(
  accountToken = accountA,
  subscriptionState = "SUBSCRIPTION_STATE_ACTIVE",
  autoRenewEnabled = true,
): ProviderPurchase {
  return normalizeGoogleSubscription({
    purchase: {
      subscriptionState,
      externalAccountIdentifiers: {
        obfuscatedExternalAccountId: accountToken,
      },
      lineItems: [{
        productId: "cyclepair_plus",
        expiryTime: "2026-08-14T00:00:00.000Z",
        offerDetails: {basePlanId: "monthly"},
        autoRenewingPlan: {autoRenewEnabled},
      }],
    },
    purchaseToken: "play-token",
    expectedProductId: "cyclepair_plus",
    expectedBasePlanId: "monthly",
    now,
  });
}

describe("subscription request and binding policy", () => {
  it("accepts only the fixed catalog and never accepts a client uid", () => {
    expect(parseVerifySubscriptionRequest({
      provider: "google-play",
      productId: "cyclepair_plus",
      basePlanId: "monthly",
      transactionId: "order-1",
      purchaseToken: "token-1",
      uid: "ignored-client-uid",
    })).toEqual({
      provider: "google-play",
      productId: "cyclepair_plus",
      basePlanId: "monthly",
      transactionId: "order-1",
      purchaseToken: "token-1",
    });
    expect(() => parseVerifySubscriptionRequest({
      provider: "google-play",
      productId: "premium-from-client",
      basePlanId: "monthly",
      transactionId: "order-1",
      purchaseToken: "token-1",
    })).toThrowError(SubscriptionPolicyError);
  });

  it("generates UUID account tokens and deterministic opaque binding ids", () => {
    expect(newPurchaseAccountToken()).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(purchaseBindingId("google-play", "secret-token")).toBe(
      purchaseBindingId("google-play", "secret-token"),
    );
    expect(purchaseBindingId("google-play", "secret-token")).not.toContain(
      "secret-token",
    );
    expect(purchaseBindingId("app-store", "secret-token")).not.toBe(
      purchaseBindingId("google-play", "secret-token"),
    );
  });
});

describe("Google Play normalization", () => {
  it("normalizes active, canceled, grace, hold, revoked, and refund states", () => {
    expect(googlePurchase().snapshot).toMatchObject({
      status: "active",
      renewalState: "will-renew",
      paymentState: "paid",
    });
    expect(googlePurchase(accountA, "SUBSCRIPTION_STATE_ACTIVE", false).snapshot)
      .toMatchObject({status: "canceled", renewalState: "canceled"});
    expect(googlePurchase(
      accountA,
      "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
    ).snapshot).toMatchObject({
      status: "grace-period",
      renewalState: "billing-retry",
      paymentState: "grace-period",
      gracePeriodExpiresAt: "2026-08-14T00:00:00.000Z",
    });
    expect(googlePurchase(accountA, "SUBSCRIPTION_STATE_ON_HOLD").snapshot)
      .toMatchObject({status: "on-hold", paymentState: "on-hold"});

    const base = {
      purchase: {
        subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
        externalAccountIdentifiers: {obfuscatedExternalAccountId: accountA},
        lineItems: [{
          productId: "cyclepair_plus",
          expiryTime: "2026-08-14T00:00:00.000Z",
          offerDetails: {basePlanId: "monthly"},
          autoRenewingPlan: {autoRenewEnabled: true},
        }],
      },
      purchaseToken: "play-token",
      now,
    } as const;
    expect(normalizeGoogleSubscription({...base, override: "revoked"}).snapshot)
      .toMatchObject({status: "revoked", paymentState: "revoked"});
    expect(normalizeGoogleSubscription({...base, override: "refunded"}).snapshot)
      .toMatchObject({status: "refunded", paymentState: "refunded"});
  });

  it("fails closed when product or account binding is absent", () => {
    expect(() => normalizeGoogleSubscription({
      purchase: {
        subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
        lineItems: [{
          productId: "cyclepair_plus",
          expiryTime: "2026-08-14T00:00:00.000Z",
          offerDetails: {basePlanId: "monthly"},
        }],
      },
      purchaseToken: "play-token",
      now,
    })).toThrowError(SubscriptionPolicyError);
    expect(() => normalizeGoogleSubscription({
      purchase: {
        subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
        externalAccountIdentifiers: {obfuscatedExternalAccountId: accountA},
        lineItems: [{
          productId: "not-allowed",
          offerDetails: {basePlanId: "monthly"},
        }],
      },
      purchaseToken: "play-token",
      now,
    })).toThrowError(SubscriptionPolicyError);
  });
});

describe("App Store normalization", () => {
  const transaction = {
    originalTransactionId: "apple-original-1",
    transactionId: "apple-transaction-1",
    bundleId: "com.seorilabs.cyclepair",
    productId: "com.seorilabs.cyclepair.plus.yearly",
    type: "Auto-Renewable Subscription",
    appAccountToken: accountA,
    expiresDate: Date.parse("2027-07-14T00:00:00.000Z"),
  } as const;

  it("uses signed transaction, renewal, and status as authoritative facts", () => {
    expect(normalizeAppleSubscription({
      transaction,
      renewal: {autoRenewStatus: 1, appAccountToken: accountA},
      status: 1,
      expectedTransactionId: "apple-transaction-1",
      expectedProductId: "com.seorilabs.cyclepair.plus.yearly",
      expectedBasePlanId: "yearly",
      now,
    }).snapshot).toMatchObject({
      status: "active",
      renewalState: "will-renew",
      paymentState: "paid",
      basePlanId: "yearly",
    });
    expect(normalizeAppleSubscription({
      transaction,
      renewal: {
        autoRenewStatus: 1,
        isInBillingRetryPeriod: true,
        appAccountToken: accountA,
        gracePeriodExpiresDate: Date.parse("2026-07-18T00:00:00.000Z"),
      },
      status: 4,
      now,
    }).snapshot).toMatchObject({
      status: "grace-period",
      gracePeriodExpiresAt: "2026-07-18T00:00:00.000Z",
    });
    expect(normalizeAppleSubscription({
      transaction,
      renewal: {autoRenewStatus: 0, appAccountToken: accountA},
      status: 5,
      notificationType: "REFUND",
      now,
    }).snapshot).toMatchObject({status: "refunded", paymentState: "refunded"});
  });

  it("rejects bundle, product, transaction, and account mismatches", () => {
    expect(() => normalizeAppleSubscription({
      transaction: {...transaction, bundleId: "com.example.other"},
      status: 1,
      now,
    })).toThrowError(SubscriptionPolicyError);
    expect(() => normalizeAppleSubscription({
      transaction,
      renewal: {appAccountToken: accountB},
      status: 1,
      now,
    })).toThrowError(SubscriptionPolicyError);
  });
});

describe("provider notification policy", () => {
  it("decodes RTDN without exposing or trusting embedded entitlement state", () => {
    const encoded = Buffer.from(JSON.stringify({
      version: "1.0",
      packageName: "com.seorilabs.cyclepair",
      eventTimeMillis: "1783987200000",
      subscriptionNotification: {
        version: "1.0",
        notificationType: 12,
        purchaseToken: "play-token",
      },
    })).toString("base64");
    expect(decodeGoogleDeveloperNotification(encoded)).toEqual({
      packageName: "com.seorilabs.cyclepair",
      eventTimeMillis: 1783987200000,
      kind: "subscription",
      purchaseToken: "play-token",
      notificationType: 12,
    });
  });

  it("applies only strictly newer provider events with a deterministic tie break", () => {
    const current: ProviderEventOrder = {occurredAtMillis: 20, eventId: "b"};
    expect(shouldApplyProviderEvent(current, {
      occurredAtMillis: 19,
      eventId: "z",
    })).toBe(false);
    expect(shouldApplyProviderEvent(current, {
      occurredAtMillis: 20,
      eventId: "a",
    })).toBe(false);
    expect(shouldApplyProviderEvent(current, {
      occurredAtMillis: 20,
      eventId: "c",
    })).toBe(true);
    expect(shouldApplyProviderEvent(current, {
      occurredAtMillis: 21,
      eventId: "a",
    })).toBe(true);
  });
});

class FakeRepository implements SubscriptionRepository {
  readonly tokens = new Map<string, string>();
  readonly bindings = new Map<string, PurchaseBinding>();

  async getOrCreateAccountToken(uid: string): Promise<string> {
    const existing = this.tokens.get(uid);
    if (existing !== undefined) {
      return existing;
    }
    const token = uid === "uid-a" ? accountA : accountB;
    this.tokens.set(uid, token);
    return token;
  }

  getAccountToken(uid: string): Promise<string | undefined> {
    return Promise.resolve(this.tokens.get(uid));
  }

  findPurchaseBinding(bindingId: string): Promise<PurchaseBinding | undefined> {
    return Promise.resolve(this.bindings.get(bindingId));
  }

  saveVerifiedPurchase(input: {
    readonly uid: string;
    readonly purchase: ProviderPurchase;
    readonly event?: ProviderEventOrder;
  }): Promise<SavedSubscription> {
    const bindingId = purchaseBindingId(
      input.purchase.provider,
      input.purchase.stablePurchaseId,
    );
    const existing = this.bindings.get(bindingId);
    if (existing !== undefined && existing.uid !== input.uid) {
      throw new SubscriptionPolicyError(
        "already-exists",
        "account-mismatch",
        "replay",
      );
    }
    if (this.tokens.get(input.uid) !== input.purchase.accountToken) {
      throw new SubscriptionPolicyError(
        "permission-denied",
        "account-mismatch",
        "binding mismatch",
      );
    }
    this.bindings.set(bindingId, {uid: input.uid, bindingId});
    return Promise.resolve({
      verificationId: bindingId,
      snapshot: input.purchase.snapshot,
      applied: true,
    });
  }

  listPurchaseBindingPaths(uid: string): Promise<readonly string[]> {
    return Promise.resolve([...this.bindings.values()]
      .filter(binding => binding.uid === uid)
      .map(binding => `purchaseTokens/${binding.bindingId}`));
  }
}

class FakeGoogleProvider implements GooglePlaySubscriptionProvider {
  constructor(private readonly purchase: ProviderPurchase) {}

  verifyPurchase(): Promise<ProviderPurchase> {
    return Promise.resolve(this.purchase);
  }
}

class FakeAppleProvider implements AppleAppStoreSubscriptionProvider {
  verifyPurchase(): Promise<ProviderPurchase> {
    throw new Error("unused");
  }

  verifyNotification(): Promise<AppleNotificationVerification> {
    throw new Error("unused");
  }
}

const request: VerifySubscriptionRequest = {
  provider: "google-play",
  productId: "cyclepair_plus",
  basePlanId: "monthly",
  transactionId: "order-1",
  purchaseToken: "play-token",
};

describe("subscription service account binding", () => {
  it("returns one stable account token for both stores", async () => {
    const repository = new FakeRepository();
    const service = new SubscriptionService(
      repository,
      new FakeGoogleProvider(googlePurchase()),
      new FakeAppleProvider(),
    );
    const first = await service.getPurchaseAccountToken("uid-a");
    const second = await service.getPurchaseAccountToken("uid-a");
    expect(second).toEqual(first);
    expect(first.appAccountToken).toBe(first.googleObfuscatedExternalAccountId);
  });

  it("fails closed on account mismatch and blocks cross-uid purchase replay", async () => {
    const repository = new FakeRepository();
    repository.tokens.set("uid-a", accountA);
    repository.tokens.set("uid-b", accountB);
    const serviceA = new SubscriptionService(
      repository,
      new FakeGoogleProvider(googlePurchase(accountA)),
      new FakeAppleProvider(),
    );
    await expect(serviceA.verifySubscriptionPurchase("uid-a", request))
      .resolves.toMatchObject({verified: true});

    const serviceB = new SubscriptionService(
      repository,
      new FakeGoogleProvider(googlePurchase(accountB)),
      new FakeAppleProvider(),
    );
    await expect(serviceB.verifySubscriptionPurchase("uid-b", request))
      .resolves.toEqual({verified: false, reason: "account-mismatch"});
  });

  it("does not let the client finish pending or unknown provider states", async () => {
    for (const state of [
      "SUBSCRIPTION_STATE_PENDING",
      "SUBSCRIPTION_STATE_UNSPECIFIED",
    ]) {
      const repository = new FakeRepository();
      repository.tokens.set("uid-a", accountA);
      const service = new SubscriptionService(
        repository,
        new FakeGoogleProvider(googlePurchase(accountA, state)),
        new FakeAppleProvider(),
      );
      await expect(service.verifySubscriptionPurchase("uid-a", request))
        .resolves.toEqual({verified: false, reason: "unknown"});
    }
  });
});
