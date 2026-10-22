import { migrateDeviceOnlyStorage } from './migrateDeviceOnlyStorage';
import { initializeFirebaseAppCheck } from '../firebase/FirebaseAppCheckBootstrap';
import { initializeRuntime as initializeService } from '../firebase/productionRuntime';
import { initializeRuntime as initializeEmulator } from '../development/emulatorRuntime';
import { connectAuthEmulator } from '@react-native-firebase/auth';
import { NativeModules } from 'react-native';
import { runtimeServices as emulatorServices } from '../development/emulatorRuntime';
import { isolatedServices } from '../development/isolatedServices';

jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  native.NativeModules.SourceCode = {
    getConstants: () => ({
      scriptURL: 'http://127.0.0.1:8081/index.bundle?platform=ios&dev=true',
    }),
  };
  return native;
});

jest.mock('../observability/ProductAnalytics', () => ({
  productAnalytics: {},
}));
jest.mock('../observability/SafeCrashReporter', () => ({
  safeCrashReporter: {},
}));
jest.mock('../notifications/FirebaseNotificationClient', () => ({
  firebaseNotificationClient: {},
}));
jest.mock('../presence/PlatformPresenceClient', () => ({
  platformPresenceClient: {},
}));

jest.mock('./migrateDeviceOnlyStorage', () => ({
  migrateDeviceOnlyStorage: jest.fn(),
}));
jest.mock('../firebase/developmentBoundary', () => ({
  assertDevelopmentBoundary: jest.fn(async () => undefined),
}));
jest.mock('../firebase/FirebaseAppCheckBootstrap', () => ({
  initializeFirebaseAppCheck: jest.fn(async () => undefined),
}));
jest.mock('../account/FirebaseAccountAdapter', () => ({
  firebaseAccountAdapter: {},
  createFirebaseAccountAdapter: jest.fn(() => ({})),
}));
jest.mock('@react-native-firebase/app', () => ({ getApp: () => ({}) }));
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: null }),
  connectAuthEmulator: jest.fn(),
}));
jest.mock('@react-native-firebase/firestore', () => ({
  getFirestore: () => ({}),
  initializeFirestore: jest.fn(async () => undefined),
  connectFirestoreEmulator: jest.fn(),
}));
jest.mock('@react-native-firebase/functions', () => ({
  getFunctions: () => ({}),
  connectFunctionsEmulator: jest.fn(),
}));

const migration = jest.mocked(migrateDeviceOnlyStorage);

it('selects isolated external services for local Firebase', () => {
  expect(emulatorServices).toBe(isolatedServices);
});

beforeEach(() => {
  jest.clearAllMocks();
  migration.mockReset();
  NativeModules.CyclePairBuildEnvironment = { syntheticQa: false };
});

it('rejects the synthetic Android installation before service storage or authentication opens', async () => {
  NativeModules.CyclePairBuildEnvironment = { syntheticQa: true };
  await expect(initializeService()).resolves.toBe(false);
  expect(migration).not.toHaveBeenCalled();
  expect(initializeFirebaseAppCheck).not.toHaveBeenCalled();
});

it.each([
  ['service', initializeService, initializeFirebaseAppCheck],
  ['emulator', initializeEmulator, connectAuthEmulator],
] as const)(
  '%s startup waits for storage recovery before opening Firebase',
  async (_, initialize, connect) => {
    let finish!: () => void;
    migration.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      }),
    );
    let ready = false;
    const initialization = initialize().then(result => {
      ready = result;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(migration).toHaveBeenCalledTimes(1);
    expect(ready).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    finish();
    await initialization;
    expect(ready).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
  },
);

it('keeps service startup closed after failed recovery and retries recovery', async () => {
  migration.mockRejectedValueOnce(new Error('synthetic recovery failure'));
  await expect(initializeService()).resolves.toBe(false);
  expect(initializeFirebaseAppCheck).not.toHaveBeenCalled();
  migration.mockResolvedValueOnce(undefined);
  await expect(initializeService()).resolves.toBe(true);
  expect(migration).toHaveBeenCalledTimes(2);
});

it('keeps emulator startup closed after failed recovery', async () => {
  migration.mockRejectedValueOnce(new Error('synthetic recovery failure'));
  await expect(initializeEmulator()).rejects.toThrow('recovery failure');
  expect(connectAuthEmulator).not.toHaveBeenCalled();
});
