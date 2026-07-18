jest.mock('@react-native-firebase/analytics', () => ({
  getAnalytics: jest.fn(() => ({})),
  logEvent: jest.fn(async () => undefined),
  setAnalyticsCollectionEnabled: jest.fn(async () => undefined),
}));

jest.mock('@react-native-firebase/crashlytics', () => ({
  getCrashlytics: jest.fn(() => ({})),
  recordError: jest.fn(),
  setAttributes: jest.fn(async () => undefined),
  setCrashlyticsCollectionEnabled: jest.fn(async () => null),
}));

import {
  createProductAnalytics,
  type AnalyticsDelegate,
} from './ProductAnalytics';
import {
  createSafeCrashReporter,
  type CrashDelegate,
} from './SafeCrashReporter';

describe('privacy-safe observability', () => {
  it('only sends a typed cp_ event and coarse sync state', async () => {
    const delegate: AnalyticsDelegate = {
      setEnabled: jest.fn(async () => undefined),
      log: jest.fn(async () => undefined),
    };
    const analytics = createProductAnalytics(delegate);
    await analytics.setEnabled(true);

    await analytics.track({
      name: 'cp_cycle_log',
      params: { sync_state: 'queued' },
    });

    expect(delegate.log).toHaveBeenCalledWith('cp_cycle_log', {
      sync_state: 'queued',
    });
  });

  it('accepts all nine sharing fields but rejects impossible counts', async () => {
    const delegate: AnalyticsDelegate = {
      setEnabled: jest.fn(async () => undefined),
      log: jest.fn(async () => undefined),
    };
    const analytics = createProductAnalytics(delegate);
    await analytics.setEnabled(true);

    await analytics.track({
      name: 'cp_share_setting_update',
      params: {enabled_count: 9},
    });
    await expect(
      analytics.track({
        name: 'cp_share_setting_update',
        params: {enabled_count: 10},
      }),
    ).rejects.toThrow('allowlisted schema');
  });

  it('drops events before explicit opt-in and rejects extra sensitive keys', async () => {
    const delegate: AnalyticsDelegate = {
      setEnabled: jest.fn(async () => undefined),
      log: jest.fn(async () => undefined),
    };
    const analytics = createProductAnalytics(delegate);

    await analytics.track({ name: 'cp_onboarding_complete' });
    expect(delegate.log).not.toHaveBeenCalled();
    await analytics.setEnabled(true);
    await expect(
      analytics.track({
        name: 'cp_onboarding_complete',
        uid: 'sensitive-user',
      } as never),
    ).rejects.toThrow('allowlisted schema');
    expect(delegate.log).not.toHaveBeenCalled();
  });

  it('records only an allowlisted code and scrubbed context', async () => {
    const delegate: CrashDelegate = {
      setEnabled: jest.fn(async () => undefined),
      record: jest.fn(async () => undefined),
    };
    const reporter = createSafeCrashReporter(delegate);
    await reporter.setEnabled(true);

    await reporter.recordFailure('network-failed', {
      surface: 'daily-log',
      operation: 'save-record',
      retryable: true,
    });

    expect(delegate.record).toHaveBeenCalledWith('network-failed', {
      surface: 'daily-log',
      operation: 'save-record',
      retryable: 'true',
    });
  });

  it('rejects free-form crash operation text', async () => {
    const delegate: CrashDelegate = {
      setEnabled: jest.fn(async () => undefined),
      record: jest.fn(async () => undefined),
    };
    const reporter = createSafeCrashReporter(delegate);
    await reporter.setEnabled(true);

    await expect(
      reporter.recordFailure('unknown-failure', {
        surface: 'startup',
        operation: 'uid=user@example.com',
        retryable: false,
      }),
    ).rejects.toThrow('allowlisted slug');
    expect(delegate.record).not.toHaveBeenCalled();
  });

  it('drops crash reports before explicit opt-in', async () => {
    const delegate: CrashDelegate = {
      setEnabled: jest.fn(async () => undefined),
      record: jest.fn(async () => undefined),
    };
    const reporter = createSafeCrashReporter(delegate);

    await reporter.recordFailure('network-failed', {
      surface: 'daily-log',
      operation: 'save-record',
      retryable: true,
    });
    expect(delegate.record).not.toHaveBeenCalled();
  });
});
