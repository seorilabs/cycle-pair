import {
  DocumentData,
  Firestore,
  Timestamp,
} from "firebase-admin/firestore";

import {
  GoogleNotification,
  ProviderEventOrder,
  ProviderPurchase,
  PurchaseVerificationFailureReason,
  SUBSCRIPTION_SCHEMA_VERSION,
  SubscriptionPolicyError,
  SubscriptionSnapshot,
  VerifySubscriptionRequest,
  decodeGoogleDeveloperNotification,
  googleNotificationOverride,
  isUuid,
  newPurchaseAccountToken,
  purchaseBindingId,
  shouldApplyProviderEvent,
} from "../domain/subscription.js";
import {
  AppleAppStoreSubscriptionProvider,
  GooglePlaySubscriptionProvider,
} from "../providers/subscriptionProviders.js";

export interface PurchaseAccountTokenResponse {
  readonly schemaVersion: typeof SUBSCRIPTION_SCHEMA_VERSION;
  readonly appAccountToken: string;
  readonly googleObfuscatedExternalAccountId: string;
}

export type VerifySubscriptionResponse =
  | {
      readonly verified: true;
      readonly verificationId: string;
      readonly subscription: SubscriptionSnapshot;
    }
  | {
      readonly verified: false;
      readonly reason: PurchaseVerificationFailureReason;
    };

export interface SavedSubscription {
  readonly verificationId: string;
  readonly snapshot: SubscriptionSnapshot;
  readonly applied: boolean;
}

export interface PurchaseBinding {
  readonly uid: string;
  readonly bindingId: string;
}

export interface SubscriptionRepository {
  getOrCreateAccountToken(uid: string): Promise<string>;
  getAccountToken(uid: string): Promise<string | undefined>;
  findPurchaseBinding(bindingId: string): Promise<PurchaseBinding | undefined>;
  saveVerifiedPurchase(input: {
    readonly uid: string;
    readonly purchase: ProviderPurchase;
    readonly event?: ProviderEventOrder;
  }): Promise<SavedSubscription>;
  listPurchaseBindingPaths(uid: string): Promise<readonly string[]>;
}

interface SubscriptionDocument extends DocumentData {
  readonly providerEventAt?: Timestamp;
  readonly providerEventId?: string;
}

function subscriptionPolicyError(
  error: unknown,
): SubscriptionPolicyError | undefined {
  return error instanceof SubscriptionPolicyError ? error : undefined;
}

export class FirestoreSubscriptionRepository implements SubscriptionRepository {
  constructor(
    private readonly db: Firestore,
    private readonly accountTokenFactory: () => string = newPurchaseAccountToken,
  ) {}

  async getOrCreateAccountToken(uid: string): Promise<string> {
    const stateRef = this.db.doc(`purchaseStates/${uid}`);
    const deletionStateRef = this.db.doc(`accountDeletionStates/${uid}`);
    return this.db.runTransaction(async transaction => {
      const [state, deletionState] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(deletionStateRef),
      ]);
      if (deletionState.exists) {
        throw new SubscriptionPolicyError(
          "failed-precondition",
          "account-mismatch",
          "계정 삭제가 진행 중입니다.",
        );
      }
      const existing = state.data()?.accountToken;
      if (typeof existing === "string") {
        if (!isUuid(existing)) {
          throw new SubscriptionPolicyError(
            "failed-precondition",
            "account-mismatch",
            "구매 계정 상태가 손상되었습니다.",
          );
        }
        return existing;
      }
      const accountToken = this.accountTokenFactory();
      if (!isUuid(accountToken)) {
        throw new Error("purchase account token factory returned an invalid UUID");
      }
      const now = Timestamp.now();
      transaction.set(stateRef, {
        schemaVersion: SUBSCRIPTION_SCHEMA_VERSION,
        accountToken,
        createdAt: now,
        updatedAt: now,
      });
      return accountToken;
    });
  }

  async getAccountToken(uid: string): Promise<string | undefined> {
    const snapshot = await this.db.doc(`purchaseStates/${uid}`).get();
    const accountToken = snapshot.data()?.accountToken;
    return typeof accountToken === "string" && isUuid(accountToken)
      ? accountToken
      : undefined;
  }

  async findPurchaseBinding(
    bindingId: string,
  ): Promise<PurchaseBinding | undefined> {
    const snapshot = await this.db.doc(`purchaseTokens/${bindingId}`).get();
    const uid = snapshot.data()?.uid;
    return typeof uid === "string" && uid.length > 0
      ? {uid, bindingId}
      : undefined;
  }

  async saveVerifiedPurchase(input: {
    readonly uid: string;
    readonly purchase: ProviderPurchase;
    readonly event?: ProviderEventOrder;
  }): Promise<SavedSubscription> {
    const bindingId = purchaseBindingId(
      input.purchase.provider,
      input.purchase.stablePurchaseId,
    );
    const bindingRef = this.db.doc(`purchaseTokens/${bindingId}`);
    const stateRef = this.db.doc(`purchaseStates/${input.uid}`);
    const subscriptionRef = this.db.doc(`subscriptions/${input.uid}`);
    const deletionStateRef = this.db.doc(`accountDeletionStates/${input.uid}`);
    return this.db.runTransaction(async transaction => {
      const [binding, state, subscription, deletionState] = await Promise.all([
        transaction.get(bindingRef),
        transaction.get(stateRef),
        transaction.get(subscriptionRef),
        transaction.get(deletionStateRef),
      ]);
      if (deletionState.exists) {
        throw new SubscriptionPolicyError(
          "failed-precondition",
          "account-mismatch",
          "계정 삭제가 진행 중입니다.",
        );
      }
      const stateAccountToken = state.data()?.accountToken;
      if (
        typeof stateAccountToken !== "string" ||
        stateAccountToken !== input.purchase.accountToken
      ) {
        throw new SubscriptionPolicyError(
          "permission-denied",
          "account-mismatch",
          "구매가 현재 계정에 연결되지 않았습니다.",
        );
      }
      const existingUid = binding.data()?.uid;
      if (typeof existingUid === "string" && existingUid !== input.uid) {
        throw new SubscriptionPolicyError(
          "already-exists",
          "account-mismatch",
          "이 구매는 다른 계정에 이미 연결되어 있습니다.",
        );
      }
      const currentData = subscription.data() as
        | SubscriptionDocument
        | undefined;
      const currentOrder = currentData?.providerEventAt instanceof Timestamp &&
        typeof currentData.providerEventId === "string"
        ? {
            occurredAtMillis: currentData.providerEventAt.toMillis(),
            eventId: currentData.providerEventId,
          }
        : undefined;
      if (
        input.event !== undefined &&
        !shouldApplyProviderEvent(currentOrder, input.event)
      ) {
        return {
          verificationId: bindingId,
          snapshot: input.purchase.snapshot,
          applied: false,
        };
      }
      const now = Timestamp.now();
      const persistedEvent = input.event ?? {
        occurredAtMillis: now.toMillis(),
        eventId: `direct:${bindingId}`,
      };
      transaction.set(bindingRef, {
        schemaVersion: SUBSCRIPTION_SCHEMA_VERSION,
        uid: input.uid,
        provider: input.purchase.provider,
        productId: input.purchase.snapshot.productId,
        basePlanId: input.purchase.snapshot.basePlanId,
        createdAt: binding.data()?.createdAt ?? now,
        updatedAt: now,
      });
      transaction.set(subscriptionRef, {
        schemaVersion: SUBSCRIPTION_SCHEMA_VERSION,
        ...input.purchase.snapshot,
        verificationId: bindingId,
        providerEventAt: Timestamp.fromMillis(
          persistedEvent.occurredAtMillis,
        ),
        providerEventId: persistedEvent.eventId,
        updatedAt: now,
      });
      transaction.set(stateRef, {
        schemaVersion: SUBSCRIPTION_SCHEMA_VERSION,
        accountToken: stateAccountToken,
        lastVerificationId: bindingId,
        updatedAt: now,
      }, {merge: true});
      return {
        verificationId: bindingId,
        snapshot: input.purchase.snapshot,
        applied: true,
      };
    });
  }

  async listPurchaseBindingPaths(uid: string): Promise<readonly string[]> {
    const snapshot = await this.db
      .collection("purchaseTokens")
      .where("uid", "==", uid)
      .limit(101)
      .get();
    if (snapshot.size > 100) {
      throw new SubscriptionPolicyError(
        "failed-precondition",
        "unknown",
        "구매 연결 수가 안전한 계정 삭제 한도를 초과했습니다.",
      );
    }
    return snapshot.docs.map(document => document.ref.path);
  }
}

export class SubscriptionService {
  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly googlePlay: GooglePlaySubscriptionProvider,
    private readonly appStore: AppleAppStoreSubscriptionProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getPurchaseAccountToken(
    uid: string,
  ): Promise<PurchaseAccountTokenResponse> {
    const accountToken = await this.repository.getOrCreateAccountToken(uid);
    return {
      schemaVersion: SUBSCRIPTION_SCHEMA_VERSION,
      appAccountToken: accountToken,
      googleObfuscatedExternalAccountId: accountToken,
    };
  }

  async verifySubscriptionPurchase(
    uid: string,
    request: VerifySubscriptionRequest,
  ): Promise<VerifySubscriptionResponse> {
    try {
      const expectedAccountToken = await this.repository.getAccountToken(uid);
      if (expectedAccountToken === undefined) {
        throw new SubscriptionPolicyError(
          "failed-precondition",
          "account-mismatch",
          "구매 계정 토큰을 먼저 발급해야 합니다.",
        );
      }
      const now = this.now().toISOString();
      const purchase = request.provider === "google-play"
        ? await this.googlePlay.verifyPurchase({
            purchaseToken: request.purchaseToken,
            expectedProductId: request.productId,
            expectedBasePlanId: request.basePlanId,
            now,
          })
        : await this.appStore.verifyPurchase(request, now);
      if (purchase.accountToken !== expectedAccountToken) {
        throw new SubscriptionPolicyError(
          "permission-denied",
          "account-mismatch",
          "구매가 현재 계정에 연결되지 않았습니다.",
        );
      }
      const saved = await this.repository.saveVerifiedPurchase({uid, purchase});
      if (
        saved.snapshot.status === "revoked" ||
        saved.snapshot.status === "refunded"
      ) {
        return {verified: false, reason: "revoked"};
      }
      if (
        saved.snapshot.status === "pending" ||
        saved.snapshot.status === "unknown"
      ) {
        return {verified: false, reason: "unknown"};
      }
      return {
        verified: true,
        verificationId: saved.verificationId,
        subscription: saved.snapshot,
      };
    } catch (error) {
      return {
        verified: false,
        reason: subscriptionPolicyError(error)?.reason ?? "unknown",
      };
    }
  }

  async processGoogleNotification(
    encodedData: string,
    messageId: string,
  ): Promise<"applied" | "ignored"> {
    const notification = decodeGoogleDeveloperNotification(encodedData);
    if (notification.kind === "test") {
      return "ignored";
    }
    const purchaseToken = requireGoogleNotificationToken(notification);
    const bindingId = purchaseBindingId("google-play", purchaseToken);
    const binding = await this.repository.findPurchaseBinding(bindingId);
    if (binding === undefined) {
      return "ignored";
    }
    const override = googleNotificationOverride(notification);
    const purchase = await this.googlePlay.verifyPurchase({
      purchaseToken,
      now: this.now().toISOString(),
      ...(override === undefined ? {} : {override}),
    });
    const saved = await this.repository.saveVerifiedPurchase({
      uid: binding.uid,
      purchase,
      event: {
        occurredAtMillis: notification.eventTimeMillis,
        eventId: `google:${messageId}`,
      },
    });
    return saved.applied ? "applied" : "ignored";
  }

  async processAppleNotification(
    signedPayload: string,
  ): Promise<"applied" | "ignored"> {
    const verified = await this.appStore.verifyNotification(
      signedPayload,
      this.now().toISOString(),
    );
    if (verified.kind === "ignored") {
      return "ignored";
    }
    const bindingId = purchaseBindingId(
      "app-store",
      verified.purchase.stablePurchaseId,
    );
    const binding = await this.repository.findPurchaseBinding(bindingId);
    if (binding === undefined) {
      return "ignored";
    }
    const saved = await this.repository.saveVerifiedPurchase({
      uid: binding.uid,
      purchase: verified.purchase,
      event: {
        occurredAtMillis: verified.occurredAtMillis,
        eventId: `apple:${verified.eventId}`,
      },
    });
    return saved.applied ? "applied" : "ignored";
  }
}

function requireGoogleNotificationToken(notification: GoogleNotification): string {
  if (notification.purchaseToken === undefined) {
    throw new SubscriptionPolicyError(
      "invalid-argument",
      "invalid",
      "Play 알림에 구매 토큰이 없습니다.",
    );
  }
  return notification.purchaseToken;
}
