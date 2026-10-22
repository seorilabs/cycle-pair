import { assertDevelopmentBoundary } from './developmentBoundary';
import { getAuth } from '@react-native-firebase/auth';
import { firebaseAccountAdapter } from '../account/FirebaseAccountAdapter';
import { initializeFirebaseAppCheck } from './FirebaseAppCheckBootstrap';
export const runtimeAccount = firebaseAccountAdapter;
export async function initializeRuntime(): Promise<boolean> {
  try {
    if (__DEV__)
      await assertDevelopmentBoundary(
        'service',
        Boolean(getAuth().currentUser),
      );
    await initializeFirebaseAppCheck();
    return true;
  } catch {
    return false;
  }
}
