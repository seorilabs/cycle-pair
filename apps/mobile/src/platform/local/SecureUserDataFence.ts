interface UserFenceState {
  blocked: boolean;
  activeWrites: number;
  drainWaiters: Array<() => void>;
}

/**
 * Process-local privacy boundary for Keychain-backed account data.
 *
 * Account exit marks a UID blocked synchronously, waits for every write that
 * already crossed the boundary, and only then purges Keychain. A late snapshot
 * callback or offline flush therefore cannot recreate data after the purge.
 */
export class SecureUserDataFence {
  private readonly states = new Map<string, UserFenceState>();

  private state(uid: string): UserFenceState {
    const existing = this.states.get(uid);
    if (existing) return existing;
    const created: UserFenceState = {
      blocked: false,
      activeWrites: 0,
      drainWaiters: [],
    };
    this.states.set(uid, created);
    return created;
  }

  isBlocked(uid: string): boolean {
    return this.state(uid).blocked;
  }

  async runWrite<T>(uid: string, write: () => Promise<T>): Promise<T> {
    const state = this.state(uid);
    if (state.blocked) {
      throw new Error('Account session is quiesced.');
    }
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

  async blockAndDrain(uid: string): Promise<void> {
    const state = this.state(uid);
    state.blocked = true;
    if (state.activeWrites === 0) return;
    await new Promise<void>(resolve => state.drainWaiters.push(resolve));
  }

  resume(uid: string): void {
    this.state(uid).blocked = false;
  }
}

export const secureUserDataFence = new SecureUserDataFence();
