import { NativeModules, Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';

function ownsService(service: string): boolean {
  return (
    service.startsWith('com.seorilabs.cyclepair.private-cache.v1.') ||
    service.startsWith('com.seorilabs.cyclepair.offline.v1.') ||
    service === 'com.seorilabs.cyclepair.account-deletion-intent.v1'
  );
}

/**
 * RNKeychain 10.0.0 interpreted an explicit false as synchronized on iOS.
 * Keep each original until an identical device-only copy has been read back.
 * This startup migration must precede account recovery and cache access.
 */
export async function migrateDeviceOnlyStorage(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (
    NativeModules.RNKeychainManager?.cyclePairDeviceOnlyStorageVersion !== 1
  ) {
    throw new Error(
      'A native storage repair build is required before migration.',
    );
  }
  const services = await Keychain.getAllGenericPasswordServices({
    skipUIAuth: true,
  });
  for (const service of new Set(services.filter(ownsService))) {
    const old = await Keychain.getGenericPassword({ service, cloudSync: true });
    if (!old) continue;
    const existing = await Keychain.getGenericPassword({
      service,
      cloudSync: false,
    });
    if (
      existing &&
      (existing.username !== old.username || existing.password !== old.password)
    ) {
      throw new Error('Conflicting private storage copies require recovery.');
    }
    if (!existing) {
      const stored = await Keychain.setGenericPassword(
        old.username,
        old.password,
        {
          service,
          cloudSync: false,
          accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
          storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        },
      );
      if (!stored) throw new Error('Unable to migrate private storage.');
    }
    const verified = await Keychain.getGenericPassword({
      service,
      cloudSync: false,
    });
    if (
      !verified ||
      verified.username !== old.username ||
      verified.password !== old.password
    ) {
      throw new Error('Unable to verify migrated private storage.');
    }
    await Keychain.resetGenericPassword({ service, cloudSync: true });
    if (await Keychain.getGenericPassword({ service, cloudSync: true })) {
      throw new Error('Unable to remove the old synchronized private copy.');
    }
  }
}
