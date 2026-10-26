import { secureCyclePairCache } from './SecureCyclePairCache';
import { secureOfflineMutationQueue } from './SecureOfflineMutationQueue';
import { toPrivateCycleRecord } from '../backend/backendPayloads';
import type { BackendCycleStatus } from '../backend/CyclePairBackend';
import { SENSITIVE_HEALTH_CONSENT_VERSION } from '../../domain/privacy/SensitiveHealthConsent';

// The published DTO type defines the contract; adding a state must cover both stores.
const statuses = {
  'period-starting': true,
  'period-in-progress': true,
  'period-ending': true,
  'post-period': true,
  'fertile-window': true,
  'pre-period': true,
  'cycle-in-progress': true,
  'period-late': true,
  unknown: true,
} satisfies Record<BackendCycleStatus, true>;
const cycle = toPrivateCycleRecord(
  {
    lastPeriodStart: '2026-08-02',
    averageCycleLength: 28,
    averagePeriodLength: 5,
  },
  '2026-10-01',
);
it.each(
  (Object.keys(statuses) as BackendCycleStatus[]).flatMap(status =>
    (['cache', 'queue'] as const).map(store => ({ status, store })),
  ),
)(
  'round-trips $status through $store without losing a valid setup',
  async ({ status, store }) => {
    const uid = `cycle-state-${store}-${status}`;
    const setup = {
      recordsCycle: true,
      consentAcceptedAt: '2026-08-09T00:00:00.000Z',
      consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      cycle: { ...cycle, cycleStatus: status },
    };
    try {
      if (store === 'cache') {
        await secureCyclePairCache.saveSetup(uid, setup);
        expect(await secureCyclePairCache.loadSetup(uid)).toEqual(setup);
      } else {
        await secureOfflineMutationQueue.enqueue({
          schemaVersion: 1,
          type: 'private-setup',
          uid,
          setup,
          mutationId: 'status-roundtrip',
          createdAt: '2026-10-01T00:00:00.000Z',
        });
        expect(await secureOfflineMutationQueue.listForReplay(uid)).toEqual([
          expect.objectContaining({ setup }),
        ]);
      }
    } finally {
      await secureCyclePairCache.clearUser(uid);
      await secureOfflineMutationQueue.clearUser(uid);
    }
  },
);
