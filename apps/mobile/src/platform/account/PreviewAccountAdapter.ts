import type {
  AccountErrorListener,
  AccountPort,
  AccountSession,
  AccountSessionListener,
} from '../../domain/account/AccountPort';
import { AccountOperationError } from '../../domain/account/AccountPort';

const PREVIEW_UID = 'preview-user';
const listeners = new Set<AccountSessionListener>();
let session: AccountSession | null = null;
let deletionCompleted = false;
const PREVIEW_DELETION_RECEIPT = 'p'.repeat(43);

function emit() {
  for (const listener of listeners) listener(session);
}

function anonymousSession(): AccountSession {
  return {
    uid: PREVIEW_UID,
    email: null,
    isAnonymous: true,
    emailVerified: false,
  };
}

export const previewAccountAdapter: AccountPort = {
  currentSession() {
    return session;
  },

  async initialize() {
    session ??= anonymousSession();
    emit();
    return session;
  },

  async startGuest() {
    session = anonymousSession();
    emit();
    return session;
  },

  subscribe(onSession: AccountSessionListener, _onError: AccountErrorListener) {
    listeners.add(onSession);
    onSession(session);
    return () => listeners.delete(onSession);
  },

  async upgradeAnonymous(email) {
    if (!session?.isAnonymous) {
      throw new AccountOperationError('account/not-anonymous');
    }
    session = {
      uid: PREVIEW_UID,
      email,
      isAnonymous: false,
      emailVerified: false,
    };
    emit();
    return session;
  },

  async sendVerificationEmail() {},

  async reloadSession() {
    if (!session) throw new AccountOperationError('account/no-current-user');
    session = { ...session, emailVerified: !session.isAnonymous };
    emit();
    return session;
  },

  async signIn(email) {
    session = {
      uid: PREVIEW_UID,
      email,
      isAnonymous: false,
      emailVerified: true,
    };
    emit();
    return session;
  },

  async sendPasswordResetEmail() {},

  async reauthenticateWithPassword() {
    if (!session || session.isAnonymous) {
      throw new AccountOperationError('account/email-account-required');
    }
  },

  async requestDataExport() {
    if (!session) throw new AccountOperationError('account/no-current-user');
    const now = new Date();
    return {
      schemaVersion: 1 as const,
      exportSubjectUid: session.uid,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1_000).toISOString(),
      filename: `cycle-pair-data-export-${now.toISOString().slice(0, 10)}.json`,
      singleUse: true as const,
      downloadUrl:
        'https://example.invalid/cycle-pair-preview-export#token=' +
        'p'.repeat(43),
    };
  },

  async beginAccountDeletion() {
    if (!session) throw new AccountOperationError('account/no-current-user');
    deletionCompleted = false;
    return {
      schemaVersion: 1,
      deletionSubjectUid: session.uid,
      recoveryReceipt: PREVIEW_DELETION_RECEIPT,
    };
  },

  async getAccountDeletionStatus(_uid, recoveryReceipt) {
    if (recoveryReceipt !== PREVIEW_DELETION_RECEIPT) {
      throw new AccountOperationError('account/invalid-deletion-response');
    }
    return deletionCompleted
      ? {
          schemaVersion: 1 as const,
          status: 'completed' as const,
          completedAt: new Date().toISOString(),
        }
      : { schemaVersion: 1 as const, status: 'prepared' as const };
  },

  async deleteMyAccount(recoveryReceipt) {
    if (!session) throw new AccountOperationError('account/no-current-user');
    if (recoveryReceipt !== PREVIEW_DELETION_RECEIPT) {
      throw new AccountOperationError('account/invalid-deletion-response');
    }
    deletionCompleted = true;
    return {
      schemaVersion: 1,
      deleted: true,
      completedAt: new Date().toISOString(),
    };
  },

  async purgeLocalPrivateData() {},

  async signOut() {
    session = null;
    emit();
  },
};
