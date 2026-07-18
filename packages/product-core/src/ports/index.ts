import type { LocalDate } from "../domain/local-date.js";
import type { IsoTimestamp } from "../domain/iso-timestamp.js";
import type {
  CareTipRule,
  Cycle,
  CycleLog,
  Entitlement,
  Member,
  MemberId,
  NeutralNotificationScheduleItem,
  Pair,
  PairId,
  ShareSettings,
  SubscriptionSnapshot,
  SubscriptionProvider,
} from "../domain/models.js";

export interface ClockPort {
  today(): LocalDate;
}

export interface IdGeneratorPort {
  nextId(): string;
}

export interface AuthPort {
  currentMemberId(): Promise<MemberId | null>;
  getMember(memberId: MemberId): Promise<Member | null>;
}

export interface PairRepositoryPort {
  getById(pairId: PairId): Promise<Pair | null>;
  findByMemberId(memberId: MemberId): Promise<readonly Pair[]>;
  save(pair: Pair): Promise<void>;
  delete(pairId: PairId): Promise<void>;
}

export interface CycleRepositoryPort {
  listCycles(memberId: MemberId): Promise<readonly Cycle[]>;
  saveCycle(cycle: Cycle): Promise<void>;
  listLogs(memberId: MemberId, from: LocalDate, to: LocalDate): Promise<readonly CycleLog[]>;
  saveLog(log: CycleLog): Promise<void>;
}

export interface ShareSettingsRepositoryPort {
  get(memberId: MemberId): Promise<ShareSettings | null>;
  save(settings: ShareSettings): Promise<void>;
}

export interface CareTipRepositoryPort {
  getCatalog(): Promise<readonly CareTipRule[]>;
}

export type SubscriptionPlanInterval = "P1M" | "P1Y";

export interface SubscriptionProduct {
  readonly provider: SubscriptionProvider;
  readonly productId: string;
  readonly basePlanId: string;
  readonly title: string;
  readonly description: string;
  readonly displayPrice: string;
  readonly currencyCode: string;
  readonly billingPeriod: SubscriptionPlanInterval;
  /** Required by Google Play when selecting a base plan or offer. */
  readonly offerToken?: string;
}

export type StorePurchaseState = "pending" | "purchased" | "unknown";

/** Store evidence sent to the server. It never grants a client entitlement by itself. */
export interface StorePurchase {
  readonly provider: SubscriptionProvider;
  readonly productId: string;
  readonly basePlanId?: string;
  readonly transactionId: string;
  readonly purchaseToken?: string;
  readonly purchasedAt: IsoTimestamp;
  readonly state: StorePurchaseState;
}

export interface SubscriptionPurchaseRequest {
  readonly memberId: MemberId;
  readonly productId: string;
  readonly basePlanId: string;
  readonly offerToken?: string;
  /** UUID on Apple and an obfuscated stable account ID on Google. */
  readonly appAccountToken?: string;
}

export interface VerifiedPurchase {
  readonly verificationId: string;
  readonly purchase: StorePurchase;
  /** Authoritative snapshot written and returned by the verification server. */
  readonly subscription: SubscriptionSnapshot;
}

export type PurchaseVerificationFailureReason =
  | "pending"
  | "invalid"
  | "product-mismatch"
  | "account-mismatch"
  | "revoked"
  | "unknown";

export type PurchaseVerificationResult =
  | {
      readonly verified: true;
      readonly verifiedPurchase: VerifiedPurchase;
    }
  | {
      readonly verified: false;
      readonly purchase: StorePurchase;
      readonly reason: PurchaseVerificationFailureReason;
    };

/**
 * Client purchase workflow. Store callbacks are only evidence; `serverVerify` must
 * succeed before callers unlock features or pass the result to `finish`.
 */
export interface PurchasePort {
  getProducts(): Promise<readonly SubscriptionProduct[]>;
  getSubscription(memberId: MemberId): Promise<SubscriptionSnapshot>;
  purchase(request: SubscriptionPurchaseRequest): Promise<void>;
  restore(memberId: MemberId): Promise<readonly PurchaseVerificationResult[]>;
  serverVerify(
    memberId: MemberId,
    purchase: StorePurchase,
  ): Promise<PurchaseVerificationResult>;
  /** The verified capability type prevents finishing unverified store evidence. */
  finish(purchase: VerifiedPurchase): Promise<void>;
  openManageSubscriptions(
    provider: SubscriptionProvider,
    productId?: string,
  ): Promise<void>;
}

/** Client-safe, read-only access. Clients must never write computed entitlements. */
export interface EntitlementRepositoryPort {
  get(memberId: MemberId): Promise<Entitlement | null>;
}

/** Server-only persistence after provider receipt verification. */
export interface ServerEntitlementRepositoryPort extends EntitlementRepositoryPort {
  saveVerified(
    memberId: MemberId,
    entitlement: Entitlement,
    verificationId: string,
  ): Promise<void>;
}

export interface NotificationPort {
  replaceSchedule(
    recipientId: MemberId,
    schedule: readonly NeutralNotificationScheduleItem[],
  ): Promise<void>;
  cancelAll(recipientId: MemberId): Promise<void>;
}
