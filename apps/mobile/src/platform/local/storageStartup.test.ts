import { migrateDeviceOnlyStorage } from './migrateDeviceOnlyStorage';
import { initializeFirebaseAppCheck } from '../firebase/FirebaseAppCheckBootstrap';
import { initializeRuntime as initializeService } from '../firebase/productionRuntime';
import { initializeRuntime as initializeEmulator } from '../development/emulatorRuntime';
import { connectAuthEmulator } from '@react-native-firebase/auth';

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

beforeEach(() => {
  jest.clearAllMocks();
  migration.mockReset();
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
