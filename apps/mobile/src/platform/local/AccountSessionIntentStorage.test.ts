/* eslint-env jest */

import * as Keychain from 'react-native-keychain';

import { asyncStorageAccountSessionIntentStorage as storage } from './AccountSessionIntentStorage';

describe('durable account deletion intent', () => {
  const receipt = 'r'.repeat(43);
  beforeEach(async () => {
    jest.clearAllMocks();
    await storage.clearAccountDeletionIntent();
    jest.clearAllMocks();
  });

  it('keeps the UID deletion barrier in device-only encrypted storage', async () => {
    await storage.markAccountDeletionPreparing('uid-delete');

    await expect(storage.loadAccountDeletionIntent()).resolves.toEqual({
      schemaVersion: 2,
      uid: 'uid-delete',
      phase: 'deletion-preparing',
    });

    await storage.markAccountDeletionPending('uid-delete', receipt);

    await expect(storage.loadAccountDeletionIntent()).resolves.toEqual({
      schemaVersion: 2,
      uid: 'uid-delete',
      phase: 'deletion-pending',
      recoveryReceipt: receipt,
    });
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'cyclepair-account-deletion',
      expect.stringContaining('"uid":"uid-delete"'),
      expect.objectContaining({
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        cloudSync: false,
      }),
    );
  });

  it('does not remove the barrier until local cleanup is confirmed', async () => {
    await storage.markAccountDeletionPending('uid-delete', receipt);
    await storage.markAccountDeletionLocalCleanupPending('uid-delete', receipt);

    await expect(storage.loadAccountDeletionIntent()).resolves.toEqual({
      schemaVersion: 2,
      uid: 'uid-delete',
      phase: 'local-cleanup-pending',
      recoveryReceipt: receipt,
    });

    await storage.clearAccountDeletionIntent();
    await expect(storage.loadAccountDeletionIntent()).resolves.toBeNull();
  });
});
