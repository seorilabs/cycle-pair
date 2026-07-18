import type {FirebaseApp} from '@react-native-firebase/app';

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
  resolveAppCheckEnvironment,
} from './FirebaseAppCheckBootstrap';

const developmentApp = {
  options: {projectId: 'seorilabs-cyclepair-dev'},
} as FirebaseApp;

describe('Firebase App Check bootstrap', () => {
  it('uses debug attestation only for a development bundle on the tracked dev project', () => {
    expect(
      resolveAppCheckEnvironment(true, 'seorilabs-cyclepair-dev'),
    ).toBe('development');
    expect(appCheckProviderOptions('development')).toEqual({
      android: {provider: 'debug'},
      apple: {provider: 'debug'},
    });
    expect(() => resolveAppCheckEnvironment(true, 'unexpected-project')).toThrow(
      'App Check development environment mismatch.',
    );
  });

  it('fails closed until a distinct production project is configured', () => {
    expect(() => resolveAppCheckEnvironment(false, 'seorilabs-cyclepair-dev')).toThrow(
      'App Check production environment mismatch.',
    );
    expect(appCheckProviderOptions('production')).toEqual({
      android: {provider: 'playIntegrity'},
      apple: {provider: 'appAttestWithDeviceCheckFallback'},
    });
  });

  it('configures once with explicit token refresh before Firebase-backed UI starts', async () => {
    const configure = jest.fn();
    const initialize = jest.fn(async () => undefined);
    const initializer = createFirebaseAppCheckInitializer({
      developmentBundle: true,
      getFirebaseApp: () => developmentApp,
      createProvider: () => ({configure}),
      initialize,
    });

    const first = initializer();
    const second = initializer();
    await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(configure).toHaveBeenCalledWith({
      android: {provider: 'debug'},
      apple: {provider: 'debug'},
    });
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith(
      developmentApp,
      expect.objectContaining({configure}),
    );
  });

  it('allows a sanitized startup failure to be retried', async () => {
    const initialize = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(undefined);
    const initializer = createFirebaseAppCheckInitializer({
      developmentBundle: true,
      getFirebaseApp: () => developmentApp,
      createProvider: () => ({configure: jest.fn()}),
      initialize: () => initialize(),
    });

    await expect(initializer()).rejects.toThrow('temporary');
    await expect(initializer()).resolves.toBeUndefined();
    expect(initialize).toHaveBeenCalledTimes(2);
  });
});
