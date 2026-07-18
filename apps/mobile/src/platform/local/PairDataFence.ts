interface PairFenceState {
  blocked: boolean;
  activeWrites: number;
  drainWaiters: Array<() => void>;
}

function pairKey(uid: string, pairId: string): string {
  return `${uid.length}:${uid}${pairId}`;
}

/**
 * Process-local irreversible fence for data belonging to a revoked Pair.
 *
 * Blocking is synchronous. Existing writers drain before cleanup continues,
 * while queued or future writers fail before they can recreate cleared data.
 */
export class PairDataFence {
  private readonly states = new Map<string, PairFenceState>();

  private state(uid: string, pairId: string): PairFenceState {
    const key = pairKey(uid, pairId);
    const existing = this.states.get(key);
    if (existing) return existing;
    const created: PairFenceState = {
      blocked: false,
      activeWrites: 0,
      drainWaiters: [],
    };
    this.states.set(key, created);
    return created;
  }

  isBlocked(uid: string, pairId: string): boolean {
    return this.state(uid, pairId).blocked;
  }

  async runWrite<T>(
    uid: string,
    pairId: string,
    write: () => Promise<T>,
  ): Promise<T> {
    const state = this.state(uid, pairId);
    if (state.blocked) throw new Error('Pair data is revoked.');
    state.activeWrites += 1;
    try {
      return await write();
    } finally {
      state.activeWrites -= 1;
      if (state.activeWrites === 0) {
        const waiters = state.drainWaiters.splice(0);
        waiters.forEach(resolve => resolve());
      }
    }
  }

  async blockAndDrain(uid: string, pairId: string): Promise<void> {
    const state = this.state(uid, pairId);
    state.blocked = true;
    if (state.activeWrites === 0) return;
    await new Promise<void>(resolve => state.drainWaiters.push(resolve));
  }
}
