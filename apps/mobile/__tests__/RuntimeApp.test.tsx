import React from 'react';
import { render } from '@testing-library/react-native';
import { AppRegistry } from 'react-native';
import { AppContent } from '../App';
import { productAnalytics } from '../src/platform/observability/ProductAnalytics';
import { safeCrashReporter } from '../src/platform/observability/SafeCrashReporter';
import { firebaseNotificationClient } from '../src/platform/notifications/FirebaseNotificationClient';
import { platformPresenceClient } from '../src/platform/presence/PlatformPresenceClient';

jest.mock('../App', () => ({ AppContent: jest.fn(() => null) }));
jest.mock('../src/i18n/I18nProvider', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../src/platform/firebase/FirebaseAppCheckGate', () => ({
  FirebaseAppCheckGate: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock('../src/platform/firebase/FirebaseCyclePairBackend', () => ({
  firebaseCyclePairBackend: {},
}));
jest.mock('../src/platform/observability/ProductAnalytics', () => ({
  productAnalytics: { setEnabled: jest.fn(), track: jest.fn() },
}));
jest.mock('../src/platform/observability/SafeCrashReporter', () => ({
  safeCrashReporter: { setEnabled: jest.fn(), recordFailure: jest.fn() },
}));
jest.mock('../src/platform/notifications/FirebaseNotificationClient', () => ({
  firebaseNotificationClient: { enable: jest.fn() },
}));
jest.mock('../src/platform/presence/PlatformPresenceClient', () => ({
  platformPresenceClient: { start: jest.fn() },
}));
jest.mock(
  '@cyclepair/native-runtime',
  () => ({
    runtimeAccount: {},
    initializeRuntime: jest.fn(async () => true),
    runtimeServices: require('../src/platform/development/isolatedServices')
      .isolatedServices,
  }),
  { virtual: true },
);

it('keeps local opt-in and notification actions away from production services at the app entry point', async () => {
  let RuntimeApp!: React.ComponentType;
  jest
    .spyOn(AppRegistry, 'registerComponent')
    .mockImplementation((_, provider) => {
      RuntimeApp = provider();
      return '';
    });
  require('../index');
  await render(<RuntimeApp />);
  const props = jest.mocked(AppContent).mock.calls.at(-1)![0];
  await props.analytics!.setEnabled(true);
  await props.analytics!.track({ name: 'cp_onboarding_complete' });
  await props.crashReporter!.setEnabled(true);
  await props.crashReporter!.recordFailure('network-failed', {
    surface: 'startup',
    operation: 'start',
    retryable: true,
  });
  await props.notificationClient!.enable({
    platform: 'android',
    locale: 'en',
    quietHours: { start: '22:00', end: '08:00', timeZone: 'Etc/UTC' },
  });
  props.presenceClient!.start();
  for (const callback of [
    productAnalytics.setEnabled,
    productAnalytics.track,
    safeCrashReporter.setEnabled,
    safeCrashReporter.recordFailure,
    firebaseNotificationClient.enable,
    platformPresenceClient.start,
  ]) {
    expect(callback).not.toHaveBeenCalled();
  }
});
