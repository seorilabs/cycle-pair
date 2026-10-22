/**
 * @format
 */

import { AppRegistry } from 'react-native';
import React from 'react';
import {AppContent} from './App';
import {I18nProvider} from './src/i18n/I18nProvider';
import { name as appName } from './app.json';
import {runtimeAccount, initializeRuntime} from '@cyclepair/native-runtime';
import { firebaseCyclePairBackend } from './src/platform/firebase/FirebaseCyclePairBackend';
import { FirebaseAppCheckGate } from './src/platform/firebase/FirebaseAppCheckGate';
import { firebaseNotificationClient } from './src/platform/notifications/FirebaseNotificationClient';
import { platformPresenceClient } from './src/platform/presence/PlatformPresenceClient';
import { productAnalytics } from './src/platform/observability/ProductAnalytics';
import { safeCrashReporter } from './src/platform/observability/SafeCrashReporter';
// Start attestation before React renders any Firebase-backed feature. The gate
// below fails closed, so Auth/Firestore/Functions never run without App Check.
const appCheckInitialization = initializeRuntime();

function RuntimeApp() {
  return (
    <I18nProvider><FirebaseAppCheckGate initialInitialization={appCheckInitialization} retryInitialization={initializeRuntime}>
      <AppContent
        account={runtimeAccount}
        analytics={productAnalytics}
        backend={firebaseCyclePairBackend}
        crashReporter={safeCrashReporter}
        notificationClient={firebaseNotificationClient}
        presenceClient={platformPresenceClient}
      />
    </FirebaseAppCheckGate></I18nProvider>
  );
}

AppRegistry.registerComponent(appName, () => RuntimeApp);
