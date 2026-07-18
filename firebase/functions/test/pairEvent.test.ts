import {describe, expect, test} from "vitest";

import {
  PAIR_EVENT_NOTE_MAX_LENGTH,
  PAIR_EVENT_TITLE_MAX_LENGTH,
  PairEventValidationError,
  parsePairEventInput,
} from "../src/domain/pairEvent.js";

describe("parsePairEventInput", () => {
  test("normalizes a valid event and omits blank optional values", () => {
    expect(
      parsePairEventInput({
        id: "event_1",
        title: "  산책  ",
        date: "2026-07-14",
        startTime: "19:30",
        endTime: "20:00",
        note: "  ",
      }),
    ).toEqual({
      id: "event_1",
      title: "산책",
      date: "2026-07-14",
      startTime: "19:30",
      endTime: "20:00",
    });
  });

  test.each([
    [{id: "event_1", title: "일정", date: "2026-02-30"}],
    [{id: "event_1", title: "일정", date: "2026-07-14", startTime: "24:00"}],
    [{id: "event_1", title: "일정", date: "2026-07-14", endTime: "10:00"}],
    [
      {
        id: "event_1",
        title: "일정",
        date: "2026-07-14",
        startTime: "11:00",
        endTime: "10:00",
      },
    ],
    [
      {
        id: "event_1",
        title: "x".repeat(PAIR_EVENT_TITLE_MAX_LENGTH + 1),
        date: "2026-07-14",
      },
    ],
    [
      {
        id: "event_1",
        title: "일정",
        date: "2026-07-14",
        note: "x".repeat(PAIR_EVENT_NOTE_MAX_LENGTH + 1),
      },
    ],
  ])("rejects invalid event input %#", input => {
    expect(() => parsePairEventInput(input)).toThrow(PairEventValidationError);
  });
});
