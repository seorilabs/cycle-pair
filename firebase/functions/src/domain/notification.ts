import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";

type JsonRecord = Record<string, unknown>;

export const NOTIFICATION_SCHEMA_VERSION = 1;
export const NOTIFICATION_DEVICE_LIMIT = 10;

export type NotificationPlatform = "android" | "ios";
export type NeutralNotificationType = "pair-update" | "shared-event-update";
export type NeutralNotificationDestination = "home" | "calendar";

export interface QuietHours {
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
}

export interface NotificationDeviceInput {
  readonly token: string;
  readonly platform: NotificationPlatform;
  readonly locale: string;
  readonly quietHours: QuietHours;
}

export interface NeutralNotificationData {
  readonly schemaVersion: "1";
  readonly type: NeutralNotificationType;
  readonly destination: NeutralNotificationDestination;
}

export interface NeutralNotificationContent {
  readonly notification: {
    readonly title: "사이클 페어";
    readonly body: "함께 확인할 업데이트가 있어요.";
  };
  readonly data: NeutralNotificationData;
}

export class NotificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationValidationError";
  }
}

const TOKEN = /^[A-Za-z0-9_:~.-]+$/;
const LOCALE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TIME_ZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+/-]+)+$/;
const PROJECTION_CONTENT_FIELDS = [
  "cycleAsOfDate",
  "dailyLogDate",
  "periodDates",
  "cyclePhase",
  "nextPeriodWindow",
  "symptomTags",
  "moodTag",
  "energyLevel",
  "conditionCode",
  "carePreferences",
  "note",
] as const;

function asExactRecord(
  value: unknown,
  fields: readonly string[],
  name: string,
): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NotificationValidationError(`${name} 형식이 올바르지 않습니다.`);
  }
  const record = value as JsonRecord;
  const keys = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new NotificationValidationError(`${name} 형식이 올바르지 않습니다.`);
  }
  return record;
}

function requireToken(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 20 ||
    value.length > 4_096 ||
    !TOKEN.test(value)
  ) {
    throw new NotificationValidationError("알림 토큰이 올바르지 않습니다.");
  }
  return value;
}

function canonicalLocale(value: unknown): string {
  if (typeof value !== "string" || value.length > 35 || !LOCALE.test(value)) {
    throw new NotificationValidationError("locale이 올바르지 않습니다.");
  }
  try {
    const canonical = Intl.getCanonicalLocales(value);
    if (canonical.length !== 1) {
      throw new Error("locale count");
    }
    return canonical[0]!;
  } catch {
    throw new NotificationValidationError("locale이 올바르지 않습니다.");
  }
}

function canonicalTimeZone(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !TIME_ZONE.test(value)
  ) {
    throw new NotificationValidationError("timeZone이 올바르지 않습니다.");
  }
  try {
    return new Intl.DateTimeFormat("en-US", {timeZone: value})
      .resolvedOptions().timeZone;
  } catch {
    throw new NotificationValidationError("timeZone이 올바르지 않습니다.");
  }
}

export function parseNotificationToken(value: unknown): string {
  return requireToken(value);
}

export function parseNotificationDeviceInput(
  value: unknown,
): NotificationDeviceInput {
  const data = asExactRecord(
    value,
    ["token", "platform", "locale", "quietHours"],
    "알림 기기",
  );
  const quietHours = asExactRecord(
    data.quietHours,
    ["start", "end", "timeZone"],
    "quietHours",
  );
  const platform = data.platform;
  if (platform !== "android" && platform !== "ios") {
    throw new NotificationValidationError("platform이 올바르지 않습니다.");
  }
  const start = quietHours.start;
  const end = quietHours.end;
  if (
    typeof start !== "string" ||
    typeof end !== "string" ||
    !LOCAL_TIME.test(start) ||
    !LOCAL_TIME.test(end) ||
    start === end
  ) {
    throw new NotificationValidationError("quietHours 시간이 올바르지 않습니다.");
  }

  return {
    token: requireToken(data.token),
    platform,
    locale: canonicalLocale(data.locale),
    quietHours: {
      start,
      end,
      timeZone: canonicalTimeZone(quietHours.timeZone),
    },
  };
}

export function notificationTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isInvalidRegistrationTokenCode(code: unknown): boolean {
  return code === "messaging/invalid-registration-token" ||
    code === "messaging/registration-token-not-registered";
}

export function shouldSendEventNotification(
  alreadyApplied: boolean,
  sharedStateChanged: boolean,
): boolean {
  return !alreadyApplied && sharedStateChanged;
}

function timeToMinute(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}

export function isWithinQuietHours(
  quietHours: QuietHours,
  at: Date,
): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: quietHours.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find(part => part.type === "hour")?.value);
  const minute = Number(parts.find(part => part.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return true;
  }
  const current = hour * 60 + minute;
  const start = timeToMinute(quietHours.start);
  const end = timeToMinute(quietHours.end);
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

function projectionContent(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const record = value as JsonRecord;
  return Object.fromEntries(
    PROJECTION_CONTENT_FIELDS.flatMap(field =>
      Object.hasOwn(record, field) ? [[field, record[field]]] : [],
    ),
  );
}

export function hasMeaningfulProjectionChange(
  before: unknown,
  after: unknown,
): boolean {
  return !isDeepStrictEqual(
    projectionContent(before),
    projectionContent(after),
  );
}

export function neutralNotificationData(
  type: NeutralNotificationType,
): NeutralNotificationData {
  return type === "pair-update"
    ? {schemaVersion: "1", type, destination: "home"}
    : {schemaVersion: "1", type, destination: "calendar"};
}

export function neutralNotificationContent(
  type: NeutralNotificationType,
): NeutralNotificationContent {
  return {
    notification: {
      title: "사이클 페어",
      body: "함께 확인할 업데이트가 있어요.",
    },
    data: neutralNotificationData(type),
  };
}
