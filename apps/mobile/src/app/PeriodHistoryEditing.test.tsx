import React from 'react';
import { act, render } from '@testing-library/react-native';
import { CyclePairProvider, useCyclePair } from './CyclePairStore';
import { previewCyclePairBackend } from '../platform/backend/PreviewCyclePairBackend';
import type { DailyLogChange } from '../platform/backend/CyclePairBackend';
import { SENSITIVE_HEALTH_CONSENT_VERSION } from '../domain/privacy/SensitiveHealthConsent';
let current: ReturnType<typeof useCyclePair>;
function Probe() {
  current = useCyclePair();
  return null;
}
const setup = {
  recordsCycle: true,
  consentAcceptedAt: '2026-10-01T00:00:00.000Z',
  consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
  cycle: {
    asOfDate: '2026-10-27',
    averageCycleLength: 28,
    averagePeriodLength: 5,
    periodDates: { startDate: '2026-10-01', endDate: '2026-10-05' },
  },
};
async function start() {
  const backend = {
    ...previewCyclePairBackend,
    initialize: jest.fn(async () => ({
      uid: 'period-store-test',
      isAnonymous: true,
    })),
    loadPrivateSetup: jest.fn(async () => setup),
    loadCachedDailyLogs: jest.fn(async () => []),
    syncDailyLogs: jest.fn(async () => []),
    saveDailyLogChange: jest.fn(
      async (_uid: string, change: DailyLogChange, mutationId: string) => ({
        status: 'synced' as const,
        mutationId,
        log: {
          localDate: change.localDate,
          record: { note: 'latest server note', ...change.value },
        },
        setup: change.setup,
        related: [
          {
            localDate: '2026-10-05',
            log: { localDate: '2026-10-05', record: { periodEnded: true } },
          },
        ],
      }),
    ),
  };
  await render(
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
  return backend;
}
beforeEach(() =>
  jest.useFakeTimers({ now: new Date('2026-10-27T12:00:00+09:00') }),
);
afterEach(() => jest.useRealTimers());
it('edits a past marker, keeps the newest note and related end, and removes the stale summary start', async () => {
  const backend = await start();
  let saved = false;
  await act(async () => {
    saved = await current.savePeriodBoundary('2026-10-01', {
      periodStarted: false,
      periodEnded: false,
    });
  });
  expect(saved).toBe(true);
  expect(backend.saveDailyLogChange).toHaveBeenCalledWith(
    'period-store-test',
    expect.objectContaining({
      localDate: '2026-10-01',
      expected: { periodStarted: false, periodEnded: false },
      setup: expect.not.objectContaining({ cycle: expect.anything() }),
    }),
    expect.any(String),
  );
  expect(current.state.hasCycleSeed).toBe(false);
  expect(
    current.state.dailyHistory.find(e => e.localDate === '2026-10-01')?.checkIn
      .note,
  ).toBe('latest server note');
  expect(
    current.state.dailyHistory.find(e => e.localDate === '2026-10-05')?.checkIn
      .periodEnded,
  ).toBe(true);
  expect(current.state.checkIn.note).toBeUndefined();
});
it('blocks a future date without writing', async () => {
  const backend = await start();
  let saved = true;
  await act(async () => {
    saved = await current.savePeriodBoundary('2026-10-28', {
      periodStarted: true,
      periodEnded: false,
    });
  });
  expect(saved).toBe(false);
  expect(backend.saveDailyLogChange).not.toHaveBeenCalled();
});
it('keeps a failed selection and offers fresh setup and history for retry', async () => {
  const backend = await start();
  backend.saveDailyLogChange.mockRejectedValueOnce(
    Object.assign(new Error('changed'), { code: 'record-conflict' }),
  );
  await act(async () => {
    expect(
      await current.savePeriodBoundary('2026-10-01', {
        periodStarted: false,
        periodEnded: false,
      }),
    ).toBe(false);
  });
  expect(current.state.hasCycleSeed).toBe(true);
  backend.loadPrivateSetup.mockResolvedValueOnce({
    ...setup,
    cycle: {
      ...setup.cycle,
      periodDates: { startDate: '2026-10-02', endDate: '2026-10-05' },
    },
  });
  await act(async () => {
    await current.reloadPrivateHistory();
  });
  expect(current.state.seed.lastPeriodStart).toBe('2026-10-02');
});
it('keeps a queued deletion separate from a read error and permits the next ordered edit', async () => {
  const backend = await start();
  backend.saveDailyLogChange.mockResolvedValueOnce({
    status: 'queued',
    mutationId: 'queued-delete',
    log: null,
    setup,
    related: [],
  } as never);
  await act(async () => {
    expect(await current.deleteDailyLog('2026-10-27')).toBe(true);
  });
  expect(current.dailyHistoryStatus).toBe('ready');
  await act(async () => {
    expect(
      await current.saveCheckIn(
        {
          symptoms: [],
          emotions: ['happy'],
          periodStarted: false,
          periodEnded: false,
        },
        { localDate: '2026-10-27', preservePeriod: true },
      ),
    ).toBe(true);
  });
  expect(backend.saveDailyLogChange).toHaveBeenCalledTimes(2);
});
it.each(['save', 'reload'] as const)(
  'keeps an unpaired user on the selected calendar tab after %s',
  async operation => {
    await start();
    await act(async () => {
      current.setTab('calendar');
    });
    expect(current.state.activeTab).toBe('calendar');
    await act(async () => {
      if (operation === 'save')
        expect(
          await current.savePeriodBoundary('2026-10-01', {
            periodStarted: true,
            periodEnded: true,
          }),
        ).toBe(true);
      else await current.reloadPrivateHistory();
    });
    expect(current.state.activeTab).toBe('calendar');
    expect(current.state.stage).toBe('main');
  },
);
