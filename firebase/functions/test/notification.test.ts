import {createHash} from "node:crypto";

import {describe, expect, test} from "vitest";

import {
  NOTIFICATION_DEVICE_LIMIT,
  NotificationValidationError,
  hasMeaningfulProjectionChange,
  isInvalidRegistrationTokenCode,
  isWithinQuietHours,
  neutralNotificationContent,
  notificationTokenHash,
  parseNotificationDeviceInput,
  parseNotificationToken,
  shouldSendEventNotification,
} from "../src/domain/notification.js";

const TOKEN = "fcm_registration_token:APA91b-test_1234567890";

describe("notification device validation", () => {
  test("accepts only the closed registration schema and canonicalizes locale", () => {
    expect(parseNotificationDeviceInput({
      token: TOKEN,
      platform: "ios",
      locale: "ko-kr",
      quietHours: {
        start: "22:00",
        end: "08:00",
        timeZone: "Asia/Seoul",
      },
    })).toEqual({
      token: TOKEN,
      platform: "ios",
      locale: "ko-KR",
      quietHours: {
        start: "22:00",
        end: "08:00",
        timeZone: "Asia/Seoul",
      },
    });
    expect(NOTIFICATION_DEVICE_LIMIT).toBe(10);
  });

  test("rejects malformed tokens, unknown fields, and invalid quiet hours", () => {
    expect(() => parseNotificationToken("short token")).toThrow(
      NotificationValidationError,
    );
    expect(() => parseNotificationDeviceInput({
      token: TOKEN,
      platform: "web",
      locale: "ko-KR",
      quietHours: {
        start: "22:00",
        end: "22:00",
        timeZone: "not-a-zone",
      },
      uid: "must-not-be-accepted",
    })).toThrow(NotificationValidationError);
  });

  test("uses a deterministic SHA-256 document identifier", () => {
    expect(notificationTokenHash(TOKEN)).toBe(
      createHash("sha256").update(TOKEN).digest("hex"),
    );
    expect(notificationTokenHash(TOKEN)).toMatch(/^[a-f0-9]{64}$/);
  });

  test("recognizes only FCM responses that require token cleanup", () => {
    expect(isInvalidRegistrationTokenCode(
      "messaging/invalid-registration-token",
    )).toBe(true);
    expect(isInvalidRegistrationTokenCode(
      "messaging/registration-token-not-registered",
    )).toBe(true);
    expect(isInvalidRegistrationTokenCode("messaging/internal-error")).toBe(
      false,
    );
  });
});

describe("quiet hours", () => {
  test("handles overnight ranges in the registered IANA time zone", () => {
    const quietHours = {
      start: "22:00",
      end: "08:00",
      timeZone: "Asia/Seoul",
    } as const;
    expect(isWithinQuietHours(
      quietHours,
      new Date("2026-07-14T14:30:00.000Z"),
    )).toBe(true); // 23:30 KST
    expect(isWithinQuietHours(
      quietHours,
      new Date("2026-07-14T23:00:00.000Z"),
    )).toBe(false); // 08:00 KST, end is exclusive
    expect(isWithinQuietHours(
      quietHours,
      new Date("2026-07-14T12:00:00.000Z"),
    )).toBe(false); // 21:00 KST
  });

  test("handles same-day ranges with an exclusive end", () => {
    const quietHours = {
      start: "12:00",
      end: "13:00",
      timeZone: "Asia/Seoul",
    } as const;
    expect(isWithinQuietHours(
      quietHours,
      new Date("2026-07-14T03:30:00.000Z"),
    )).toBe(true);
    expect(isWithinQuietHours(
      quietHours,
      new Date("2026-07-14T04:00:00.000Z"),
    )).toBe(false);
  });
});

describe("neutral notification privacy boundary", () => {
  test("notifies only a new event mutation that changed shared state", () => {
    expect(shouldSendEventNotification(false, true)).toBe(true);
    expect(shouldSendEventNotification(true, true)).toBe(false);
    expect(shouldSendEventNotification(false, false)).toBe(false);
  });

  test("ignores generatedAt and identity metadata but detects shared changes", () => {
    const before = {
      ownerUid: "alice",
      pairId: "pair-1",
      schemaVersion: 1,
      generatedAt: "2026-07-14T00:00:00.000Z",
      emotionTags: ["calm"],
    };
    expect(hasMeaningfulProjectionChange(before, {
      ...before,
      generatedAt: "2026-07-14T00:01:00.000Z",
    })).toBe(false);
    expect(hasMeaningfulProjectionChange(before, {
      ...before,
      emotionTags: ["happy"],
    })).toBe(true);
    expect(hasMeaningfulProjectionChange(before, {
      ...before,
      dailyLogDate: "2026-07-14",
    })).toBe(true);
    expect(hasMeaningfulProjectionChange(before, {
      ownerUid: "alice",
      pairId: "pair-1",
      schemaVersion: 1,
      generatedAt: "2026-07-14T00:02:00.000Z",
    })).toBe(true);
    expect(hasMeaningfulProjectionChange(undefined, {
      ownerUid: "alice",
      pairId: "pair-1",
      schemaVersion: 1,
      generatedAt: "2026-07-14T00:02:00.000Z",
    })).toBe(false);
  });

  test("emits only the three routing fields and fixed neutral copy", () => {
    const pairUpdate = neutralNotificationContent("pair-update");
    const eventUpdate = neutralNotificationContent("shared-event-update");
    const partnerNudge = neutralNotificationContent("partner-nudge");
    expect(pairUpdate).toEqual({
      notification: {
        title: "사이클 페어",
        body: "함께 확인할 업데이트가 있어요.",
      },
      data: {
        schemaVersion: "1",
        type: "pair-update",
        destination: "home",
      },
    });
    expect(eventUpdate.data).toEqual({
      schemaVersion: "1",
      type: "shared-event-update",
      destination: "calendar",
    });
    expect(partnerNudge.data).toEqual({
      schemaVersion: "1",
      type: "partner-nudge",
      destination: "home",
    });
    expect(Object.keys(eventUpdate.data).sort()).toEqual([
      "destination",
      "schemaVersion",
      "type",
    ]);
    expect(JSON.stringify([pairUpdate, eventUpdate, partnerNudge])).not.toMatch(
      /uid|pairId|health|eventId|person|period|mood|symptom|note/i,
    );
  });
});
