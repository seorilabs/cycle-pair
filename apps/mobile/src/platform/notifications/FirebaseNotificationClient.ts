import { getApp } from '@react-native-firebase/app';
import {
  AuthorizationStatus,
  deleteToken,
  getMessaging,
  getToken,
  getInitialNotification,
  onNotificationOpenedApp,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
  requestPermission,
  setAutoInitEnabled,
} from '@react-native-firebase/messaging';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  createNotificationClient,
  type NotificationDelegate,
  type NotificationPermission,
} from './NotificationClient';

const FUNCTIONS_REGION = 'asia-northeast3';

async function requestNativePermission(): Promise<NotificationPermission> {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return 'denied';
  }

  const messaging = getMessaging(getApp());
  const authorization = await requestPermission(messaging, {
    alert: true,
    badge: true,
    sound: true,
    provisional: false,
  });
  const granted = authorization === AuthorizationStatus.AUTHORIZED ||
    authorization === AuthorizationStatus.PROVISIONAL;
  if (!granted) return 'denied';
  await setAutoInitEnabled(messaging, true);
  if (Platform.OS === 'ios') await registerDeviceForRemoteMessages(messaging);
  return 'authorized';
}

async function call(name: string, data: unknown): Promise<void> {
  await httpsCallable(
    getFunctions(getApp(), FUNCTIONS_REGION),
    name,
  )(data);
}

const firebaseNotificationDelegate: NotificationDelegate = {
  requestPermission: requestNativePermission,
  getToken() {
    return getToken(getMessaging(getApp()));
  },
  register(registration) {
    return call('registerNotificationDevice', registration);
  },
  unregister(token) {
    return call('unregisterNotificationDevice', { token });
  },
  async deleteLocalToken() {
    const messaging = getMessaging(getApp());
    await deleteToken(messaging);
    await setAutoInitEnabled(messaging, false);
  },
  onTokenRefresh(listener) {
    return onTokenRefresh(getMessaging(getApp()), listener);
  },
  async getInitialOpenedPayload() {
    const message = await getInitialNotification(getMessaging(getApp()));
    return message?.data;
  },
  onOpenedPayload(listener) {
    return onNotificationOpenedApp(getMessaging(getApp()), message => {
      listener(message.data);
    });
  },
};

export const firebaseNotificationClient = createNotificationClient(
  firebaseNotificationDelegate,
);
