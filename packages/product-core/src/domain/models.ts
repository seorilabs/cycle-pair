import type { LocalDate } from "./local-date.js";
import type { IsoTimestamp } from "./iso-timestamp.js";

export type MemberId = string;
export type PairId = string;
export type CycleId = string;
export type CycleLogId = string;

export interface Member {
  readonly id: MemberId;
  readonly displayName: string;
  readonly recordsCycles: boolean;
  readonly joinedOn: LocalDate;
}

export interface Pair {
  readonly id: PairId;
  readonly memberIds: readonly [MemberId, MemberId];
  readonly createdOn: LocalDate;
}

export interface Cycle {
  readonly id: CycleId;
  readonly memberId: MemberId;
  readonly startedOn: LocalDate;
  readonly endedOn?: LocalDate;
}

export type BleedingLevel = "spotting" | "light" | "medium" | "heavy";
export type Mood = "very-low" | "low" | "neutral" | "good" | "very-good";
export type EnergyLevel = 1 | 2 | 3 | 4 | 5;
export type ConditionCode =
  | "comfortable"
  | "tired"
  | "low-energy"
  | "cramps"
  | "headache"
  | "sensitive"
  | "needs-space"
  | "other";
export type HelpPreference =
  | "listen"
  | "quiet-space"
  | "warmth"
  | "meal-support"
  | "schedule-flexibility"
  | "practical-help"
  | "check-in"
  | "no-action";

export interface CycleLog {
  readonly id: CycleLogId;
  readonly memberId: MemberId;
  readonly date: LocalDate;
  readonly bleeding?: BleedingLevel;
  readonly symptoms?: readonly string[];
  readonly mood?: Mood;
  readonly energy?: EnergyLevel;
  readonly condition?: ConditionCode;
  readonly helpPreferences?: readonly HelpPreference[];
  readonly note?: string;
}

export type PredictionConfidence = "low" | "medium" | "high";

export interface Prediction {
  readonly memberId: MemberId;
  readonly generatedOn: LocalDate;
  readonly lastPeriodStart: LocalDate;
  readonly nextPeriodDate: LocalDate;
  readonly daysLate: number;
  readonly averageCycleLengthDays: number;
  readonly confidence: PredictionConfidence;
  readonly confidenceWindow: {
    readonly start: LocalDate;
    readonly end: LocalDate;
  };
  readonly sampleSize: number;
  readonly observedCycleLengths: readonly number[];
  readonly excludedIntervalCount: number;
}

export type CyclePhase = "menstrual" | "follicular" | "ovulatory" | "luteal" | "unknown";

export interface CyclePhaseResult {
  readonly phase: CyclePhase;
  readonly cycleDay: number | null;
  readonly estimated: boolean;
}

export type ShareableField =
  | "periodDates"
  | "cyclePhase"
  | "fertilityStatus"
  | "prediction"
  | "symptoms"
  | "mood"
  | "energy"
  | "condition"
  | "helpPreferences"
  | "note";

export interface ShareSettings {
  readonly memberId: MemberId;
  readonly fields: Readonly<Record<ShareableField, boolean>>;
  readonly updatedOn: LocalDate;
}

export interface PartnerPrediction {
  readonly nextPeriodDate: LocalDate;
  readonly confidence: PredictionConfidence;
  readonly confidenceWindow: {
    readonly start: LocalDate;
    readonly end: LocalDate;
  };
}

export interface PartnerProjection {
  readonly subjectMemberId: MemberId;
  readonly asOf: LocalDate;
  readonly periodDates?: {
    readonly start: LocalDate;
    readonly end?: LocalDate;
  };
  readonly cyclePhase?: CyclePhase;
  readonly prediction?: PartnerPrediction;
  readonly symptoms?: readonly string[];
  readonly mood?: Mood;
  readonly energy?: EnergyLevel;
  readonly condition?: ConditionCode;
  readonly helpPreferences?: readonly HelpPreference[];
  readonly note?: string;
}

export interface CareTip {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export interface CareTipMatch {
  readonly helpPreferences?: readonly HelpPreference[];
  readonly conditions?: readonly ConditionCode[];
  readonly phases?: readonly Exclude<CyclePhase, "unknown">[];
  readonly fallback?: boolean;
}

export interface CareTipRule {
  readonly tip: CareTip;
  readonly priority: number;
  readonly match: CareTipMatch;
}

export type EntitlementFeature =
  | "cycle-tracking"
  | "basic-prediction"
  | "one-partner-sharing"
  | "extended-history"
  | "advanced-prediction"
  | "full-care-tips"
  | "data-export"
  | "multiple-connections";

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

export type SubscriptionProvider = "google-play" | "app-store";

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
  /** Present on every newly server-verified snapshot. */
  readonly provider?: SubscriptionProvider;
  /** Exact App Store product ID or Google Play subscription product ID. */
  readonly productId?: string;
  /** Exact Google base plan ID or the app's normalized Apple plan ID. */
  readonly basePlanId?: string;
  readonly renewalState?: SubscriptionRenewalState;
  readonly paymentState?: SubscriptionPaymentState;
  /** Exact paid-through instant. This is authoritative for new snapshots. */
  readonly expiresAt?: IsoTimestamp;
  readonly gracePeriodExpiresAt?: IsoTimestamp;
  readonly verifiedAt?: IsoTimestamp;
}

export interface Entitlement {
  readonly tier: "free" | "premium";
  readonly features: readonly EntitlementFeature[];
  readonly reason:
    | "no-subscription"
    | "active-subscription"
    | "trial"
    | "grace-period"
    | "canceled-but-valid"
    | "pending-payment"
    | "account-hold"
    | "revoked"
    | "refunded"
    | "expired"
    | "invalid-subscription-state";
  readonly validUntil?: LocalDate;
}

export type LocalTime = `${number}${number}:${number}${number}`;

export interface NeutralNotificationScheduleItem {
  readonly recipientId: MemberId;
  readonly deliverOn: LocalDate;
  readonly localTime: LocalTime;
  readonly title: string;
  readonly body: string;
  readonly destination: "home";
  readonly visibility: "private";
}
