import type { FirebaseApp } from '@react-native-firebase/app';

jest.mock('@react-native-firebase/app', () => ({
  getApp: jest.fn(),
}));

jest.mock('@react-native-firebase/app-check', () => ({
  initializeAppCheck: jest.fn(async () => undefined),
  ReactNativeFirebaseAppCheckProvider: class {
    configure = jest.fn();
  },
}));

import {
  appCheckProviderOptions,
  createFirebaseAppCheckInitializer,
  resolveAppCheckMode,
} from './FirebaseAppCheckBootstrap';

const firebaseApp = {
  options: { projectId: 'seorilabs-cyclepair-prod' },
} as FirebaseApp;

describe('Firebase App Check bootstrap', () => {
  it('uses debug attestation for a development bundle on the single project', () => {
    expect(resolveAppCheckMode(true, 'seorilabs-cyclepair-prod')).toBe('debug');
    expect(appCheckProviderOptions('debug')).toEqual({
      android: { provider: 'debug' },
      apple: { provider: 'debug' },
    });
    expect(() => resolveAppCheckMode(true, 'unexpected-project')).toThrow(
      'App Check Firebase project mismatch.',
    );
  });

  it('uses production attestation for a release bundle on the same project', () => {
    expect(resolveAppCheckMode(false, 'seorilabs-cyclepair-prod')).toBe(
      'production',
    );
    expect(appCheckProviderOptions('production')).toEqual({
      android: { provider: 'playIntegrity' },
      apple: { provider: 'appAttestWithDeviceCheckFallback' },
    });
  });

  it('configures once with explicit token refresh before Firebase-backed UI starts', async () => {
    const configure = jest.fn();
    const initialize = jest.fn(async () => undefined);
    const initializer = createFirebaseAppCheckInitializer({
      developmentBundle: true,
      getFirebaseApp: () => firebaseApp,
      createProvider: () => ({ configure }),
      initialize,
    });

    const first = initializer();
    const second = initializer();
    await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(configure).toHaveBeenCalledWith({
      android: { provider: 'debug' },
      apple: { provider: 'debug' },
    });
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith(
      firebaseApp,
      expect.objectContaining({ configure }),
    );
  });

  it('allows a sanitized startup failure to be retried', async () => {
    const initialize = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(undefined);
    const initializer = createFirebaseAppCheckInitializer({
      developmentBundle: true,
      getFirebaseApp: () => firebaseApp,
      createProvider: () => ({ configure: jest.fn() }),
      initialize: () => initialize(),
    });

    await expect(initializer()).rejects.toThrow('temporary');
    await expect(initializer()).resolves.toBeUndefined();
    expect(initialize).toHaveBeenCalledTimes(2);
  });
});
