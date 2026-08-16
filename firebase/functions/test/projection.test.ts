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

  test("keeps fertility-derived values private without separate consent", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateCycle: {
        asOfDate: "2026-07-12",
        cyclePhase: "ovulatory",
        cycleStatus: "fertile-window",
      },
      shareSettings: {cyclePhase: true},
    });

    expect(projection).toEqual(baseWithSchema());
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
