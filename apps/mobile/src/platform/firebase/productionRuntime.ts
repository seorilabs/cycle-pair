import { assertDevelopmentBoundary } from './developmentBoundary';
import { getAuth } from '@react-native-firebase/auth';
import { firebaseAccountAdapter } from '../account/FirebaseAccountAdapter';
import { initializeFirebaseAppCheck } from './FirebaseAppCheckBootstrap';
import { migrateDeviceOnlyStorage } from '../local/migrateDeviceOnlyStorage';
import { NativeModules } from 'react-native';
import { productAnalytics } from '../observability/ProductAnalytics';
import { safeCrashReporter } from '../observability/SafeCrashReporter';
import { firebaseNotificationClient } from '../notifications/FirebaseNotificationClient';
import { platformPresenceClient } from '../presence/PlatformPresenceClient';
export const runtimeServices = {
  analytics: productAnalytics,
  crashReporter: safeCrashReporter,
  notificationClient: firebaseNotificationClient,
  presenceClient: platformPresenceClient,
};
export const runtimeAccount = firebaseAccountAdapter;
export async function initializeRuntime(): Promise<boolean> {
  try {
    if (NativeModules.CyclePairBuildEnvironment?.syntheticQa === true)
      return false;
    if (__DEV__)
      await assertDevelopmentBoundary(
        'service',
        Boolean(getAuth().currentUser),
      );
    await migrateDeviceOnlyStorage();
    await initializeFirebaseAppCheck();
    return true;
  } catch {
    return false;
  }
}
