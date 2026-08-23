import { describe, expect, it } from "vitest";

import {
  buildNeutralNotificationSchedule,
  createCycle,
  parseLocalDate,
  predictNextPeriod,
  selectCareTips,
} from "../src/index.js";
import type { LocalTime } from "../src/index.js";

const date = parseLocalDate;

function prediction() {
  const value = predictNextPeriod(
    [
      createCycle({ id: "c1", memberId: "member-a", startedOn: date("2026-05-01") }),
      createCycle({ id: "c2", memberId: "member-a", startedOn: date("2026-05-29") }),
    ],
    date("2026-06-01"),
  );
  if (!value) {
    throw new Error("prediction fixture failed");
  }
  return value;
}

describe("care-tip selection", () => {
  it("prioritizes explicit help preference over condition and phase", () => {
    const tips = selectCareTips({
      helpPreferences: ["listen"],
      condition: "low-energy",
      phase: "luteal",
    });
    expect(tips[0]?.id).toBe("preference-listen");
  });

  it("prioritizes self-reported condition over an estimated phase", () => {
    const tips = selectCareTips({ condition: "needs-space", phase: "menstrual" });
    expect(tips[0]?.id).toBe("condition-needs-space");
  });

  it("uses phase then general fallback when direct reports are absent", () => {
    expect(selectCareTips({ phase: "luteal" })[0]?.id).toBe("phase-gentle-check-in");
    expect(selectCareTips({ phase: "unknown" })[0]?.id).toBe("general-respect");
  });

  it("returns display-safe tips without fertility matching metadata", () => {
    const tip = selectCareTips({ phase: "ovulatory" })[0];
    expect(tip).toEqual({
      id: "phase-gentle-check-in",
      title: "개인차를 먼저 기억해 주세요",
      body: "예측된 정보보다 상대가 오늘 직접 공유한 상태를 우선해 주세요.",
    });
    expect(Object.hasOwn(tip ?? {}, "match")).toBe(false);
    expect(JSON.stringify(tip)).not.toMatch(/ovulat|fertil|배란|가임/i);
  });
});

describe("neutral notification schedule", () => {
  it("schedules lead and due-day reminders with neutral private content", () => {
    const schedule = buildNeutralNotificationSchedule({
      prediction: prediction(),
      recipientIds: ["member-b", "member-b"],
      today: date("2026-06-20"),
    });

    expect(schedule).toHaveLength(2);
    expect(schedule.map((item) => item.deliverOn)).toEqual(["2026-06-23", "2026-06-26"]);
    expect(schedule.every((item) => item.title === "사이클 페어")).toBe(true);
    expect(schedule.every((item) => item.visibility === "private")).toBe(true);
    expect(schedule.every((item) => item.destination === "home")).toBe(true);
    expect(JSON.stringify(schedule)).not.toMatch(/생리|PMS|증상|주기|ovulat|fertil|배란|가임/i);
  });

  it("drops past reminders and validates local time", () => {
    const schedule = buildNeutralNotificationSchedule({
      prediction: prediction(),
      recipientIds: ["member-b"],
      today: date("2026-06-25"),
    });
    expect(schedule.map((item) => item.deliverOn)).toEqual(["2026-06-26"]);

    expect(() =>
      buildNeutralNotificationSchedule({
        prediction: prediction(),
        recipientIds: ["member-b"],
        today: date("2026-06-20"),
        localTime: "25:00" as LocalTime,
      }),
    ).toThrow("HH:mm");
  });

  it("keeps one neutral reminder today after the predicted date has passed", () => {
    const schedule = buildNeutralNotificationSchedule({
      prediction: prediction(),
      recipientIds: ["member-b"],
      today: date("2026-07-03"),
    });

    expect(schedule).toHaveLength(1);
    expect(schedule[0]?.deliverOn).toBe("2026-07-03");
    expect(schedule[0]?.body).toBe("함께 확인할 업데이트가 있어요.");
  });
});
