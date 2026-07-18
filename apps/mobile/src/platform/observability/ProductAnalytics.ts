import {
  getAnalytics,
  logEvent,
  setAnalyticsCollectionEnabled,
} from '@react-native-firebase/analytics';

export type ProductAnalyticsEvent =
  | { readonly name: 'cp_onboarding_complete' }
  | {
      readonly name: 'cp_cycle_log';
      readonly params: { readonly sync_state: 'synced' | 'queued' };
    }
  | { readonly name: 'cp_pair_invite_created' }
  | { readonly name: 'cp_pair_connected' }
  | {
      readonly name: 'cp_share_setting_update';
      readonly params: { readonly enabled_count: number };
    }
  | { readonly name: 'cp_partner_open' }
  | { readonly name: 'cp_subscription_completed' };

export interface ProductAnalytics {
  setEnabled(enabled: boolean): Promise<void>;
  track(event: ProductAnalyticsEvent): Promise<void>;
}

export interface AnalyticsDelegate {
  setEnabled(enabled: boolean): Promise<void>;
  log(name: string, params?: Readonly<Record<string, string | number>>): Promise<void>;
}

class SafeProductAnalytics implements ProductAnalytics {
  private enabled = false;

  constructor(private readonly delegate: AnalyticsDelegate) {}

  async setEnabled(enabled: boolean): Promise<void> {
    await this.delegate.setEnabled(enabled);
    this.enabled = enabled;
  }

  async track(event: ProductAnalyticsEvent): Promise<void> {
    const validated = validateEvent(event as unknown);
    if (!this.enabled) return;
    await this.delegate.log(validated.name, validated.params);
  }
}

const PARAMETERLESS_EVENTS = new Set<string>([
  'cp_onboarding_complete',
  'cp_pair_invite_created',
  'cp_pair_connected',
  'cp_partner_open',
  'cp_subscription_completed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function validateEvent(value: unknown): {
  readonly name: string;
  readonly params?: Readonly<Record<string, string | number>>;
} {
  if (!isRecord(value) || typeof value.name !== 'string') {
    throw new Error('Analytics event must match the allowlisted schema.');
  }
  if (PARAMETERLESS_EVENTS.has(value.name)) {
    if (!hasExactKeys(value, ['name'])) {
      throw new Error('Analytics event must match the allowlisted schema.');
    }
    return { name: value.name };
  }
  if (!hasExactKeys(value, ['name', 'params']) || !isRecord(value.params)) {
    throw new Error('Analytics event must match the allowlisted schema.');
  }
  if (
    value.name === 'cp_cycle_log'
  ) {
    if (
      !hasExactKeys(value.params, ['sync_state']) ||
      (value.params.sync_state !== 'synced' && value.params.sync_state !== 'queued')
    ) {
      throw new Error('Analytics event must match the allowlisted schema.');
    }
    return {
      name: value.name,
      params: { sync_state: value.params.sync_state },
    };
  }
  if (value.name === 'cp_share_setting_update') {
    if (
      !hasExactKeys(value.params, ['enabled_count']) ||
      !Number.isInteger(value.params.enabled_count) ||
      (value.params.enabled_count as number) < 0 ||
      (value.params.enabled_count as number) > 9
    ) {
      throw new Error('Analytics event must match the allowlisted schema.');
    }
    return {
      name: value.name,
      params: { enabled_count: value.params.enabled_count as number },
    };
  }
  throw new Error('Analytics event must match the allowlisted schema.');
}

const firebaseDelegate: AnalyticsDelegate = {
  setEnabled(enabled) {
    return setAnalyticsCollectionEnabled(getAnalytics(), enabled);
  },
  log(name, params) {
    return logEvent(getAnalytics(), name, params);
  },
};

export function createProductAnalytics(delegate: AnalyticsDelegate): ProductAnalytics {
  return new SafeProductAnalytics(delegate);
}

export const productAnalytics: ProductAnalytics = createProductAnalytics(firebaseDelegate);

export const noopProductAnalytics: ProductAnalytics = {
  async setEnabled() {},
  async track() {},
};
