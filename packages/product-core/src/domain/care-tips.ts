import type {
  CareTip,
  CareTipRule,
  ConditionCode,
  CyclePhase,
  HelpPreference,
} from "./models.js";

export const DEFAULT_CARE_TIP_RULES: readonly CareTipRule[] = Object.freeze([
  {
    tip: {
      id: "preference-listen",
      title: "먼저 들어주세요",
      body: "해결책보다 이야기를 들어주길 원한다고 직접 공유했어요.",
    },
    priority: 100,
    match: { helpPreferences: ["listen"] },
  },
  {
    tip: {
      id: "preference-space",
      title: "혼자 쉴 시간을 존중해 주세요",
      body: "지금은 조용히 쉴 수 있도록 먼저 의사를 확인해 주세요.",
    },
    priority: 100,
    match: { helpPreferences: ["quiet-space"] },
  },
  {
    tip: {
      id: "preference-practical",
      title: "작은 일을 나눠 보세요",
      body: "상대가 원하는 실질적인 도움 한 가지를 물어보세요.",
    },
    priority: 90,
    match: { helpPreferences: ["practical-help", "meal-support"] },
  },
  {
    tip: {
      id: "preference-check-in",
      title: "부담 없이 안부를 물어보세요",
      body: "지금 필요한 것이 있는지 짧게 확인해 주세요.",
    },
    priority: 80,
    match: { helpPreferences: ["check-in"] },
  },
  {
    tip: {
      id: "preference-no-action",
      title: "표현한 선택을 존중해 주세요",
      body: "지금은 별도 행동을 원하지 않는다고 공유했어요.",
    },
    priority: 110,
    match: { helpPreferences: ["no-action"] },
  },
  {
    tip: {
      id: "condition-needs-space",
      title: "직접 공유한 상태를 우선해 주세요",
      body: "상대가 공간이 필요하다고 표현했어요. 먼저 의사를 확인해 주세요.",
    },
    priority: 80,
    match: { conditions: ["needs-space"] },
  },
  {
    tip: {
      id: "condition-low-energy",
      title: "오늘의 부담을 줄여 보세요",
      body: "에너지가 낮다고 직접 공유했어요. 일정을 조정할지 물어보세요.",
    },
    priority: 70,
    match: { conditions: ["tired", "low-energy"] },
  },
  {
    tip: {
      id: "phase-gentle-check-in",
      title: "개인차를 먼저 기억해 주세요",
      body: "예측된 정보보다 상대가 오늘 직접 공유한 상태를 우선해 주세요.",
    },
    priority: 30,
    match: { phases: ["menstrual", "follicular", "ovulatory", "luteal"] },
  },
  {
    tip: {
      id: "general-respect",
      title: "직접 물어보는 것이 가장 정확해요",
      body: "추측하지 말고 지금 원하는 배려가 있는지 확인해 보세요.",
    },
    priority: 0,
    match: { fallback: true },
  },
]);

export const DEFAULT_CARE_TIPS: readonly CareTip[] = Object.freeze(
  DEFAULT_CARE_TIP_RULES.map((rule) => Object.freeze({ ...rule.tip })),
);

export interface SelectCareTipsInput {
  readonly helpPreferences?: readonly HelpPreference[];
  readonly condition?: ConditionCode;
  readonly phase?: CyclePhase;
  readonly limit?: number;
}

function intersects<T>(left: readonly T[], right: readonly T[]): boolean {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function matchTier(rule: CareTipRule, input: SelectCareTipsInput): number {
  if (
    input.helpPreferences &&
    input.helpPreferences.length > 0 &&
    rule.match.helpPreferences &&
    intersects(input.helpPreferences, rule.match.helpPreferences)
  ) {
    return 3;
  }
  if (input.condition && rule.match.conditions?.includes(input.condition)) {
    return 2;
  }
  if (input.phase && input.phase !== "unknown" && rule.match.phases?.includes(input.phase)) {
    return 1;
  }
  if (rule.match.fallback === true) {
    return 0;
  }
  return -1;
}

export function selectCareTips(
  input: SelectCareTipsInput,
  catalog: readonly CareTipRule[] = DEFAULT_CARE_TIP_RULES,
): readonly CareTip[] {
  const limit = input.limit ?? 1;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("care tip limit must be a positive integer");
  }

  const ranked = catalog
    .map((rule) => ({ rule, tier: matchTier(rule, input) }))
    .filter((candidate) => candidate.tier >= 0);
  if (ranked.length === 0) {
    return Object.freeze([]);
  }

  const bestTier = Math.max(...ranked.map((candidate) => candidate.tier));
  return Object.freeze(
    ranked
      .filter((candidate) => candidate.tier === bestTier)
      .sort(
        (left, right) =>
          right.rule.priority - left.rule.priority ||
          left.rule.tip.id.localeCompare(right.rule.tip.id),
      )
      .slice(0, limit)
      .map((candidate) => Object.freeze({ ...candidate.rule.tip })),
  );
}
