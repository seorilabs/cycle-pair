import { NativeModules, Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { migrateDeviceOnlyStorage } from './migrateDeviceOnlyStorage';

const local = new Map<string, { username: string; password: string }>();
const legacy = new Map<string, { username: string; password: string }>();
const service =
  'com.seorilabs.cyclepair.private-cache.v1.opaque::daily::opaque';
const pending = 'com.seorilabs.cyclepair.offline.v1.opaque';
const credential = {
  username: 'synthetic-owner',
  password: '{"synthetic":"unchanged"}',
};
const rawGet = jest.spyOn(Keychain, 'getGenericPassword');
const rawSet = jest.spyOn(Keychain, 'setGenericPassword');
const rawReset = jest.spyOn(Keychain, 'resetGenericPassword');

beforeEach(() => {
  local.clear();
  legacy.clear();
  jest.clearAllMocks();
  NativeModules.RNKeychainManager = { cyclePairDeviceOnlyStorageVersion: 1 };
  jest
    .spyOn(Keychain, 'getAllGenericPasswordServices')
    .mockImplementation(async () => [...local.keys(), ...legacy.keys()]);
  rawGet.mockImplementation(async options => {
    const found = (options?.cloudSync ? legacy : local).get(
      options?.service ?? '',
    );
    return found
      ? {
          service: options!.service!,
          storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
          ...found,
        }
      : false;
  });
  rawSet.mockImplementation(async (username, password, options) => {
    local.set(options!.service!, { username, password });
    return {
      service: options!.service!,
      storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    };
  });
  rawReset.mockImplementation(async options =>
    (options?.cloudSync ? legacy : local).delete(options?.service ?? ''),
  );
});

it('preserves cached and pending bytes before removing only the old synchronized copies', async () => {
  legacy.set(service, credential);
  legacy.set(pending, credential);
  legacy.set('unrelated.credentials', credential);
  await migrateDeviceOnlyStorage();
  expect(local.get(service)).toEqual(credential);
  expect(local.get(pending)).toEqual(credential);
  expect(legacy.has(service)).toBe(false);
  expect(legacy.has(pending)).toBe(false);
  expect(legacy.get('unrelated.credentials')).toEqual(credential);
  for (const [, , options] of rawSet.mock.calls) {
    expect(options).toEqual(
      expect.objectContaining({
        cloudSync: false,
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      }),
    );
  }
});

it('keeps the original when the device-only copy cannot be written', async () => {
  legacy.set(service, credential);
  rawSet.mockRejectedValueOnce(new Error('synthetic write failure'));
  await expect(migrateDeviceOnlyStorage()).rejects.toThrow();
  expect(legacy.get(service)).toEqual(credential);
  expect(rawReset).not.toHaveBeenCalled();
});

it('preserves the exact account deletion recovery intent without touching other services', async () => {
  const deletion = 'com.seorilabs.cyclepair.account-deletion-intent.v1';
  const unrelated = `${deletion}.other`;
  legacy.set(deletion, credential);
  legacy.set(unrelated, credential);
  await migrateDeviceOnlyStorage();
  expect(local.get(deletion)).toEqual(credential);
  expect(legacy.has(deletion)).toBe(false);
  expect(legacy.get(unrelated)).toEqual(credential);
  expect(local.has(unrelated)).toBe(false);
});

it('reads back the exact local copy before deleting the original', async () => {
  legacy.set(service, credential);
  rawSet.mockResolvedValueOnce({
    service,
    storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
  });
  await expect(migrateDeviceOnlyStorage()).rejects.toThrow();
  expect(legacy.get(service)).toEqual(credential);
  expect(rawReset).not.toHaveBeenCalled();
});

it('retries an interrupted cleanup without replacing a verified local copy', async () => {
  legacy.set(service, credential);
  local.set(service, credential);
  rawReset.mockRejectedValueOnce(new Error('synthetic cleanup failure'));
  await expect(migrateDeviceOnlyStorage()).rejects.toThrow();
  expect(local.get(service)).toEqual(credential);
  expect(legacy.get(service)).toEqual(credential);
  await migrateDeviceOnlyStorage();
  expect(local.get(service)).toEqual(credential);
  expect(legacy.has(service)).toBe(false);
  expect(rawSet).not.toHaveBeenCalled();
});

it('preserves both copies and stops if an existing local copy disagrees', async () => {
  legacy.set(service, credential);
  local.set(service, { ...credential, password: 'different synthetic bytes' });
  await expect(migrateDeviceOnlyStorage()).rejects.toThrow();
  expect(legacy.get(service)).toEqual(credential);
  expect(local.get(service)?.password).toBe('different synthetic bytes');
  expect(rawSet).not.toHaveBeenCalled();
  expect(rawReset).not.toHaveBeenCalled();
});

it('preserves all data when an old native binary loads newer JavaScript', async () => {
  NativeModules.RNKeychainManager = {};
  legacy.set(service, credential);
  await expect(migrateDeviceOnlyStorage()).rejects.toThrow(
    'native storage repair build',
  );
  expect(legacy.get(service)).toEqual(credential);
  expect(rawSet).not.toHaveBeenCalled();
  expect(rawReset).not.toHaveBeenCalled();
});

it('does not read or modify Android storage', async () => {
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    await migrateDeviceOnlyStorage();
    expect(Keychain.getAllGenericPasswordServices).not.toHaveBeenCalled();
    expect(rawGet).not.toHaveBeenCalled();
    expect(rawSet).not.toHaveBeenCalled();
    expect(rawReset).not.toHaveBeenCalled();
  } finally {
    platform.restore();
  }
});
