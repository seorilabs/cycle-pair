import type {
  ActivePairMembership,
  BackendErrorHandler,
} from '../backend/CyclePairBackend';

interface ActivePairSnapshotCoordinatorOptions {
  readonly initialObservedMembership?: ActivePairMembership;
  readonly loadCachedMembership: () => Promise<ActivePairMembership | null>;
  readonly loadCachedPairIds?: () => Promise<readonly string[]>;
  readonly saveCachedMembership: (
    membership: ActivePairMembership,
  ) => Promise<void>;
  readonly clearPairData: (pairId: string) => Promise<void>;
  readonly invalidatePair: (pairId: string) => void;
  readonly onValue: (membership: ActivePairMembership | null) => void;
  readonly onError: BackendErrorHandler;
  readonly isInactive: () => boolean;
}

/**
 * Serializes device-cache maintenance behind authoritative membership
 * snapshots. Cached membership is cleanup evidence only and is never emitted
 * to the product UI.
 */
export class ActivePairSnapshotCoordinator {
  private observedMembership: ActivePairMembership | null;
  private readonly pendingCleanupPairIds = new Set<string>();
  private cacheWork: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(
    private readonly options: ActivePairSnapshotCoordinatorOptions,
  ) {
    this.observedMembership = options.initialObservedMembership ?? null;
  }

  accept(membership: ActivePairMembership | null): void {
    if (this.options.isInactive()) return;

    const generation = ++this.generation;
    const previousMembership = this.observedMembership;
    this.observedMembership = membership;

    if (
      previousMembership &&
      previousMembership.pairId !== membership?.pairId
    ) {
      this.markForCleanup(previousMembership.pairId);
    }

    // Visibility follows the authoritative snapshot immediately. Keychain
    // cleanup is intentionally not allowed to keep a revoked Pair on screen.
    this.options.onValue(membership);
    this.enqueueCacheWork(() => this.reconcileCache(membership, generation));
  }

  waitForIdle(): Promise<void> {
    return this.cacheWork;
  }

  private enqueueCacheWork(work: () => Promise<void>): void {
    this.cacheWork = this.cacheWork.then(work, work).catch(error => {
      this.options.onError(error);
    });
  }

  private markForCleanup(pairId: string): void {
    this.pendingCleanupPairIds.add(pairId);
    // Close admission synchronously, before any Keychain read or serialized
    // cleanup can yield to an in-flight Pair writer.
    this.options.invalidatePair(pairId);
  }

  private async reconcileCache(
    membership: ActivePairMembership | null,
    generation: number,
  ): Promise<void> {
    const cachedMembership = await this.options.loadCachedMembership();
    if (
      cachedMembership &&
      (!membership || cachedMembership.pairId !== membership.pairId)
    ) {
      this.markForCleanup(cachedMembership.pairId);
    }
    for (const pairId of (await this.options.loadCachedPairIds?.()) ?? []) {
      if (pairId !== membership?.pairId) this.markForCleanup(pairId);
    }

    let cleanupFailed = false;
    for (const pairId of [...this.pendingCleanupPairIds]) {
      try {
        await this.options.clearPairData(pairId);
        this.pendingCleanupPairIds.delete(pairId);
      } catch (error) {
        cleanupFailed = true;
        this.options.onError(error);
      }
    }

    if (
      membership &&
      !cleanupFailed &&
      generation === this.generation &&
      !this.options.isInactive()
    ) {
      await this.options.saveCachedMembership(membership);
    }
  }
}
