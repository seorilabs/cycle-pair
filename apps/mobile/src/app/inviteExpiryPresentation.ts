export interface InviteExpiryPresentation {
  readonly expired: boolean;
  readonly expiresAtMillis: number;
  readonly remainingLabel: string;
}

export function formatInviteRemaining(milliseconds: number): string {
  if (milliseconds <= 0) return '만료됨';
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}분 남음`;
  if (minutes === 0) return `${hours}시간 남음`;
  return `${hours}시간 ${minutes}분 남음`;
}

export function buildInviteExpiryPresentation(
  expiresAt: string,
  nowMillis: number,
): InviteExpiryPresentation {
  const expiresAtMillis = Date.parse(expiresAt);
  const expired =
    Number.isNaN(expiresAtMillis) || expiresAtMillis <= nowMillis;
  return {
    expired,
    expiresAtMillis,
    remainingLabel: expired
      ? '만료됨'
      : formatInviteRemaining(expiresAtMillis - nowMillis),
  };
}
