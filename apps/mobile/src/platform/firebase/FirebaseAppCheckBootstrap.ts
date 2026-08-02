import { getApp, type FirebaseApp } from '@react-native-firebase/app';
import {
  initializeAppCheck,
  ReactNativeFirebaseAppCheckProvider,
  type ReactNativeFirebaseAppCheckProviderOptionsMap,
} from '@react-native-firebase/app-check';

import firebaseEnvironments from '../../../firebase-environments.json';

export type AppCheckMode = 'debug' | 'production';

interface FirebaseAppCheckProviderLike {
  configure(options: ReactNativeFirebaseAppCheckProviderOptionsMap): void;
}

interface FirebaseAppCheckInitializerDependencies {
  readonly developmentBundle: boolean;
  readonly getFirebaseApp: () => FirebaseApp;
  readonly createProvider: () => FirebaseAppCheckProviderLike;
  readonly initialize: (
    app: FirebaseApp,
    provider: FirebaseAppCheckProviderLike,
  ) => Promise<unknown>;
}

export function resolveAppCheckMode(
  developmentBundle: boolean,
  projectId: string | undefined,
): AppCheckMode {
  if (projectId !== firebaseEnvironments.projectId) {
    throw new Error('App Check Firebase project mismatch.');
  }
  return developmentBundle ? 'debug' : 'production';
}

export function appCheckProviderOptions(
  mode: AppCheckMode,
): ReactNativeFirebaseAppCheckProviderOptionsMap {
  if (mode === 'debug') {
    return {
      android: { provider: 'debug' },
      apple: { provider: 'debug' },
    };
  }

  return {
    android: { provider: 'playIntegrity' },
    apple: { provider: 'appAttestWithDeviceCheckFallback' },
  };
}

export function createFirebaseAppCheckInitializer(
  dependencies: FirebaseAppCheckInitializerDependencies,
): () => Promise<void> {
  let initialization: Promise<void> | undefined;

  return () => {
    if (initialization) return initialization;

    initialization = (async () => {
      const app = dependencies.getFirebaseApp();
      const mode = resolveAppCheckMode(
        dependencies.developmentBundle,
        app.options.projectId,
      );
      const provider = dependencies.createProvider();
      provider.configure(appCheckProviderOptions(mode));
      await dependencies.initialize(app, provider);
    })().catch(error => {
      initialization = undefined;
      throw error;
    });

    return initialization;
  };
}

const initializeOnce = createFirebaseAppCheckInitializer({
  developmentBundle: __DEV__,
  getFirebaseApp: getApp,
  createProvider: () => new ReactNativeFirebaseAppCheckProvider(),
  initialize: (app, provider) =>
    initializeAppCheck(app, {
      provider: provider as ReactNativeFirebaseAppCheckProvider,
      // App Check token refresh is operational security, not Analytics or
      // Crashlytics collection. Keep it explicit while global data collection
      // and every optional telemetry module remain opt-in.
      isTokenAutoRefreshEnabled: true,
    }),
});

export function initializeFirebaseAppCheck(): Promise<void> {
  return initializeOnce();
}
