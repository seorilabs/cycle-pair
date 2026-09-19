import {describe, expect, test} from "vitest";

import {buildPartnerProjection} from "../src/domain/projection.js";

const base = {
  ownerUid: "alice",
  pairId: "pair-1",
  generatedAt: "2026-07-12T00:00:00.000Z",
};

describe("buildPartnerProjection", () => {
  test("keeps every health field private by default", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateCycle: {
        periodDates: {startDate: "2026-07-01"},
        cyclePhase: "luteal",
        nextPeriodWindow: {startDate: "2026-07-20", endDate: "2026-07-22"},
        rawPeriodDates: ["2026-06-20"],
        shareSettings: {periodDates: true, cyclePhase: true},
      },
      privateDailyLog: {
        symptomTags: ["cramps"],
        moodTag: "tired",
        energyLevel: 3,
        conditionCode: "comfortable",
        note: "never copy this note",
        privateNote: "never copy this",
      },
    });

    expect(projection).toEqual(baseWithSchema());
    expect(JSON.stringify(projection)).not.toContain("never copy this");
    expect(JSON.stringify(projection)).not.toContain("rawPeriodDates");
  });

  test("materializes only explicitly enabled allowlisted keys", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateCycle: {
        asOfDate: "2026-07-12",
        periodDates: {startDate: "2026-07-01", endDate: "2026-07-05"},
        cyclePhase: "luteal",
        nextPeriodWindow: {startDate: "2026-07-20", endDate: "2026-07-22"},
      },
      privateDailyLog: {
        localDate: "2026-07-12",
        symptomTags: ["cramps", "headache"],
        moodTag: "calm",
        energyLevel: 4,
        conditionCode: "needs-space",
        carePreferences: ["warm-tea", "quiet-time"],
        note: "오늘은 조용히 쉬고 싶어요.",
        privateNote: "do not leak",
      },
      shareSettings: {
        periodDates: true,
        cyclePhase: true,
        nextPeriodWindow: false,
        symptomTags: true,
        moodTag: false,
        energyLevel: true,
        conditionCode: true,
        carePreferences: true,
        note: true,
      },
    });

    expect(projection).toEqual({
      ...baseWithSchema(),
      cycleAsOfDate: "2026-07-12",
      dailyLogDate: "2026-07-12",
      periodDates: {startDate: "2026-07-01", endDate: "2026-07-05"},
      cyclePhase: "luteal",
      symptomTags: ["cramps", "headache"],
      energyLevel: 4,
      conditionCode: "needs-space",
      carePreferences: ["warm-tea", "quiet-time"],
      note: "오늘은 조용히 쉬고 싶어요.",
    });
    expect(projection).not.toHaveProperty("nextPeriodWindow");
    expect(projection).not.toHaveProperty("moodTag");
    expect(projection).not.toHaveProperty("privateNote");
  });

  test("omits invalid shared values instead of copying arbitrary content", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateCycle: {
        asOfDate: "2026-07-12",
        periodDates: {startDate: "2026-02-30", endDate: "2026-03-01"},
        cyclePhase: "free-form health note",
        nextPeriodWindow: {startDate: "tomorrow", endDate: "later"},
      },
      privateDailyLog: {
        localDate: "2026-07-12",
        symptomTags: ["valid-tag", "contains private prose"],
        moodTag: "contains private prose",
        energyLevel: 6,
        conditionCode: "arbitrary-private-state",
        note: "x".repeat(501),
      },
      shareSettings: {
        periodDates: true,
        cyclePhase: true,
        nextPeriodWindow: true,
        symptomTags: true,
        moodTag: true,
        energyLevel: true,
        conditionCode: true,
        note: true,
      },
    });

    expect(projection).toEqual({
      ...baseWithSchema(),
      dailyLogDate: "2026-07-12",
      symptomTags: ["valid-tag"],
    });
  });

  test("removes daily fields entirely when their opt-ins are off", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateDailyLog: {
        energyLevel: 5,
        conditionCode: "comfortable",
        note: "공유하지 않는 메모",
      },
      shareSettings: {
        energyLevel: false,
        conditionCode: false,
        note: false,
      },
    });

    expect(projection).toEqual(baseWithSchema());
    expect(projection).not.toHaveProperty("energyLevel");
    expect(projection).not.toHaveProperty("conditionCode");
    expect(projection).not.toHaveProperty("note");
  });

  test("가임 동의 없이 가임 구간 값을 인접 값으로 접어 보낸다", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateCycle: {
        asOfDate: "2026-07-12",
        cyclePhase: "ovulatory",
        cycleStatus: "fertile-window",
      },
      shareSettings: {cyclePhase: true, cycleStatus: true},
    });

    // 배란기와 가임 창은 인접 값으로 접힌다. 원본 값은 나가지 않는다.
    expect(projection).toEqual({
      ...baseWithSchema(),
      cycleAsOfDate: "2026-07-12",
      cyclePhase: "follicular",
      cycleStatus: "cycle-in-progress",
    });
    expect(JSON.stringify(projection)).not.toMatch(/ovulat|fertil/i);
  });

  test("필드 존재 여부가 가임 구간인지에 따라 달라지지 않는다", () => {
    const shareSettings = {cyclePhase: true, cycleStatus: true};
    const days = [
      {cyclePhase: "menstrual", cycleStatus: "period-in-progress"},
      {cyclePhase: "follicular", cycleStatus: "cycle-in-progress"},
      {cyclePhase: "ovulatory", cycleStatus: "fertile-window"},
      {cyclePhase: "luteal", cycleStatus: "pre-period"},
    ];

    for (const day of days) {
      const projection = buildPartnerProjection({
        ...base,
        privateCycle: {asOfDate: "2026-07-12", ...day},
        shareSettings,
      }) as Record<string, unknown>;

      expect(Object.hasOwn(projection, "cyclePhase")).toBe(true);
      expect(Object.hasOwn(projection, "cycleStatus")).toBe(true);
      expect(projection.cyclePhase).not.toBe("ovulatory");
      expect(projection.cycleStatus).not.toBe("fertile-window");
    }
  });

  test("두 동의가 모두 없으면 어떤 날에도 필드가 부재한다", () => {
    const days = ["menstrual", "follicular", "ovulatory", "luteal"];

    for (const cyclePhase of days) {
      const projection = buildPartnerProjection({
        ...base,
        privateCycle: {asOfDate: "2026-07-12", cyclePhase},
        shareSettings: {moodTag: true},
      }) as Record<string, unknown>;

      expect(Object.hasOwn(projection, "cyclePhase")).toBe(false);
    }
  });

  test("가임 동의가 있으면 가임 구간 값을 그대로 전달한다", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateCycle: {
        asOfDate: "2026-07-12",
        cyclePhase: "ovulatory",
        cycleStatus: "fertile-window",
      },
      shareSettings: {
        cyclePhase: true,
        cycleStatus: true,
        fertilityStatus: true,
      },
    }) as Record<string, unknown>;

    expect(projection.cyclePhase).toBe("ovulatory");
    expect(projection.cycleStatus).toBe("fertile-window");
  });

  test("materializes fertility status only with its dedicated opt-in", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateCycle: {
        asOfDate: "2026-07-12",
        cyclePhase: "ovulatory",
        cycleStatus: "fertile-window",
      },
      shareSettings: {fertilityStatus: true},
    });

    expect(projection).toEqual({
      ...baseWithSchema(),
      cycleAsOfDate: "2026-07-12",
      cyclePhase: "ovulatory",
      cycleStatus: "fertile-window",
    });
  });

  test("materializes detailed non-fertility status only with its dedicated opt-in", () => {
    const privateCycle = {
      asOfDate: "2026-07-12",
      cyclePhase: "menstrual",
      cycleStatus: "period-ending",
    };

    expect(
      buildPartnerProjection({
        ...base,
        privateCycle,
        shareSettings: {cyclePhase: true},
      }),
    ).toEqual({
      ...baseWithSchema(),
      cycleAsOfDate: "2026-07-12",
      cyclePhase: "menstrual",
    });
    expect(
      buildPartnerProjection({
        ...base,
        privateCycle,
        shareSettings: {cycleStatus: true},
      }),
    ).toEqual({
      ...baseWithSchema(),
      cycleAsOfDate: "2026-07-12",
      cycleStatus: "period-ending",
    });
  });

  test("shares an ongoing period with an omitted end date", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateCycle: {
        asOfDate: "2026-07-12",
        periodDates: {startDate: "2026-07-12"},
      },
      shareSettings: {periodDates: true},
    });

    expect(projection).toEqual({
      ...baseWithSchema(),
      cycleAsOfDate: "2026-07-12",
      periodDates: {startDate: "2026-07-12"},
    });
  });

  test("attaches the source date to shared daily fields", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateDailyLog: {
        localDate: "2026-07-10",
        moodTag: "good",
      },
      shareSettings: {moodTag: true},
    });

    expect(projection).toEqual({
      ...baseWithSchema(),
      dailyLogDate: "2026-07-10",
      moodTag: "good",
    });
  });

  test("omits daily fields and cycle phase when source LocalDate metadata is missing", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateCycle: {cyclePhase: "luteal"},
      privateDailyLog: {moodTag: "good", note: "오래된 상태"},
      shareSettings: {cyclePhase: true, moodTag: true, note: true},
    });

    expect(projection).toEqual(baseWithSchema());
  });
});

function baseWithSchema() {
  return {...base, schemaVersion: 1};
}
