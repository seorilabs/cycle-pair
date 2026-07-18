const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

declare const isoTimestampBrand: unique symbol;

/** A canonical UTC timestamp in `YYYY-MM-DDTHH:mm:ss.sssZ` form. */
export type IsoTimestamp = string & {
  readonly [isoTimestampBrand]: "IsoTimestamp";
};

export class InvalidIsoTimestampError extends RangeError {
  constructor(value: unknown) {
    super(`Invalid ISO timestamp: ${String(value)}`);
    this.name = "InvalidIsoTimestampError";
  }
}

export function isIsoTimestamp(value: unknown): value is IsoTimestamp {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }

  const epochMilliseconds = Date.parse(value);
  return Number.isFinite(epochMilliseconds) && new Date(epochMilliseconds).toISOString() === value;
}

export function parseIsoTimestamp(value: string): IsoTimestamp {
  if (!isIsoTimestamp(value)) {
    throw new InvalidIsoTimestampError(value);
  }
  return value;
}

export function compareIsoTimestamps(left: IsoTimestamp, right: IsoTimestamp): -1 | 0 | 1 {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
