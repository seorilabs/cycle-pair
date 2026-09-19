/**
 * functions 쪽 배달 규칙이 product-core 정본과 갈리지 않는지 고정한다.
 *
 * functions 는 `@cyclepair/product-core` 를 의존성으로 가질 수 없다.
 * `firebase/` 가 자체 워크스페이스·lockfile 을 가진 독립 설치 단위라서
 * `workspace:*` 를 넣으면 거기서의 install 이 실패한다. 대신 테스트에서만
 * 상대 경로로 정본을 불러 같은 입력에 같은 배달일을 내는지 대조한다.
 *
 * 테스트는 `tsconfig.json` 의 `exclude` 와 `firebase.json` 의 `ignore` 에
 * 들어 있어 배포 산출물에 포함되지 않는다.
 */
import {describe, expect, test} from "vitest";

import {
  buildNeutralNotificationSchedule,
} from "../../../packages/product-core/src/domain/notifications.js";
import {
  parseLocalDate,
  addDays as addLocalDays,
} from "../../../packages/product-core/src/domain/local-date.js";
import {predictFromCycleSeed} from "../../../packages/product-core/src/domain/prediction.js";

import {
  CYCLE_REMINDER_LEAD_DAYS,
  cycleReminderDeliveryDates,
  predictedPeriodDateFor,
} from "../src/domain/cycleReminder.js";
import {neutralNotificationContent} from "../src/domain/notification.js";

function canonicalDeliveryDates(
  nextPeriodDate: string,
  today: string,
): readonly string[] {
  const prediction = predictFromCycleSeed({
    memberId: "owner",
    generatedOn: parseLocalDate(today),
    // nextPeriodDate 를 그대로 만들기 위해 시작일에서 28일을 뺀다.
    lastPeriodStart: addLocalDays(parseLocalDate(nextPeriodDate), -28),
    averageCycleLengthDays: 28,
  });
  expect(prediction.nextPeriodDate).toBe(nextPeriodDate);
  return buildNeutralNotificationSchedule({
    prediction,
    recipientIds: ["partner"],
    today: parseLocalDate(today),
    leadDays: [...CYCLE_REMINDER_LEAD_DAYS],
  }).map(item => item.deliverOn as string);
}

describe("리마인더 배달 규칙이 도메인 정본과 같다", () => {
  test("예정일 주변 전 구간에서 같은 배달일을 낸다", () => {
    const nextPeriodDate = "2026-07-29";
    for (let offset = -20; offset <= 10; offset += 1) {
      const today = addLocalDays(
        parseLocalDate(nextPeriodDate),
        offset,
      ) as string;
      expect(cycleReminderDeliveryDates(nextPeriodDate, today)).toEqual(
        canonicalDeliveryDates(nextPeriodDate, today),
      );
    }
  });

  test("lead days 가 정본 기본값과 같다", () => {
    // leadDays 를 넘기지 않으면 정본은 [3, 0] 을 쓴다.
    const prediction = predictFromCycleSeed({
      memberId: "owner",
      generatedOn: parseLocalDate("2026-07-01"),
      lastPeriodStart: parseLocalDate("2026-07-01"),
      averageCycleLengthDays: 28,
    });
    const withDefault = buildNeutralNotificationSchedule({
      prediction,
      recipientIds: ["partner"],
      today: parseLocalDate("2026-07-01"),
    }).map(item => item.deliverOn);
    const withOurs = buildNeutralNotificationSchedule({
      prediction,
      recipientIds: ["partner"],
      today: parseLocalDate("2026-07-01"),
      leadDays: [...CYCLE_REMINDER_LEAD_DAYS],
    }).map(item => item.deliverOn);

    expect(withOurs).toEqual(withDefault);
  });

  test("예정일 계산이 앱 저장 값과 같다", () => {
    for (const averageCycleLength of [15, 21, 28, 35, 60]) {
      const startDate = "2026-07-01";
      expect(
        predictedPeriodDateFor({
          periodDates: {startDate},
          averageCycleLength,
        }),
      ).toBe(addLocalDays(parseLocalDate(startDate), averageCycleLength));
    }
  });

  test("알림 문구가 정본 중립 문구와 같다", () => {
    const prediction = predictFromCycleSeed({
      memberId: "owner",
      generatedOn: parseLocalDate("2026-07-01"),
      lastPeriodStart: parseLocalDate("2026-07-01"),
      averageCycleLengthDays: 28,
    });
    const canonical = buildNeutralNotificationSchedule({
      prediction,
      recipientIds: ["partner"],
      today: parseLocalDate("2026-07-01"),
    })[0];
    const content = neutralNotificationContent("pair-update");

    expect(content.notification.title).toBe(canonical?.title);
    expect(content.notification.body).toBe(canonical?.body);
    expect(content.data.destination).toBe(canonical?.destination);
  });
});
