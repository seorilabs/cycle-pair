interface FirebaseUserIdentity {
  readonly uid: string;
  readonly email: string | null;
  readonly isAnonymous: boolean;
}

const PLATFORM_GUEST_UID_PATTERN = /^pb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * Firebase Custom Token users report isAnonymous=false. The platform-owned
 * pb_ UID remains a guest until an email credential is linked to that user.
 */
export function isFirebaseGuestUser(user: FirebaseUserIdentity): boolean {
  return (
    user.email === null &&
    (user.isAnonymous || PLATFORM_GUEST_UID_PATTERN.test(user.uid))
  );
}
