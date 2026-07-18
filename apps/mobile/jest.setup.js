/* global jest */
jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map();
  const storage = {
    getItem: jest.fn(async key => values.get(key) ?? null),
    setItem: jest.fn(async (key, value) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async key => {
      values.delete(key);
    }),
    clear: jest.fn(async () => {
      values.clear();
    }),
  };
  return { __esModule: true, default: storage, ...storage };
});

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
    addEventListener: jest.fn(listener => {
      listener({ isConnected: true, isInternetReachable: true });
      return jest.fn();
    }),
  },
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addEventListener: jest.fn(listener => {
    listener({ isConnected: true, isInternetReachable: true });
    return jest.fn();
  }),
}));

jest.mock('react-native-keychain', () => {
  const values = new Map();
  const ACCESSIBLE = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
      'AccessibleAfterFirstUnlockThisDeviceOnly',
  };
  const STORAGE_TYPE = { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' };
  return {
    __esModule: true,
    ACCESSIBLE,
    STORAGE_TYPE,
    setGenericPassword: jest.fn(async (username, password, options = {}) => {
      const service = options.service ?? 'default';
      values.set(service, { username, password });
      return { service, storage: STORAGE_TYPE.AES_GCM_NO_AUTH };
    }),
    getGenericPassword: jest.fn(async (options = {}) => {
      const service = options.service ?? 'default';
      const value = values.get(service);
      return value
        ? { service, storage: STORAGE_TYPE.AES_GCM_NO_AUTH, ...value }
        : false;
    }),
    getAllGenericPasswordServices: jest.fn(async () => [...values.keys()]),
    resetGenericPassword: jest.fn(async (options = {}) =>
      values.delete(options.service ?? 'default'),
    ),
  };
});

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
