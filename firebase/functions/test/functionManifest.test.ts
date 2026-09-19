import {readFileSync} from "node:fs";

import {describe, expect, test} from "vitest";

import * as deployedFunctions from "../src/index.js";
import {
  ACCOUNT_DELETION_FINALIZER_SCHEDULE,
} from "../src/domain/accountLifecycle.js";
import {
  RETENTION_CLEANUP_SCHEDULE,
  RETENTION_CLEANUP_TIME_ZONE,
} from "../src/domain/retentionPolicy.js";
import {
  CYCLE_REMINDER_SCHEDULE,
  CYCLE_REMINDER_TIME_ZONE,
} from "../src/domain/cycleReminder.js";

interface EndpointDefinition {
  readonly scheduleTrigger?: {
    readonly schedule?: string;
    readonly timeZone?: string;
  };
}

function endpoint(value: unknown): EndpointDefinition | undefined {
  return (value as {readonly __endpoint?: EndpointDefinition}).__endpoint;
}

describe("Functions deployment manifest", () => {
  test("pins the Cloud Build Firebase database compatibility runtime", () => {
    const packageManifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {readonly overrides?: Record<string, string>};

    expect(packageManifest.overrides?.["@firebase/database-compat"]).toBe(
      "2.1.4",
    );
  });

  test("contains the bounded daily Pair retention schedule", () => {
    const endpoints = Object.entries(deployedFunctions)
      .filter(([, value]) => endpoint(value) !== undefined);
    const retentionEndpoint = endpoint(
      deployedFunctions.cleanupExpiredPairRetentionData,
    );

    expect(endpoints).toHaveLength(27);
    expect(endpoint(deployedFunctions.sendPartnerNudge)).toBeDefined();
    expect(endpoint(deployedFunctions.acknowledgePartnerNudge)).toBeDefined();
    expect(retentionEndpoint?.scheduleTrigger).toMatchObject({
      schedule: RETENTION_CLEANUP_SCHEDULE,
      timeZone: RETENTION_CLEANUP_TIME_ZONE,
    });
  });

  test("contains the daily predicted period reminder schedule", () => {
    const reminderEndpoint = endpoint(
      deployedFunctions.deliverPredictedPeriodReminder,
    );

    expect(reminderEndpoint?.scheduleTrigger).toMatchObject({
      schedule: CYCLE_REMINDER_SCHEDULE,
      timeZone: CYCLE_REMINDER_TIME_ZONE,
    });
  });

  test("contains the bounded pending account deletion finalizer", () => {
    const finalizerEndpoint = endpoint(
      deployedFunctions.finalizePendingAccountDeletions,
    );
    expect(finalizerEndpoint?.scheduleTrigger).toMatchObject({
      schedule: ACCOUNT_DELETION_FINALIZER_SCHEDULE,
    });
  });
});
