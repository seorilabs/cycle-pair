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
    mood: "low",
    energy: 2,
    condition: "low-energy",
    helpPreferences: ["listen"],
    note: "private note",
  });

  it("includes only explicitly shared fields", () => {
    const settings = createShareSettings("member-a", date("2026-06-01"), {
      mood: true,
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

    expect(projection).toMatchObject({ mood: "low", condition: "low-energy" });
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

  it("never exposes the internal ovulatory phase in the MVP projection", () => {
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

    expect(Object.hasOwn(projection, "cyclePhase")).toBe(false);
    expect(JSON.stringify(projection)).not.toMatch(/ovulat|fertil|배란|가임/i);
  });

  it("rejects data that belongs to another member", () => {
    const settings = createShareSettings("member-a", date("2026-06-01"), { mood: true });
    expect(() =>
      projectForPartner(
        { subjectMemberId: "member-b", asOf: date("2026-06-01"), latestLog },
        settings,
      ),
    ).toThrow("do not belong");
  });
});
