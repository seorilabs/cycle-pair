import { assertDevelopmentBoundary } from './developmentBoundary';
import { getAuth } from '@react-native-firebase/auth';
import { firebaseAccountAdapter } from '../account/FirebaseAccountAdapter';
import { initializeFirebaseAppCheck } from './FirebaseAppCheckBootstrap';
import { migrateDeviceOnlyStorage } from '../local/migrateDeviceOnlyStorage';
import { NativeModules } from 'react-native';
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
