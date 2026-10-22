import { assertDevelopmentBoundary } from '../firebase/developmentBoundary';
import { getApp } from '@react-native-firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from '@react-native-firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  connectFirestoreEmulator,
} from '@react-native-firebase/firestore';
import {
  getFunctions,
  connectFunctionsEmulator,
} from '@react-native-firebase/functions';
import { Platform } from 'react-native';
import { createFirebaseAccountAdapter } from '../account/FirebaseAccountAdapter';
import { migrateDeviceOnlyStorage } from '../local/migrateDeviceOnlyStorage';
// Metro selects this module only for a development bundle with an explicit
// emulator backend. Production has a separate dependency graph.
const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
export const runtimeAccount = createFirebaseAccountAdapter(undefined, {
  createGuestSession: async () => {
    const { user } = await signInAnonymously(getAuth());
    return {
      uid: user.uid,
      email: user.email,
      isAnonymous: true,
      emailVerified: user.emailVerified,
    };
  },
  exportOrigin: `http://${host}:5301`,
});
export async function initializeRuntime(): Promise<boolean> {
  if (!__DEV__)
    throw new Error('Emulator runtime requires a development bundle');
  const app = getApp();
  await assertDevelopmentBoundary(
    'emulator',
    Boolean(getAuth(app).currentUser),
  );
  await migrateDeviceOnlyStorage();
  connectAuthEmulator(getAuth(app), `http://${host}:9399`, {
    disableWarnings: true,
  });
  await initializeFirestore(app, { persistence: false });
  connectFirestoreEmulator(getFirestore(app), host, 8380);
  connectFunctionsEmulator(getFunctions(app, 'asia-northeast3'), host, 5301);
  return true;
}
