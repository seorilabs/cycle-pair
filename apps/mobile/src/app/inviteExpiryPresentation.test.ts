import {
  buildInviteExpiryPresentation,
  formatInviteRemaining,
} from './inviteExpiryPresentation';

describe('invite expiry presentation', () => {
  it('marks an invite expired at the exact server expiry instant', () => {
    expect(
      buildInviteExpiryPresentation(
        '2026-07-15T00:00:00.000Z',
        Date.parse('2026-07-15T00:00:00.000Z'),
      ),
    ).toMatchObject({ expired: true, remainingLabel: '만료됨' });
  });

  it('treats an invalid server timestamp as expired', () => {
    expect(
      buildInviteExpiryPresentation('not-a-date', Date.now()),
    ).toMatchObject({ expired: true, remainingLabel: '만료됨' });
  });

  it('rounds a live invite up to the next minute', () => {
    expect(formatInviteRemaining(3_661_000)).toBe('1시간 2분 남음');
  });
});
