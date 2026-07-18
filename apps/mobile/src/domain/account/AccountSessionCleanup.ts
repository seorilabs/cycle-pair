export interface AccountDeletionPreparationResult {
  /**
   * Safe to continue: deleteMyAccount recursively removes every server token
   * document even if the pre-delete unregister callable was unavailable.
   */
  readonly notificationUnregisterFailed: boolean;
}

export interface AccountSessionCleanup {
  /** Fail closed so Auth sign-out never races ahead of FCM unregister. */
  prepareForLogout(uid: string, recoverable: boolean): Promise<void>;
  /** Commit the cleanup after native Auth sign-out succeeds. */
  completeLogout(uid: string): void;
  /** Roll back only a logout that failed before Auth sign-out completed. */
  recoverFromFailedLogout(uid: string): Promise<void>;
  /**
   * Reset local opt-ins first, then best-effort unregister. Server account
   * deletion remains the authoritative fallback for notification documents.
   */
  prepareForAccountDeletion(
    uid: string,
  ): Promise<AccountDeletionPreparationResult>;
}
