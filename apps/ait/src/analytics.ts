import { eventLog } from '@apps-in-toss/framework';
import type {
  ConditionCode,
  HelpPreference,
} from '../../../packages/product-core/src/domain/models';
import type { ShareSheetOutcome } from './open-share-sheet';
import { CONDITION_OPTIONS, HELP_OPTIONS } from './share-draft';

export type AitAnalyticsEvent =
  | {
      readonly name: 'cp_ait_condition_select';
      readonly params: {
        readonly group: 'condition';
        readonly value: ConditionCode;
      };
    }
  | {
      readonly name: 'cp_ait_condition_select';
      readonly params: {
        readonly group: 'help';
        readonly value: HelpPreference;
      };
    }
  | { readonly name: 'cp_ait_share_open' }
  | {
      readonly name: 'cp_ait_share_result';
      readonly params: { readonly outcome: ShareSheetOutcome };
    }
  | { readonly name: 'cp_ait_draft_restored' }
  | { readonly name: 'cp_ait_draft_cleared' };

type AnalyticsLogType = 'click' | 'impression';
type AnalyticsValue = string | number | boolean | null | undefined;

export interface AitAnalyticsPayload {
  readonly log_name: AitAnalyticsEvent['name'];
  readonly log_type: AnalyticsLogType;
  readonly params: Readonly<Record<string, AnalyticsValue>>;
}

export interface AitAnalyticsDelegate {
  log(payload: AitAnalyticsPayload): Promise<void> | void;
}

export interface AitAnalytics {
  track(event: AitAnalyticsEvent): void;
}

// 허용값 원장은 화면이 실제로 보여 주는 선택지 하나다. 손으로 다시 나열하면
// 선택지를 추가할 때 한쪽만 고쳐도 아무도 잡지 못하고, 그 선택지를 고른
// 순간에만 계측이 스키마 위반이 된다.
const CONDITION_VALUES: ReadonlySet<ConditionCode> = new Set(
  CONDITION_OPTIONS.map(option => option.value),
);
const HELP_VALUES: ReadonlySet<HelpPreference> = new Set(
  HELP_OPTIONS.map(option => option.value),
);
const SHARE_OUTCOMES = new Set<ShareSheetOutcome>([
  'opened',
  'unsupported',
  'failed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function invalidEvent(): never {
  throw new Error('AIT analytics event must match the allowlisted schema.');
}

export function validateAitAnalyticsEvent(value: unknown): AitAnalyticsEvent {
  if (!isRecord(value) || typeof value.name !== 'string') invalidEvent();

  if (
    value.name === 'cp_ait_share_open' ||
    value.name === 'cp_ait_draft_restored' ||
    value.name === 'cp_ait_draft_cleared'
  ) {
    if (!hasExactKeys(value, ['name'])) invalidEvent();
    return { name: value.name };
  }

  if (!hasExactKeys(value, ['name', 'params']) || !isRecord(value.params)) {
    invalidEvent();
  }

  if (value.name === 'cp_ait_condition_select') {
    if (
      !hasExactKeys(value.params, ['group', 'value']) ||
      typeof value.params.value !== 'string'
    ) {
      invalidEvent();
    }
    if (
      value.params.group === 'condition' &&
      CONDITION_VALUES.has(value.params.value as ConditionCode)
    ) {
      return {
        name: value.name,
        params: {
          group: 'condition',
          value: value.params.value as ConditionCode,
        },
      };
    }
    if (
      value.params.group === 'help' &&
      HELP_VALUES.has(value.params.value as HelpPreference)
    ) {
      return {
        name: value.name,
        params: { group: 'help', value: value.params.value as HelpPreference },
      };
    }
    invalidEvent();
  }

  if (value.name === 'cp_ait_share_result') {
    if (
      !hasExactKeys(value.params, ['outcome']) ||
      !SHARE_OUTCOMES.has(value.params.outcome as ShareSheetOutcome)
    ) {
      invalidEvent();
    }
    return {
      name: value.name,
      params: { outcome: value.params.outcome as ShareSheetOutcome },
    };
  }

  invalidEvent();
}

function toPayload(event: AitAnalyticsEvent): AitAnalyticsPayload {
  return {
    log_name: event.name,
    log_type: event.name === 'cp_ait_draft_restored' ? 'impression' : 'click',
    params: 'params' in event ? event.params : {},
  };
}

class SafeAitAnalytics implements AitAnalytics {
  constructor(private readonly delegate: AitAnalyticsDelegate) {}

  track(event: AitAnalyticsEvent): void {
    try {
      // 검증도 try 안이다. 예전에는 밖에 있어서 스키마 위반이 그대로
      // 호출자로 올라갔고, 호출자는 전부 사용자 인터랙션 핸들러라
      // 계측 하나가 컨디션 공유 플로우를 중단시켰다.
      const validated = validateAitAnalyticsEvent(event as unknown);
      const pending = this.delegate.log(toPayload(validated));
      void pending?.catch(() => undefined);
    } catch {
      // Analytics availability must never interrupt the condition-sharing flow.
    }
  }
}

const appsInTossDelegate: AitAnalyticsDelegate = {
  log(payload) {
    if (typeof eventLog !== 'function') return;
    return eventLog(payload);
  },
};

export function createAitAnalytics(
  delegate: AitAnalyticsDelegate,
): AitAnalytics {
  return new SafeAitAnalytics(delegate);
}

export const aitAnalytics: AitAnalytics =
  createAitAnalytics(appsInTossDelegate);
