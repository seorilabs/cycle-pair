const mockEventLog = jest.fn();

jest.mock('@apps-in-toss/framework', () => ({
  eventLog: (...args: unknown[]) => mockEventLog(...args),
}));

import {
  createAitAnalytics,
  validateAitAnalyticsEvent,
  type AitAnalyticsDelegate,
} from './analytics';
import { CONDITION_OPTIONS, HELP_OPTIONS } from './share-draft';

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

describe('계측은 어떤 입력에도 화면을 죽이지 않는다', () => {
  const invalidEvents: unknown[] = [
    null,
    undefined,
    'cp_ait_share_open',
    {},
    { name: 'unknown_event' },
    { name: 'cp_ait_share_open', params: {} },
    { name: 'cp_ait_condition_select' },
    { name: 'cp_ait_condition_select', params: { group: 'condition' } },
    {
      name: 'cp_ait_condition_select',
      params: { group: 'condition', value: '없는 선택지' },
    },
    { name: 'cp_ait_condition_select', params: { group: 'help', value: 42 } },
    { name: 'cp_ait_share_result', params: { outcome: 'nope' } },
  ];

  it.each(invalidEvents)('스키마 위반 %p 를 track 해도 throw 하지 않는다', event => {
    const delegate: AitAnalyticsDelegate = { log: jest.fn() };
    const analytics = createAitAnalytics(delegate);

    expect(() =>
      analytics.track(event as Parameters<typeof analytics.track>[0]),
    ).not.toThrow();
    expect(delegate.log).not.toHaveBeenCalled();
    // 검증 자체는 여전히 던진다. 삼키는 것은 track 뿐이다.
    expect(() => validateAitAnalyticsEvent(event)).toThrow();
  });

  it('delegate 가 던져도 throw 하지 않는다', () => {
    const delegate: AitAnalyticsDelegate = {
      log: jest.fn(() => {
        throw new Error('bridge unavailable');
      }),
    };
    const analytics = createAitAnalytics(delegate);

    expect(() =>
      analytics.track({ name: 'cp_ait_share_open' }),
    ).not.toThrow();
  });
});

describe('허용값이 화면 선택지에서 파생된다', () => {
  it('모든 컨디션 선택지가 계측을 통과한다', () => {
    const delegate: AitAnalyticsDelegate = { log: jest.fn() };
    const analytics = createAitAnalytics(delegate);

    for (const option of CONDITION_OPTIONS) {
      analytics.track({
        name: 'cp_ait_condition_select',
        params: { group: 'condition', value: option.value },
      });
    }

    expect(delegate.log).toHaveBeenCalledTimes(CONDITION_OPTIONS.length);
  });

  it('모든 도움 선택지가 계측을 통과한다', () => {
    const delegate: AitAnalyticsDelegate = { log: jest.fn() };
    const analytics = createAitAnalytics(delegate);

    for (const option of HELP_OPTIONS) {
      analytics.track({
        name: 'cp_ait_condition_select',
        params: { group: 'help', value: option.value },
      });
    }

    expect(delegate.log).toHaveBeenCalledTimes(HELP_OPTIONS.length);
  });

  it('선택지를 하나 추가하면 계측도 따라서 허용한다', () => {
    // 허용목록이 옵션 배열에서 **파생**됨을 직접 증명한다. 현재 옵션을 순회하는
    // 테스트만으로는 부족하다 — 손 나열이어도 오늘 값은 일치하므로 통과한다.
    // 선택지를 하나 늘린 상태로 모듈을 다시 읽어야 차이가 드러난다.
    jest.isolateModules(() => {
      jest.doMock('./share-draft', () => {
        const actual = jest.requireActual<typeof import('./share-draft')>(
          './share-draft',
        );
        return {
          ...actual,
          HELP_OPTIONS: [
            ...actual.HELP_OPTIONS,
            { value: 'meal-support', label: '끼니를 챙겨줘요' },
          ],
        };
      });

      // jest 의 모듈 레지스트리를 다시 타려면 동기 require 여야 한다. 동적
      // import 는 이 러너에서 --experimental-vm-modules 를 요구한다.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const reloaded = require('./analytics') as typeof import('./analytics');
      const delegate = { log: jest.fn() };
      const analytics = reloaded.createAitAnalytics(delegate);

      expect(() =>
        analytics.track({
          name: 'cp_ait_condition_select',
          params: { group: 'help', value: 'meal-support' },
        }),
      ).not.toThrow();
      expect(delegate.log).toHaveBeenCalledTimes(1);
    });
    jest.dontMock('./share-draft');
  });

  it('도메인에 있지만 화면에 없는 값은 통과시키지 않는다', () => {
    // HelpPreference 에는 meal-support 등이 더 있다. 허용목록은 화면
    // 선택지에서 파생되므로 화면에 없는 값은 스키마 위반이다.
    expect(() =>
      validateAitAnalyticsEvent({
        name: 'cp_ait_condition_select',
        params: { group: 'help', value: 'meal-support' },
      }),
    ).toThrow();
  });
});
