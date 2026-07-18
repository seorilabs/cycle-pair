/**
 * @format
 */

import { AppRegistry } from 'react-native';
import React from 'react';
import App from './App';
import { name as appName } from './app.json';
import { firebaseAccountAdapter } from './src/platform/account/FirebaseAccountAdapter';
import { firebaseCyclePairBackend } from './src/platform/firebase/FirebaseCyclePairBackend';
import { FirebaseAppCheckGate } from './src/platform/firebase/FirebaseAppCheckGate';
import { initializeFirebaseAppCheck } from './src/platform/firebase/FirebaseAppCheckBootstrap';
import { firebaseNotificationClient } from './src/platform/notifications/FirebaseNotificationClient';
import { productAnalytics } from './src/platform/observability/ProductAnalytics';
import { safeCrashReporter } from './src/platform/observability/SafeCrashReporter';
import {
  CyclePairPurchaseAdapter,
  ReactNativeIapClient,
  firebasePurchaseVerificationClient,
} from './src/platform/purchases';

const purchaseClient = new CyclePairPurchaseAdapter(
  new ReactNativeIapClient(),
  firebasePurchaseVerificationClient,
);

// Start attestation before React renders any Firebase-backed feature. The gate
// below fails closed, so Auth/Firestore/Functions never run without App Check.
const appCheckInitialization = initializeFirebaseAppCheck().then(
  () => true,
  () => false,
);

function RuntimeApp() {
  return (
    <FirebaseAppCheckGate initialInitialization={appCheckInitialization}>
      <App
        account={firebaseAccountAdapter}
        analytics={productAnalytics}
        backend={firebaseCyclePairBackend}
        crashReporter={safeCrashReporter}
        notificationClient={firebaseNotificationClient}
        purchaseClient={purchaseClient}
      />
    </FirebaseAppCheckGate>
  );
}

AppRegistry.registerComponent(appName, () => RuntimeApp);
