/**
 * 예측일 기반 중립 리마인더.
 *
 * `packages/product-core`의 `buildNeutralNotificationSchedule()`을 직접 호출할
 * 수 없다. `firebase/`는 자체 `pnpm-workspace.yaml`과 lockfile을 가진 독립
 * 워크스페이스이고, functions가 배포 시 단독으로 설치돼야 하기 때문이다.
 * `workspace:*` 의존성을 추가하면 `firebase/`에서의 install이
 * `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`로 실패한다.
 *
 * 그래서 이 파일이 배달 규칙을 갖되, `cycleReminderContract.test.ts`가
 * product-core 원본을 읽어 두 구현이 같은 상수와 같은 규칙을 쓰는지 고정한다.
 * 저장소가 `projection.ts`(↔ `sharing.ts`), `subscription.ts`(↔
 * `entitlements.ts`)에서 쓰는 것과 같은 경계 방식이다.
 */
import {isShared} from "./projection.js";

type JsonRecord = Record<string, unknown>;

/** 매일 한 번. 조용시간은 기기별로 다시 걸러진다. */
export const CYCLE_REMINDER_SCHEDULE = "0 9 * * *";
export const CYCLE_REMINDER_TIME_ZONE = "Asia/Seoul";
/** 예정일 3일 전과 당일. product-core의 기본 leadDays와 같아야 한다. */
export const CYCLE_REMINDER_LEAD_DAYS = Object.freeze([3, 0]);
export const CYCLE_REMINDER_QUERY_LIMIT = 200;
export const CYCLE_REMINDER_CONCURRENCY = 20;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * 리마인더를 보내려면 이 중 하나에 동의해야 한다.
 *
 * 둘 다 예정일에서 파생되는 정보다. 어느 쪽도 공유하지 않기로 했다면 예정일이
 * 가까워졌다는 사실 자체를 파트너에게 알리지 않는다.
 */
const REMINDER_CONSENT_FIELDS = Object.freeze([
  "cycleStatus",
  "nextPeriodWindow",
]);

export function sharesCycleReminderFields(
  shareSettings: JsonRecord | undefined,
): boolean {
  return REMINDER_CONSENT_FIELDS.some(field => isShared(shareSettings, field));
}

function toEpochMillis(value: string): number | null {
  if (!ISO_DATE.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return null;
  // Date.parse 는 2026-02-30 같은 값을 넘겨 주므로 왕복으로 확인한다.
  return new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

function addDays(value: string, days: number): string | null {
  const millis = toEpochMillis(value);
  if (millis === null || !Number.isInteger(days)) return null;
  return new Date(millis + days * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/**
 * 저장된 주기 기록에서 다음 예정일을 복원한다.
 *
 * 앱이 `toPrivateCycleRecord()`에서 쓴 것과 같은 식이다 — 마지막 시작일 +
 * 평균 주기 길이. 도메인이 유효하다고 보는 주기 길이 범위(15~60)를 벗어나면
 * 예정일을 단정하지 않는다.
 */
export function predictedPeriodDateFor(
  privateCycle: JsonRecord | undefined,
): string | null {
  const periodDates = privateCycle?.periodDates;
  if (
    typeof periodDates !== "object" ||
    periodDates === null ||
    Array.isArray(periodDates)
  ) {
    return null;
  }
  const startDate = (periodDates as JsonRecord).startDate;
  const averageCycleLength = privateCycle?.averageCycleLength;
  if (
    typeof startDate !== "string" ||
    typeof averageCycleLength !== "number" ||
    !Number.isInteger(averageCycleLength) ||
    averageCycleLength < 15 ||
    averageCycleLength > 60
  ) {
    return null;
  }
  return addDays(startDate, averageCycleLength);
}

/**
 * 오늘이 배달일인지 판정한다.
 *
 * `buildNeutralNotificationSchedule()`과 같은 규칙이다. 예정일에서 각
 * leadDay만큼 앞선 날들 중 오늘 이후인 것만 배달일로 보고, 예정일이 이미
 * 지났으면 오늘 하루를 배달일로 본다. 그래야 지연 상태를 한 번 알린다.
 */
export function cycleReminderDeliveryDates(
  nextPeriodDate: string,
  today: string,
): readonly string[] {
  if (toEpochMillis(nextPeriodDate) === null || toEpochMillis(today) === null) {
    return [];
  }
  const candidates = [
    ...new Set(
      CYCLE_REMINDER_LEAD_DAYS.map(lead => addDays(nextPeriodDate, -lead)),
    ),
  ].filter((date): date is string => date !== null && date >= today);
  if (candidates.length > 0) return candidates.sort();
  return nextPeriodDate < today ? [today] : [];
}

export function shouldDeliverCycleReminderOn(input: {
  readonly privateCycle: JsonRecord | undefined;
  readonly shareSettings: JsonRecord | undefined;
  readonly today: string;
}): boolean {
  if (!sharesCycleReminderFields(input.shareSettings)) return false;
  const nextPeriodDate = predictedPeriodDateFor(input.privateCycle);
  if (nextPeriodDate === null) return false;
  return cycleReminderDeliveryDates(nextPeriodDate, input.today).includes(
    input.today,
  );
}

/**
 * 같은 사용자·같은 배달일에 한 번만 보내기 위한 문서 id.
 *
 * `evaluatePartnerNudgeCooldown()`이 요청 id로 중복을 막는 것과 같은 방식이다.
 */
export function cycleReminderDeliveryId(
  pairId: string,
  deliverOn: string,
): string {
  return `${pairId}_${deliverOn}`;
}
