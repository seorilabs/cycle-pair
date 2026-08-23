export const PARTNER_NUDGE_SCHEMA_VERSION = 1;
export const PARTNER_NUDGE_COOLDOWN_MS = 30 * 60 * 1_000;

export type PartnerNudgeType =
  | "check-in-request"
  | "care-acknowledgement";

export interface PartnerNudgeCooldownState {
  readonly requestId?: string;
  readonly nextAllowedAtMillis?: number;
}

export type PartnerNudgeCooldownDecision =
  | {readonly kind: "allowed"; readonly nextAllowedAtMillis: number}
  | {readonly kind: "idempotent"; readonly nextAllowedAtMillis: number}
  | {readonly kind: "blocked"; readonly nextAllowedAtMillis: number};

export function parsePartnerNudgeType(value: unknown): PartnerNudgeType {
  if (value === "check-in-request" || value === "care-acknowledgement") {
    return value;
  }
  throw new TypeError("넛지 종류가 올바르지 않습니다.");
}

export function partnerNudgeCooldownFields(type: PartnerNudgeType): {
  readonly requestId: string;
  readonly sentAt: string;
  readonly nextAllowedAt: string;
} {
  return type === "check-in-request"
    ? {
      requestId: "checkInRequestId",
      sentAt: "checkInSentAt",
      nextAllowedAt: "checkInNextAllowedAt",
    }
    : {
      requestId: "careAcknowledgementRequestId",
      sentAt: "careAcknowledgementSentAt",
      nextAllowedAt: "careAcknowledgementNextAllowedAt",
    };
}

export function evaluatePartnerNudgeCooldown(
  state: PartnerNudgeCooldownState,
  requestId: string,
  nowMillis: number,
): PartnerNudgeCooldownDecision {
  if (!Number.isSafeInteger(nowMillis) || nowMillis < 0) {
    throw new RangeError("현재 시간이 올바르지 않습니다.");
  }
  if (state.requestId === requestId) {
    return {
      kind: "idempotent",
      nextAllowedAtMillis:
        state.nextAllowedAtMillis ?? nowMillis + PARTNER_NUDGE_COOLDOWN_MS,
    };
  }
  if (
    state.nextAllowedAtMillis !== undefined &&
    state.nextAllowedAtMillis > nowMillis
  ) {
    return {kind: "blocked", nextAllowedAtMillis: state.nextAllowedAtMillis};
  }
  return {
    kind: "allowed",
    nextAllowedAtMillis: nowMillis + PARTNER_NUDGE_COOLDOWN_MS,
  };
}
