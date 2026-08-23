const mockEventLog = jest.fn();

jest.mock('@apps-in-toss/framework', () => ({
  eventLog: (...args: unknown[]) => mockEventLog(...args),
}));

import {
  createAitAnalytics,
  validateAitAnalyticsEvent,
  type AitAnalyticsDelegate,
} from './analytics';

describe('AppsInToss analytics', () => {
  it('maps allowlisted events to click and impression logs', () => {
    const delegate: AitAnalyticsDelegate = { log: jest.fn() };
    const analytics = createAitAnalytics(delegate);

    analytics.track({
      name: 'cp_ait_condition_select',
      params: { group: 'condition', value: 'tired' },
    });
    analytics.track({ name: 'cp_ait_draft_restored' });

    expect(delegate.log).toHaveBeenNthCalledWith(1, {
      log_name: 'cp_ait_condition_select',
      log_type: 'click',
      params: { group: 'condition', value: 'tired' },
    });
    expect(delegate.log).toHaveBeenNthCalledWith(2, {
      log_name: 'cp_ait_draft_restored',
      log_type: 'impression',
      params: {},
    });
  });

  it('rejects unknown names, extra keys, and mismatched choice groups', () => {
    expect(() => validateAitAnalyticsEvent({ name: 'cp_ait_unknown' })).toThrow(
      'allowlisted schema',
    );
    expect(() =>
      validateAitAnalyticsEvent({
        name: 'cp_ait_share_open',
        uid: 'sensitive',
      }),
    ).toThrow('allowlisted schema');
    expect(() =>
      validateAitAnalyticsEvent({
        name: 'cp_ait_condition_select',
        params: { group: 'help', value: 'tired' },
      }),
    ).toThrow('allowlisted schema');
  });

  it('does not throw when the SDK is missing or fails synchronously', () => {
    const missing = createAitAnalytics({ log: undefined as never });
    const failing = createAitAnalytics({
      log: () => {
        throw new Error('unsupported');
      },
    });

    expect(() => missing.track({ name: 'cp_ait_share_open' })).not.toThrow();
    expect(() => failing.track({ name: 'cp_ait_share_open' })).not.toThrow();
  });

  it('handles rejected SDK promises without an unhandled rejection', async () => {
    const failing = createAitAnalytics({
      log: async () => Promise.reject(new Error('network')),
    });

    failing.track({ name: 'cp_ait_draft_cleared' });
    await Promise.resolve();
    await Promise.resolve();
  });
});
