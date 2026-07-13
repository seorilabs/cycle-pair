import { addDays, compareLocalDates } from "./local-date.js";
import type { LocalDate } from "./local-date.js";
import type {
  LocalTime,
  MemberId,
  NeutralNotificationScheduleItem,
  Prediction,
} from "./models.js";

const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_LOCAL_TIME: LocalTime = "09:00";
const NEUTRAL_TITLE = "Cycle Pair";
const NEUTRAL_BODY = "함께 확인할 업데이트가 있어요.";

export interface BuildNeutralNotificationScheduleInput {
  readonly prediction: Prediction;
  readonly recipientIds: readonly MemberId[];
  readonly today: LocalDate;
  readonly leadDays?: readonly number[];
  readonly localTime?: LocalTime;
}

function assertLocalTime(value: string): asserts value is LocalTime {
  if (!LOCAL_TIME_PATTERN.test(value)) {
    throw new RangeError("local time must use 24-hour HH:mm format");
  }
}

export function buildNeutralNotificationSchedule(
  input: BuildNeutralNotificationScheduleInput,
): readonly NeutralNotificationScheduleItem[] {
  const localTime = input.localTime ?? DEFAULT_LOCAL_TIME;
  assertLocalTime(localTime);
  const leadDays = input.leadDays ?? [3, 0];
  if (leadDays.some((value) => !Number.isInteger(value) || value < 0 || value > 30)) {
    throw new RangeError("lead days must be integers between 0 and 30");
  }

  const recipients = [...new Set(input.recipientIds)];
  if (recipients.some((recipientId) => recipientId.trim().length === 0)) {
    throw new Error("recipient id must not be empty");
  }
  const deliveryDates = [...new Set(leadDays.map((lead) => addDays(input.prediction.nextPeriodDate, -lead)))]
    .filter((date) => compareLocalDates(date, input.today) >= 0)
    .sort();

  return Object.freeze(
    recipients.flatMap((recipientId) =>
      deliveryDates.map((deliverOn) =>
        Object.freeze({
          recipientId,
          deliverOn,
          localTime,
          title: NEUTRAL_TITLE,
          body: NEUTRAL_BODY,
          destination: "home" as const,
          visibility: "private" as const,
        }),
      ),
    ),
  );
}
