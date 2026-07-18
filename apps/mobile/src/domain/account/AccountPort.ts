export interface AccountSession {
  readonly uid: string;
  readonly email: string | null;
  readonly isAnonymous: boolean;
  readonly emailVerified: boolean;
}

export type AccountSessionListener = (session: AccountSession | null) => void;
export type AccountErrorListener = (error: unknown) => void;
export type AccountUnsubscribe = () => void;

export interface AccountExportDownloadTicket {
  readonly schemaVersion: 1;
  readonly exportSubjectUid: string;
  readonly expiresAt: string;
  readonly filename: string;
  readonly singleUse: true;
  /**
   * HTTPS bootstrap URL. The bearer token is in the fragment so it is not sent
   * in the request URL or Referer; the server page consumes it via a same-origin
   * Authorization POST before generating the JSON in memory.
   */
  readonly downloadUrl: string;
}

export interface AccountDeletionResult {
  readonly schemaVersion: 1;
  readonly deleted: true;
  readonly completedAt: string;
}

export interface AccountDeletionPreparation {
  readonly schemaVersion: 1;
  readonly deletionSubjectUid: string;
  readonly recoveryReceipt: string;
}

export type AccountDeletionStatus =
  | {
      readonly schemaVersion: 1;
      readonly status: 'prepared' | 'pending';
    }
  | {
      readonly schemaVersion: 1;
      readonly status: 'completed';
      readonly completedAt: string;
    };

/**
 * Account boundary for the native mobile target.
 *
 * Passwords are transient method arguments only. Implementations must delegate
 * credential persistence to the platform authentication SDK and must never
 * write credentials to AsyncStorage or application logs.
 */
export interface AccountPort {
  /** Returns the persisted native Auth identity without creating a guest. */
  currentSession(): AccountSession | null;
  initialize(): Promise<AccountSession>;
  startGuest(): Promise<AccountSession>;
  subscribe(
    onSession: AccountSessionListener,
    onError: AccountErrorListener,
  ): AccountUnsubscribe;
  upgradeAnonymous(email: string, password: string): Promise<AccountSession>;
  sendVerificationEmail(): Promise<void>;
  reloadSession(): Promise<AccountSession>;
  signIn(email: string, password: string): Promise<AccountSession>;
  sendPasswordResetEmail(email: string): Promise<void>;
  reauthenticateWithPassword(password: string): Promise<void>;
  requestDataExport(): Promise<AccountExportDownloadTicket>;
  beginAccountDeletion(): Promise<AccountDeletionPreparation>;
  getAccountDeletionStatus(
    uid: string,
    recoveryReceipt: string,
  ): Promise<AccountDeletionStatus>;
  deleteMyAccount(recoveryReceipt: string): Promise<AccountDeletionResult>;
  purgeLocalPrivateData(uid: string): Promise<void>;
  signOut(): Promise<void>;
}

export class AccountOperationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'AccountOperationError';
    this.code = code;
  }
}
