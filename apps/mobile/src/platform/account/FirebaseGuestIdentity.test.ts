import { isFirebaseGuestUser } from './FirebaseGuestIdentity';

describe('isFirebaseGuestUser', () => {
  it('recognizes Firebase native and platform-issued guests', () => {
    expect(
      isFirebaseGuestUser({
        uid: 'legacy-anonymous',
        email: null,
        isAnonymous: true,
      }),
    ).toBe(true);
    expect(
      isFirebaseGuestUser({
        uid: 'pb_01K1J9ZVJ7AJ0DQRMA4RYB4R7P',
        email: null,
        isAnonymous: false,
      }),
    ).toBe(true);
  });

  it('treats the same pb_ user as durable after email linking', () => {
    expect(
      isFirebaseGuestUser({
        uid: 'pb_01K1J9ZVJ7AJ0DQRMA4RYB4R7P',
        email: 'user@example.com',
        isAnonymous: false,
      }),
    ).toBe(false);
  });
});
