type JsonRecord = Record<string, unknown>;

const DOCUMENT_ID = /^[A-Za-z0-9_-]+$/;
const ISO_LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const PAIR_EVENT_TITLE_MAX_LENGTH = 80;
export const PAIR_EVENT_NOTE_MAX_LENGTH = 500;

export interface PairEventInput {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly note?: string;
}

export class PairEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairEventValidationError";
  }
}

function asRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PairEventValidationError("event 형식이 올바르지 않습니다.");
  }

  return value as JsonRecord;
}

function requireDocumentId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !DOCUMENT_ID.test(value)
  ) {
    throw new PairEventValidationError("event.id가 올바르지 않습니다.");
  }

  return value;
}

function requireText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new PairEventValidationError(`${field}는 문자열이어야 합니다.`);
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new PairEventValidationError(
      `${field}는 1자 이상 ${maxLength}자 이하여야 합니다.`,
    );
  }

  return normalized;
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new PairEventValidationError(`${field}는 문자열이어야 합니다.`);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  if (normalized.length > maxLength) {
    throw new PairEventValidationError(
      `${field}는 ${maxLength}자 이하여야 합니다.`,
    );
  }

  return normalized;
}

export function isIsoLocalDate(value: string): boolean {
  if (!ISO_LOCAL_DATE.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function isLocalTime(value: string): boolean {
  return LOCAL_TIME.test(value);
}

function optionalTime(value: unknown, field: string): string | undefined {
  const normalized = optionalText(value, field, 5);
  if (normalized !== undefined && !isLocalTime(normalized)) {
    throw new PairEventValidationError(`${field}은 HH:mm 형식이어야 합니다.`);
  }

  return normalized;
}

export function parsePairEventInput(value: unknown): PairEventInput {
  const event = asRecord(value);
  const id = requireDocumentId(event.id);
  const title = requireText(event.title, "event.title", PAIR_EVENT_TITLE_MAX_LENGTH);
  const date = requireText(event.date, "event.date", 10);
  const startTime = optionalTime(event.startTime, "event.startTime");
  const endTime = optionalTime(event.endTime, "event.endTime");
  const note = optionalText(event.note, "event.note", PAIR_EVENT_NOTE_MAX_LENGTH);

  if (!isIsoLocalDate(date)) {
    throw new PairEventValidationError(
      "event.date는 실제 달력에 존재하는 YYYY-MM-DD 날짜여야 합니다.",
    );
  }
  if (endTime !== undefined && startTime === undefined) {
    throw new PairEventValidationError(
      "event.endTime이 있으면 event.startTime도 필요합니다.",
    );
  }
  if (
    startTime !== undefined &&
    endTime !== undefined &&
    endTime < startTime
  ) {
    throw new PairEventValidationError(
      "event.endTime은 event.startTime보다 빠를 수 없습니다.",
    );
  }

  return {
    id,
    title,
    date,
    ...(startTime === undefined ? {} : {startTime}),
    ...(endTime === undefined ? {} : {endTime}),
    ...(note === undefined ? {} : {note}),
  };
}
