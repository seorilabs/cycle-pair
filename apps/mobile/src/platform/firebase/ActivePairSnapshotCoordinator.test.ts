import { ActivePairSnapshotCoordinator } from './ActivePairSnapshotCoordinator';

describe('ActivePairSnapshotCoordinator', () => {
  it('never emits cached membership and clears it after an authoritative null', async () => {
    const onValue = jest.fn();
    const invalidatePair = jest.fn();
    const clearPairData = jest.fn(async () => undefined);
    const coordinator = new ActivePairSnapshotCoordinator({
      loadCachedMembership: async () => ({
        pairId: 'revoked-pair',
        partnerUid: 'former-partner',
      }),
      saveCachedMembership: jest.fn(async () => undefined),
      clearPairData,
      invalidatePair,
      onValue,
      onError: jest.fn(),
      isInactive: () => false,
    });

    coordinator.accept(null);

    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue).toHaveBeenCalledWith(null);
    expect(clearPairData).not.toHaveBeenCalled();

    await coordinator.waitForIdle();

    expect(invalidatePair).toHaveBeenCalledWith('revoked-pair');
    expect(clearPairData).toHaveBeenCalledWith('revoked-pair');
    expect(onValue).toHaveBeenCalledTimes(1);
  });

  it('cleans the last live Pair when a restarted watcher receives null', async () => {
    const invalidatePair = jest.fn();
    const clearPairData = jest.fn(async () => undefined);
    const coordinator = new ActivePairSnapshotCoordinator({
      initialObservedMembership: {
        pairId: 'previous-live-pair',
        partnerUid: 'previous-partner',
      },
      // A prior cache write may still be in flight and therefore not visible
      // to this read yet. The last authoritative membership remains enough.
      loadCachedMembership: async () => null,
      saveCachedMembership: jest.fn(async () => undefined),
      clearPairData,
      invalidatePair,
      onValue: jest.fn(),
      onError: jest.fn(),
      isInactive: () => false,
    });

    coordinator.accept(null);

    expect(invalidatePair).toHaveBeenCalledWith('previous-live-pair');
    await coordinator.waitForIdle();
    expect(clearPairData).toHaveBeenCalledWith('previous-live-pair');
  });

  it('membership pointer가 없어도 encrypted queue/cache의 Pair ID를 정리한다', async () => {
    const invalidatePair = jest.fn();
    const clearPairData = jest.fn(async () => undefined);
    const coordinator = new ActivePairSnapshotCoordinator({
      loadCachedMembership: async () => null,
      loadCachedPairIds: async () => ['orphaned-pair'],
      saveCachedMembership: jest.fn(async () => undefined),
      clearPairData,
      invalidatePair,
      onValue: jest.fn(),
      onError: jest.fn(),
      isInactive: () => false,
    });

    coordinator.accept(null);
    await coordinator.waitForIdle();

    expect(invalidatePair).toHaveBeenCalledWith('orphaned-pair');
    expect(clearPairData).toHaveBeenCalledWith('orphaned-pair');
  });

  it('hides an active Pair before its slow local cleanup completes', async () => {
    let releaseCleanup: (() => void) | undefined;
    let markCleanupStarted: (() => void) | undefined;
    const cleanupStarted = new Promise<void>(resolve => {
      markCleanupStarted = resolve;
    });
    const clearPairData = jest.fn(
      () =>
        new Promise<void>(resolve => {
          markCleanupStarted?.();
          releaseCleanup = resolve;
        }),
    );
    const onValue = jest.fn();
    const coordinator = new ActivePairSnapshotCoordinator({
      loadCachedMembership: async () => ({
        pairId: 'pair-a',
        partnerUid: 'partner-a',
      }),
      saveCachedMembership: jest.fn(async () => undefined),
      clearPairData,
      invalidatePair: jest.fn(),
      onValue,
      onError: jest.fn(),
      isInactive: () => false,
    });

    coordinator.accept({ pairId: 'pair-a', partnerUid: 'partner-a' });
    await coordinator.waitForIdle();
    coordinator.accept(null);

    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(clearPairData).not.toHaveBeenCalled();

    await cleanupStarted;
    expect(clearPairData).toHaveBeenCalledWith('pair-a');
    releaseCleanup?.();
    await coordinator.waitForIdle();
  });

  it('reports cleanup failure, keeps the Pair hidden, and retries on the next snapshot', async () => {
    const cleanupError = new Error('Keychain unavailable');
    const clearPairData = jest
      .fn<Promise<void>, [string]>()
      .mockRejectedValueOnce(cleanupError)
      .mockResolvedValue(undefined);
    const onValue = jest.fn();
    const onError = jest.fn();
    const saveCachedMembership = jest.fn(async () => undefined);
    const coordinator = new ActivePairSnapshotCoordinator({
      loadCachedMembership: async () => ({
        pairId: 'revoked-pair',
        partnerUid: 'former-partner',
      }),
      saveCachedMembership,
      clearPairData,
      invalidatePair: jest.fn(),
      onValue,
      onError,
      isInactive: () => false,
    });

    coordinator.accept(null);
    await coordinator.waitForIdle();

    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(onError).toHaveBeenCalledWith(cleanupError);
    expect(clearPairData).toHaveBeenCalledTimes(1);

    coordinator.accept(null);
    expect(onValue).toHaveBeenLastCalledWith(null);
    await coordinator.waitForIdle();

    expect(clearPairData).toHaveBeenCalledTimes(2);
    expect(saveCachedMembership).not.toHaveBeenCalled();
  });

  it('clears a different cached Pair before caching a new live Pair', async () => {
    const order: string[] = [];
    const coordinator = new ActivePairSnapshotCoordinator({
      loadCachedMembership: async () => ({
        pairId: 'old-pair',
        partnerUid: 'old-partner',
      }),
      saveCachedMembership: async membership => {
        order.push(`save:${membership.pairId}`);
      },
      clearPairData: async pairId => {
        order.push(`clear:${pairId}`);
      },
      invalidatePair: jest.fn(),
      onValue: jest.fn(),
      onError: jest.fn(),
      isInactive: () => false,
    });

    coordinator.accept({ pairId: 'new-pair', partnerUid: 'new-partner' });
    await coordinator.waitForIdle();

    expect(order).toEqual(['clear:old-pair', 'save:new-pair']);
  });
});
