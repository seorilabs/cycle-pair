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
import { createFirebaseAccountAdapter } from '../account/FirebaseAccountAdapter';
import { migrateDeviceOnlyStorage } from '../local/migrateDeviceOnlyStorage';
import { LogBox, NativeModules, Platform } from 'react-native';
import { emulatorHost } from './emulatorHost';
export { isolatedServices as runtimeServices } from './isolatedServices';
// Metro selects this module only for a development bundle with an explicit
// emulator backend. Production has a separate dependency graph.
// Android uses adb reverse. A physical iPhone uses the same local Mac that
// supplied its development bundle, with explicitly opened local forwarders.
const sourceCode = NativeModules.SourceCode;
const host = emulatorHost(
  Platform.OS,
  sourceCode?.getConstants?.().scriptURL ?? sourceCode?.scriptURL,
);
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
  // RN의 디버거 안내가 저장 버튼을 가리지 않게 한다. 앱 경고와 오류 출력은 유지한다.
  LogBox.ignoreLogs([/^Open debugger to view warnings\.$/]);
  await migrateDeviceOnlyStorage();
  connectAuthEmulator(getAuth(app), `http://${host}:9399`, {
    disableWarnings: true,
  });
  await initializeFirestore(app, { persistence: false });
  connectFirestoreEmulator(getFirestore(app), host, 8380);
  connectFunctionsEmulator(getFunctions(app, 'asia-northeast3'), host, 5301);
  return true;
}
