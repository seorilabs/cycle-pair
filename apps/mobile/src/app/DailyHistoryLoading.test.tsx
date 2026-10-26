import React from 'react';
import { act, render } from '@testing-library/react-native';
import { CyclePairProvider, useCyclePair } from './CyclePairStore';
import { previewCyclePairBackend } from '../platform/backend/PreviewCyclePairBackend';
import type { PrivateDailyLogSnapshot } from '../platform/backend/CyclePairBackend';
import { SENSITIVE_HEALTH_CONSENT_VERSION } from '../domain/privacy/SensitiveHealthConsent';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let current: ReturnType<typeof useCyclePair>;
function Probe() {
  current = useCyclePair();
  return null;
}

async function start(cached: readonly PrivateDailyLogSnapshot[] = []) {
  const pending = deferred<readonly PrivateDailyLogSnapshot[]>();
  const backend = {
    ...previewCyclePairBackend,
    initialize: jest.fn(async () => ({
      uid: 'loading-test',
      isAnonymous: true,
    })),
    loadPrivateSetup: jest.fn(async () => ({
      recordsCycle: false,
      consentAcceptedAt: new Date().toISOString(),
      consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
    })),
    loadCachedDailyLogs: jest.fn(async () => cached),
    syncDailyLogs: jest.fn(() => pending.promise),
    saveDailyLog: jest.fn(),
  };
  const view = await render(
    <CyclePairProvider
      backend={backend}
      storage={{
        read: async () => null,
        write: async () => {},
        clear: async () => {},
      }}
    >
      <Probe />
    </CyclePairProvider>,
  );
  expect(backend.syncDailyLogs).toHaveBeenCalledTimes(1);
  return { pending, backend, view };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('offers recovery after 15 seconds and restores a late server record without allowing an overwrite', async () => {
  const { pending, backend } = await start();
  expect(current.dailyHistoryStatus).toBe('loading');
  await act(async () => {
    jest.advanceTimersByTime(14_999);
  });
  expect(current.dailyHistoryStatus).toBe('loading');
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(current.dailyHistoryStatus).toBe('slow');
  await act(async () => {
    await current.saveCheckIn({
      symptoms: [],
      periodStarted: false,
      periodEnded: false,
      note: 'must not replace server note',
    });
  });
  expect(backend.saveDailyLog).not.toHaveBeenCalled();
  const localDate = current.state.currentLocalDate;
  await act(async () => {
    pending.resolve([{ localDate, record: { note: 'existing server note' } }]);
  });
  expect(current.dailyHistoryStatus).toBe('ready');
  expect(current.state.dailyHistory[0]?.checkIn.note).toBe(
    'existing server note',
  );
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  expect(current.dailyHistoryStatus).toBe('ready');
});

it('retries a slow read, shows feedback again, and recovers when that read completes', async () => {
  const { pending, backend } = await start();
  await act(async () => {
    jest.advanceTimersByTime(15_000);
  });
  let retry!: Promise<void>;
  await act(async () => {
    retry = current.retryDailyHistory();
  });
  expect(current.dailyHistoryStatus).toBe('loading');
  expect(backend.syncDailyLogs).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(15_000);
  });
  expect(current.dailyHistoryStatus).toBe('slow');
  await act(async () => {
    pending.resolve([]);
    await retry;
  });
  expect(current.dailyHistoryStatus).toBe('ready');
});

it('keeps a cached record for today available during a long read', async () => {
  const date = new Date();
  const localDate = `${date.getFullYear()}-${String(
    date.getMonth() + 1,
  ).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  await start([{ localDate, record: { note: 'cached note' } }]);
  expect(current.dailyHistoryStatus).toBe('ready');
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  expect(current.dailyHistoryStatus).toBe('ready');
  expect(current.state.dailyHistory[0]?.checkIn.note).toBe('cached note');
});

it('shows the existing error recovery when the delayed read rejects', async () => {
  const { pending, backend } = await start();
  await act(async () => {
    jest.advanceTimersByTime(15_000);
  });
  await act(async () => {
    pending.reject(new Error('read unavailable'));
  });
  expect(current.dailyHistoryStatus).toBe('error');
  backend.syncDailyLogs.mockResolvedValueOnce([]);
  await act(async () => {
    await current.retryDailyHistory();
  });
  expect(current.dailyHistoryStatus).toBe('ready');
});

it('cleans up its waiting timer when the provider unmounts', async () => {
  const scheduled = jest.spyOn(global, 'setTimeout');
  const cleared = jest.spyOn(global, 'clearTimeout');
  const { view } = await start();
  const index = scheduled.mock.calls.findIndex(([, delay]) => delay === 15_000);
  expect(index).toBeGreaterThanOrEqual(0);
  const timer = scheduled.mock.results[index]!.value;
  await view.unmount();
  expect(cleared).toHaveBeenCalledWith(timer);
});
