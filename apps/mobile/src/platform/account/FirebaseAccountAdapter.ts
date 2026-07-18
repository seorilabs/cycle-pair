import { getApp } from '@react-native-firebase/app';
import {
  EmailAuthProvider,
  getAuth,
  getIdToken,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from '@react-native-firebase/auth';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import {
  AccountOperationError,
  type AccountExportDownloadTicket,
  type AccountDeletionPreparation,
  type AccountDeletionResult,
  type AccountDeletionStatus,
  type AccountPort,
  type AccountSession,
} from '../../domain/account/AccountPort';
import {localPrivateDataCleaner} from '../local/LocalPrivateDataCleaner';

const FUNCTIONS_REGION = 'asia-northeast3';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function callAccountFunction<Request, Response>(
  name:
    | 'requestAccountDataExport'
    | 'beginAccountDeletion'
    | 'getAccountDeletionStatus'
    | 'deleteMyAccount',
  data: Request,
): Promise<Response> {
  const result = await httpsCallable<Request, Response>(
    getFunctions(getApp(), FUNCTIONS_REGION),
    name,
  )(data);
  return result.data;
}

function parseDataExportTicket(
  value: unknown,
  expectedUid: string,
): AccountExportDownloadTicket {
  const data = asRecord(value);
  const expiresAt = typeof data?.expiresAt === 'string'
    ? Date.parse(data.expiresAt)
    : Number.NaN;
  const downloadUrl = typeof data?.downloadUrl === 'string'
    ? data.downloadUrl
    : '';
  let validDownloadUrl = false;
  try {
    const url = new URL(downloadUrl);
    validDownloadUrl =
      url.protocol === 'https:' &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      /^#token=[A-Za-z0-9_-]{43}$/.test(url.hash);
  } catch {
    validDownloadUrl = false;
  }
  if (
    data?.schemaVersion !== 1 ||
    data.exportSubjectUid !== expectedUid ||
    !Number.isFinite(expiresAt) ||
    new Date(expiresAt).toISOString() !== data.expiresAt ||
    typeof data.filename !== 'string' ||
    !/^cycle-pair-data-export-\d{4}-\d{2}-\d{2}\.json$/.test(data.filename) ||
    data.singleUse !== true ||
    !validDownloadUrl
  ) {
    throw new AccountOperationError('account/invalid-export-response');
  }
  return value as AccountExportDownloadTicket;
}

function parseDeletionResult(value: unknown): AccountDeletionResult {
  const data = asRecord(value);
  if (
    data?.schemaVersion !== 1 ||
    data.deleted !== true ||
    typeof data.completedAt !== 'string'
  ) {
    throw new AccountOperationError('account/invalid-deletion-response');
  }
  return value as AccountDeletionResult;
}

function isRecoveryReceipt(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function parseDeletionPreparation(
  value: unknown,
  expectedUid: string,
): AccountDeletionPreparation {
  const data = asRecord(value);
  if (
    data?.schemaVersion !== 1 ||
    data.deletionSubjectUid !== expectedUid ||
    !isRecoveryReceipt(data.recoveryReceipt)
  ) {
    throw new AccountOperationError('account/invalid-deletion-response');
  }
  return value as AccountDeletionPreparation;
}

function parseDeletionStatus(value: unknown): AccountDeletionStatus {
  const data = asRecord(value);
  if (data?.schemaVersion !== 1) {
    throw new AccountOperationError('account/invalid-deletion-response');
  }
  if (data.status === 'prepared' || data.status === 'pending') {
    return value as AccountDeletionStatus;
  }
  const completedAt = typeof data.completedAt === 'string'
    ? Date.parse(data.completedAt)
    : Number.NaN;
  if (
    data.status !== 'completed' ||
    !Number.isFinite(completedAt) ||
    new Date(completedAt).toISOString() !== data.completedAt
  ) {
    throw new AccountOperationError('account/invalid-deletion-response');
  }
  return value as AccountDeletionStatus;
}

function toAccountSession(user: User): AccountSession {
  return {
    uid: user.uid,
    email: user.email,
    isAnonymous: user.isAnonymous,
    emailVerified: user.emailVerified,
  };
}

function requireCurrentUser(): User {
  const user = getAuth().currentUser;
  if (!user) throw new AccountOperationError('account/no-current-user');
  return user;
}

export const firebaseAccountAdapter: AccountPort = {
  currentSession() {
    const user = getAuth().currentUser;
    return user ? toAccountSession(user) : null;
  },

  async initialize() {
    const auth = getAuth();
    const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
    return toAccountSession(user);
  },

  async startGuest() {
    const auth = getAuth();
    // A persisted durable session may still exist if the app stopped after
    // recording the explicit sign-out intent but before native sign-out
    // completed. Never reuse or replace that identity as the new guest.
    if (auth.currentUser) await signOut(auth);
    return toAccountSession((await signInAnonymously(auth)).user);
  },

  subscribe(onSession, onError) {
    return onAuthStateChanged(
      getAuth(),
      user => onSession(user ? toAccountSession(user) : null),
      onError,
    );
  },

  async upgradeAnonymous(email, password) {
    const user = requireCurrentUser();
    if (!user.isAnonymous) {
      throw new AccountOperationError('account/not-anonymous');
    }
    const uidBeforeUpgrade = user.uid;
    const credential = EmailAuthProvider.credential(email, password);
    const upgraded = (await linkWithCredential(user, credential)).user;
    if (upgraded.uid !== uidBeforeUpgrade) {
      throw new AccountOperationError('account/uid-changed');
    }
    return toAccountSession(upgraded);
  },

  async sendVerificationEmail() {
    const user = requireCurrentUser();
    if (!user.email || user.isAnonymous) {
      throw new AccountOperationError('account/email-account-required');
    }
    if (!user.emailVerified) await sendEmailVerification(user);
  },

  async reloadSession() {
    const user = requireCurrentUser();
    await reload(user);
    return toAccountSession(requireCurrentUser());
  },

  async signIn(email, password) {
    const credential = await signInWithEmailAndPassword(
      getAuth(),
      email,
      password,
    );
    return toAccountSession(credential.user);
  },

  async sendPasswordResetEmail(email) {
    await sendPasswordResetEmail(getAuth(), email);
  },

  async reauthenticateWithPassword(password) {
    const user = requireCurrentUser();
    if (!user.email || user.isAnonymous) {
      throw new AccountOperationError('account/email-account-required');
    }
    await reauthenticateWithCredential(
      user,
      EmailAuthProvider.credential(user.email, password),
    );
    await getIdToken(user, true);
  },

  async requestDataExport() {
    const uid = requireCurrentUser().uid;
    return parseDataExportTicket(
      await callAccountFunction<{ uid: string }, unknown>(
        'requestAccountDataExport',
        { uid },
      ),
      uid,
    );
  },

  async beginAccountDeletion() {
    const uid = requireCurrentUser().uid;
    return parseDeletionPreparation(
      await callAccountFunction<{ uid: string }, unknown>(
        'beginAccountDeletion',
        { uid },
      ),
      uid,
    );
  },

  async getAccountDeletionStatus(uid, recoveryReceipt) {
    if (!uid || !isRecoveryReceipt(recoveryReceipt)) {
      throw new AccountOperationError('account/invalid-deletion-response');
    }
    return parseDeletionStatus(
      await callAccountFunction<
        { uid: string; recoveryReceipt: string },
        unknown
      >('getAccountDeletionStatus', { uid, recoveryReceipt }),
    );
  },

  async deleteMyAccount(recoveryReceipt) {
    const uid = requireCurrentUser().uid;
    if (!isRecoveryReceipt(recoveryReceipt)) {
      throw new AccountOperationError('account/invalid-deletion-response');
    }
    return parseDeletionResult(
      await callAccountFunction<
        { uid: string; recoveryReceipt: string },
        unknown
      >('deleteMyAccount', { uid, recoveryReceipt }),
    );
  },

  async purgeLocalPrivateData(uid) {
    await localPrivateDataCleaner.purgeUser(uid);
  },

  async signOut() {
    await signOut(getAuth());
  },
};
