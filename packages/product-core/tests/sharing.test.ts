import { describe, expect, it } from "vitest";

import {
  createCycle,
  createCycleLog,
  createShareSettings,
  parseLocalDate,
  predictNextPeriod,
  projectForPartner,
} from "../src/index.js";

const date = parseLocalDate;

function prediction() {
  const cycles = [
    createCycle({ id: "c1", memberId: "member-a", startedOn: date("2026-05-01") }),
    createCycle({ id: "c2", memberId: "member-a", startedOn: date("2026-05-29") }),
  ];
  const value = predictNextPeriod(cycles, date("2026-06-01"));
  if (!value) {
    throw new Error("prediction fixture failed");
  }
  return value;
}

describe("partner projection", () => {
  const latestLog = createCycleLog({
    id: "log-1",
    memberId: "member-a",
    date: date("2026-06-01"),
    symptoms: ["fatigue"],
    emotions: ["anxious", "hurt"],
    energy: 2,
    condition: "cramps",
    helpPreferences: ["listen"],
    note: "private note",
  });

  it("includes only explicitly shared fields", () => {
    const settings = createShareSettings("member-a", date("2026-06-01"), {
      emotions: true,
      condition: true,
    });
    const projection = projectForPartner(
      {
        subjectMemberId: "member-a",
        asOf: date("2026-06-01"),
        cyclePhase: "luteal",
        prediction: prediction(),
        latestLog,
      },
      settings,
    );

    expect(projection).toMatchObject({
      emotions: ["anxious", "hurt"],
      condition: "cramps",
    });
    for (const privateField of [
      "cyclePhase",
      "periodDates",
      "prediction",
      "symptoms",
      "energy",
      "helpPreferences",
      "note",
    ]) {
      expect(Object.hasOwn(projection, privateField)).toBe(false);
    }
  });

  it("defaults every shareable field to private", () => {
    const settings = createShareSettings("member-a", date("2026-06-01"));
    expect(Object.values(settings.fields).every((shared) => shared === false)).toBe(true);
    const projection = projectForPartner(
      { subjectMemberId: "member-a", asOf: date("2026-06-01"), latestLog },
      settings,
    );
    expect(Object.keys(projection)).toEqual(["subjectMemberId", "asOf"]);
  });

  it("copies allowed arrays and omits missing values instead of adding undefined keys", () => {
    const settings = createShareSettings("member-a", date("2026-06-01"), {
      symptoms: true,
      helpPreferences: true,
      note: true,
    });
    const projection = projectForPartner(
      {
        subjectMemberId: "member-a",
        asOf: date("2026-06-01"),
        latestLog: createCycleLog({
          id: "log-empty",
          memberId: "member-a",
          date: date("2026-06-01"),
          symptoms: [],
        }),
      },
      settings,
    );

    expect(Object.hasOwn(projection, "symptoms")).toBe(true);
    expect(projection.symptoms).toEqual([]);
    expect(Object.hasOwn(projection, "helpPreferences")).toBe(false);
    expect(Object.hasOwn(projection, "note")).toBe(false);
  });

  it("shares only current period dates when explicitly enabled", () => {
    const currentCycle = createCycle({
      id: "private-cycle-id",
      memberId: "member-a",
      startedOn: date("2026-06-01"),
      endedOn: date("2026-06-05"),
    });
    const enabled = projectForPartner(
      {
        subjectMemberId: "member-a",
        asOf: date("2026-06-05"),
        currentCycle,
      },
      createShareSettings("member-a", date("2026-06-05"), { periodDates: true }),
    );
    expect(enabled.periodDates).toEqual({ start: "2026-06-01", end: "2026-06-05" });
    expect(JSON.stringify(enabled)).not.toContain("private-cycle-id");

    const disabled = projectForPartner(
      {
        subjectMemberId: "member-a",
        asOf: date("2026-06-05"),
        currentCycle,
      },
      createShareSettings("member-a", date("2026-06-05"), { periodDates: false }),
    );
    expect(Object.hasOwn(disabled, "periodDates")).toBe(false);
  });

  it("가임 동의 없이 배란기를 인접 국면으로 접어 보낸다", () => {
    // 값을 빼면 부재 자체가 "지금이 배란기"라는 신호가 된다. 숨기되 필드는
    // 남긴다.
    const settings = createShareSettings("member-a", date("2026-06-01"), {
      cyclePhase: true,
    });
    const projection = projectForPartner(
      {
        subjectMemberId: "member-a",
        asOf: date("2026-06-01"),
        cyclePhase: "ovulatory",
      },
      settings,
    );

    expect(Object.hasOwn(projection, "cyclePhase")).toBe(true);
    expect(projection.cyclePhase).not.toBe("ovulatory");
    expect(JSON.stringify(projection)).not.toMatch(/ovulat|fertil|배란|가임/i);
  });

  it("국면 동의만 있으면 어떤 국면에서도 필드가 존재한다", () => {
    const settings = createShareSettings("member-a", date("2026-06-01"), {
      cyclePhase: true,
    });
    const phases = ["menstrual", "follicular", "ovulatory", "luteal", "unknown"] as const;

    for (const cyclePhase of phases) {
      const projection = projectForPartner(
        { subjectMemberId: "member-a", asOf: date("2026-06-01"), cyclePhase },
        settings,
      );
      expect(Object.hasOwn(projection, "cyclePhase")).toBe(true);
    }
  });

  it("두 동의가 모두 없으면 어떤 국면에서도 필드가 부재한다", () => {
    const settings = createShareSettings("member-a", date("2026-06-01"), {
      emotions: true,
    });
    const phases = ["menstrual", "follicular", "ovulatory", "luteal", "unknown"] as const;

    for (const cyclePhase of phases) {
      const projection = projectForPartner(
        { subjectMemberId: "member-a", asOf: date("2026-06-01"), cyclePhase },
        settings,
      );
      expect(Object.hasOwn(projection, "cyclePhase")).toBe(false);
    }
  });

  it("가임 동의가 있으면 배란기를 그대로 보낸다", () => {
    const settings = createShareSettings("member-a", date("2026-06-01"), {
      cyclePhase: true,
      fertilityStatus: true,
    });
    const projection = projectForPartner(
      {
        subjectMemberId: "member-a",
        asOf: date("2026-06-01"),
        cyclePhase: "ovulatory",
      },
      settings,
    );

    expect(projection.cyclePhase).toBe("ovulatory");
  });

  it("shares the ovulatory phase only with separate fertility consent", () => {
    const settings = createShareSettings("member-a", date("2026-06-01"), {
      fertilityStatus: true,
    });
    const projection = projectForPartner(
      {
        subjectMemberId: "member-a",
        asOf: date("2026-06-01"),
        cyclePhase: "ovulatory",
      },
      settings,
    );

    expect(projection.cyclePhase).toBe("ovulatory");
  });

  it("rejects data that belongs to another member", () => {
    const settings = createShareSettings("member-a", date("2026-06-01"), { emotions: true });
    expect(() =>
      projectForPartner(
        { subjectMemberId: "member-b", asOf: date("2026-06-01"), latestLog },
        settings,
      ),
    ).toThrow("do not belong");
  });
});

describe("감정 공유", () => {
  const logWithEmotions = createCycleLog({
    id: "log-emotion",
    memberId: "member-a",
    date: parseLocalDate("2026-06-01"),
    emotions: ["anxious", "lonely"],
  });

  it("켜야만 파트너에게 전해진다", () => {
    const settings = createShareSettings("member-a", parseLocalDate("2026-06-01"), {
      emotions: true,
    });
    const projection = projectForPartner(
      {
        subjectMemberId: "member-a",
        asOf: parseLocalDate("2026-06-01"),
        latestLog: logWithEmotions,
      },
      settings,
    );
    expect(projection.emotions).toEqual(["anxious", "lonely"]);
  });

  it("기본값은 꺼져 있어 필드가 아예 없다", () => {
    const settings = createShareSettings("member-a", parseLocalDate("2026-06-01"));
    const projection = projectForPartner(
      {
        subjectMemberId: "member-a",
        asOf: parseLocalDate("2026-06-01"),
        latestLog: logWithEmotions,
      },
      settings,
    );
    expect(Object.hasOwn(projection, "emotions")).toBe(false);
  });
});
