import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

const EXPLICIT_SIGN_OUT_KEY = '@cyclepair/account-explicitly-signed-out/v1';
const ACCOUNT_DELETION_INTENT_SERVICE =
  'com.seorilabs.cyclepair.account-deletion-intent.v1';
const ACCOUNT_DELETION_INTENT_USERNAME = 'cyclepair-account-deletion';

export type AccountDeletionIntentPhase =
  | 'deletion-preparing'
  | 'deletion-pending'
  | 'local-cleanup-pending';

export type AccountDeletionIntent =
  | {
      readonly schemaVersion: 2;
      readonly uid: string;
      readonly phase: 'deletion-preparing';
    }
  | {
      readonly schemaVersion: 2;
      readonly uid: string;
      readonly phase: 'deletion-pending' | 'local-cleanup-pending';
      readonly recoveryReceipt: string;
    };

export interface AccountSessionIntentStorage {
  wasExplicitlySignedOut(): Promise<boolean>;
  markExplicitlySignedOut(): Promise<void>;
  clearExplicitSignOut(): Promise<void>;
  loadAccountDeletionIntent(): Promise<AccountDeletionIntent | null>;
  markAccountDeletionPreparing(uid: string): Promise<void>;
  markAccountDeletionPending(uid: string, recoveryReceipt: string): Promise<void>;
  markAccountDeletionLocalCleanupPending(
    uid: string,
    recoveryReceipt: string,
  ): Promise<void>;
  clearAccountDeletionIntent(): Promise<void>;
}

function isUid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isRecoveryReceipt(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function parseAccountDeletionIntent(value: string): AccountDeletionIntent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Invalid durable account deletion intent.');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error('Invalid durable account deletion intent.');
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 2 ||
    !isUid(candidate.uid) ||
    (candidate.phase !== 'deletion-preparing' &&
      candidate.phase !== 'deletion-pending' &&
      candidate.phase !== 'local-cleanup-pending')
  ) {
    throw new Error('Invalid durable account deletion intent.');
  }
  if (
    candidate.phase !== 'deletion-preparing' &&
    !isRecoveryReceipt(candidate.recoveryReceipt)
  ) {
    throw new Error('Invalid durable account deletion recovery receipt.');
  }
  return candidate as unknown as AccountDeletionIntent;
}

async function writeAccountDeletionIntent(
  uid: string,
  phase: AccountDeletionIntentPhase,
  recoveryReceipt?: string,
): Promise<void> {
  if (!isUid(uid)) throw new Error('Invalid account deletion UID.');
  if (
    phase !== 'deletion-preparing' &&
    !isRecoveryReceipt(recoveryReceipt)
  ) {
    throw new Error('Invalid account deletion recovery receipt.');
  }
  const stored = await Keychain.setGenericPassword(
    ACCOUNT_DELETION_INTENT_USERNAME,
    JSON.stringify({
      schemaVersion: 2,
      uid,
      phase,
      ...(recoveryReceipt === undefined ? {} : { recoveryReceipt }),
    }),
    {
      service: ACCOUNT_DELETION_INTENT_SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
      cloudSync: false,
    },
  );
  if (!stored) throw new Error('Unable to persist account deletion intent.');
}

export const asyncStorageAccountSessionIntentStorage: AccountSessionIntentStorage =
  {
    async wasExplicitlySignedOut() {
      return (await AsyncStorage.getItem(EXPLICIT_SIGN_OUT_KEY)) === 'true';
    },

    async markExplicitlySignedOut() {
      await AsyncStorage.setItem(EXPLICIT_SIGN_OUT_KEY, 'true');
    },

    async clearExplicitSignOut() {
      await AsyncStorage.removeItem(EXPLICIT_SIGN_OUT_KEY);
    },

    async loadAccountDeletionIntent() {
      const services = await Keychain.getAllGenericPasswordServices({
        skipUIAuth: true,
      });
      if (!services.includes(ACCOUNT_DELETION_INTENT_SERVICE)) return null;
      const credentials = await Keychain.getGenericPassword({
        service: ACCOUNT_DELETION_INTENT_SERVICE,
      });
      if (!credentials) return null;
      if (credentials.username !== ACCOUNT_DELETION_INTENT_USERNAME) {
        throw new Error('Invalid durable account deletion intent owner.');
      }
      return parseAccountDeletionIntent(credentials.password);
    },

    markAccountDeletionPreparing(uid) {
      return writeAccountDeletionIntent(uid, 'deletion-preparing');
    },

    markAccountDeletionPending(uid, recoveryReceipt) {
      return writeAccountDeletionIntent(
        uid,
        'deletion-pending',
        recoveryReceipt,
      );
    },

    markAccountDeletionLocalCleanupPending(uid, recoveryReceipt) {
      return writeAccountDeletionIntent(
        uid,
        'local-cleanup-pending',
        recoveryReceipt,
      );
    },

    async clearAccountDeletionIntent() {
      const services = await Keychain.getAllGenericPasswordServices({
        skipUIAuth: true,
      });
      if (!services.includes(ACCOUNT_DELETION_INTENT_SERVICE)) return;
      await Keychain.resetGenericPassword({
        service: ACCOUNT_DELETION_INTENT_SERVICE,
      });
    },
  };
