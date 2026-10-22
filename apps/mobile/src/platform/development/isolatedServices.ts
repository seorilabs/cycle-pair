import type { NotificationClient } from '../notifications/NotificationClient';
import type { ProductAnalytics } from '../observability/ProductAnalytics';
import type { SafeCrashReporter } from '../observability/SafeCrashReporter';
import type { PresenceClient } from '../presence/PresenceClient';

// Firebase does not emulate these remote services. Local UI runs cannot enable
// their production SDKs, even when optional consent or notifications are chosen.
export const isolatedServices: {
  analytics: ProductAnalytics;
  crashReporter: SafeCrashReporter;
  notificationClient: NotificationClient;
  presenceClient: PresenceClient;
} = {
  analytics: { async setEnabled() {}, async track() {} },
  crashReporter: { async setEnabled() {}, async recordFailure() {} },
  notificationClient: {
    async enable() {
      return 'denied';
    },
    async disable() {},
    async disableForAccountExit() {},
    watchTokenRefresh() {
      return () => {};
    },
    watchOpened() {
      return () => {};
    },
  },
  presenceClient: { start() {}, stop() {}, resume() {} },
};
