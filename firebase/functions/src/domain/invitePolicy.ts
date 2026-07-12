export const INVITE_TTL_MS = 24 * 60 * 60 * 1_000;
export const INVITE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;
export const INVITE_RATE_LIMIT_MAX = 5;

export interface InviteRateState {
  readonly windowStartedAtMillis: number | null;
  readonly count: number;
}

export interface InviteRateDecision {
  readonly allowed: boolean;
  readonly nextState: InviteRateState;
  readonly retryAfterMillis: number;
}

export function evaluateInviteRateLimit(
  state: InviteRateState,
  nowMillis: number,
): InviteRateDecision {
  const windowExpired =
    state.windowStartedAtMillis === null ||
    nowMillis - state.windowStartedAtMillis >= INVITE_RATE_LIMIT_WINDOW_MS ||
    nowMillis < state.windowStartedAtMillis;

  if (windowExpired) {
    return {
      allowed: true,
      nextState: {windowStartedAtMillis: nowMillis, count: 1},
      retryAfterMillis: 0,
    };
  }

  if (state.count < INVITE_RATE_LIMIT_MAX) {
    return {
      allowed: true,
      nextState: {
        windowStartedAtMillis: state.windowStartedAtMillis,
        count: state.count + 1,
      },
      retryAfterMillis: 0,
    };
  }

  return {
    allowed: false,
    nextState: state,
    retryAfterMillis: Math.max(
      0,
      state.windowStartedAtMillis + INVITE_RATE_LIMIT_WINDOW_MS - nowMillis,
    ),
  };
}

export interface InviteUsabilityInput {
  readonly status: unknown;
  readonly inviterUid: unknown;
  readonly inviteEpoch: unknown;
  readonly expiresAtMillis: number | null;
}

export function inviteIsUsable(
  invite: InviteUsabilityInput,
  expectedEpoch: number,
  acceptingUid: string,
  nowMillis: number,
): boolean {
  return (
    invite.status === "pending" &&
    typeof invite.inviterUid === "string" &&
    invite.inviterUid !== acceptingUid &&
    invite.inviteEpoch === expectedEpoch &&
    invite.expiresAtMillis !== null &&
    invite.expiresAtMillis > nowMillis
  );
}
