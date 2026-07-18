import {
  getCrashlytics,
  recordError,
  setAttributes,
  setCrashlyticsCollectionEnabled,
} from '@react-native-firebase/crashlytics';

export type CrashSurface =
  | 'startup'
  | 'auth'
  | 'daily-log'
  | 'pair'
  | 'shared-event'
  | 'notification'
  | 'purchase'
  | 'export'
  | 'account-deletion';

export type SafeFailureCode =
  | 'backend-unavailable'
  | 'permission-denied'
  | 'invalid-state'
  | 'validation-failed'
  | 'network-failed'
  | 'native-sdk-failed'
  | 'unknown-failure';

export interface SafeCrashContext {
  readonly surface: CrashSurface;
  readonly operation: string;
  readonly retryable: boolean;
}

export interface CrashDelegate {
  setEnabled(enabled: boolean): Promise<void>;
  record(code: SafeFailureCode, attributes: Readonly<Record<string, string>>): Promise<void>;
}

export interface SafeCrashReporter {
  setEnabled(enabled: boolean): Promise<void>;
  recordFailure(code: SafeFailureCode, context: SafeCrashContext): Promise<void>;
}

const SAFE_OPERATION = /^[a-z0-9-]{1,40}$/;

class ScrubbedCrashReporter implements SafeCrashReporter {
  private enabled = false;

  constructor(private readonly delegate: CrashDelegate) {}

  async setEnabled(enabled: boolean): Promise<void> {
    await this.delegate.setEnabled(enabled);
    this.enabled = enabled;
  }

  recordFailure(code: SafeFailureCode, context: SafeCrashContext): Promise<void> {
    if (
      !SAFE_CODES.has(code) ||
      !SAFE_SURFACES.has(context.surface) ||
      typeof context.retryable !== 'boolean' ||
      !SAFE_OPERATION.test(context.operation) ||
      Object.keys(context).sort().join(',') !== 'operation,retryable,surface'
    ) {
      return Promise.reject(new Error('Crash operation must be an allowlisted slug.'));
    }
    if (!this.enabled) return Promise.resolve();
    return this.delegate.record(code, {
      surface: context.surface,
      operation: context.operation,
      retryable: String(context.retryable),
    });
  }
}

const SAFE_CODES = new Set<SafeFailureCode>([
  'backend-unavailable',
  'permission-denied',
  'invalid-state',
  'validation-failed',
  'network-failed',
  'native-sdk-failed',
  'unknown-failure',
]);

const SAFE_SURFACES = new Set<CrashSurface>([
  'startup',
  'auth',
  'daily-log',
  'pair',
  'shared-event',
  'notification',
  'purchase',
  'export',
  'account-deletion',
]);

const firebaseDelegate: CrashDelegate = {
  setEnabled(enabled) {
    return setCrashlyticsCollectionEnabled(getCrashlytics(), enabled).then(
      () => undefined,
    );
  },
  async record(code, attributes) {
    const crashlytics = getCrashlytics();
    await setAttributes(crashlytics, attributes);
    recordError(crashlytics, new Error(code), `CyclePair.${code}`);
  },
};

export function createSafeCrashReporter(delegate: CrashDelegate): SafeCrashReporter {
  return new ScrubbedCrashReporter(delegate);
}

export const safeCrashReporter: SafeCrashReporter =
  createSafeCrashReporter(firebaseDelegate);

export const noopSafeCrashReporter: SafeCrashReporter = {
  async setEnabled() {},
  async recordFailure() {},
};
