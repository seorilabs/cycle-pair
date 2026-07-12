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
        periodDates: {startDate: "2026-07-01", endDate: "2026-07-05"},
        cyclePhase: "luteal",
        nextPeriodWindow: {startDate: "2026-07-20", endDate: "2026-07-22"},
        pmsWindow: {startDate: "2026-07-16", endDate: "2026-07-19"},
      },
      privateDailyLog: {
        symptomTags: ["cramps", "headache"],
        moodTag: "calm",
        carePreferences: ["warm-tea", "quiet-time"],
        privateNote: "do not leak",
      },
      shareSettings: {
        periodDates: true,
        cyclePhase: true,
        nextPeriodWindow: false,
        pmsWindow: true,
        symptomTags: true,
        moodTag: false,
        carePreferences: true,
      },
    });

    expect(projection).toEqual({
      ...baseWithSchema(),
      periodDates: {startDate: "2026-07-01", endDate: "2026-07-05"},
      cyclePhase: "luteal",
      pmsWindow: {startDate: "2026-07-16", endDate: "2026-07-19"},
      symptomTags: ["cramps", "headache"],
      carePreferences: ["warm-tea", "quiet-time"],
    });
    expect(projection).not.toHaveProperty("nextPeriodWindow");
    expect(projection).not.toHaveProperty("moodTag");
    expect(projection).not.toHaveProperty("privateNote");
  });

  test("omits invalid shared values instead of copying arbitrary content", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateCycle: {
        periodDates: {startDate: "2026-02-30", endDate: "2026-03-01"},
        cyclePhase: "free-form health note",
        nextPeriodWindow: {startDate: "tomorrow", endDate: "later"},
      },
      privateDailyLog: {
        symptomTags: ["valid-tag", "contains private prose"],
        moodTag: "contains private prose",
      },
      shareSettings: {
        periodDates: true,
        cyclePhase: true,
        nextPeriodWindow: true,
        symptomTags: true,
        moodTag: true,
      },
    });

    expect(projection).toEqual({...baseWithSchema(), symptomTags: ["valid-tag"]});
  });

  test("never exposes an ovulatory or fertility phase", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateCycle: {
        cyclePhase: "ovulatory",
      },
      shareSettings: {cyclePhase: true},
    });

    expect(projection).toEqual(baseWithSchema());
  });

  test("shares an ongoing period with an omitted end date", () => {
    const projection = buildPartnerProjection({
      ...base,
      privateCycle: {periodDates: {startDate: "2026-07-12"}},
      shareSettings: {periodDates: true},
    });

    expect(projection).toEqual({
      ...baseWithSchema(),
      periodDates: {startDate: "2026-07-12"},
    });
  });
});

function baseWithSchema() {
  return {...base, schemaVersion: 1};
}
