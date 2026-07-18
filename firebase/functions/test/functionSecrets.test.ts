import {describe, expect, it} from "vitest";

import * as deployedFunctions from "../src/index.js";

interface EndpointDefinition {
  readonly secretEnvironmentVariables?: readonly {readonly key: string}[];
}

function secretNames(value: unknown): readonly string[] {
  const endpoint = (value as {readonly __endpoint?: EndpointDefinition})
    .__endpoint;
  return endpoint?.secretEnvironmentVariables?.map(secret => secret.key) ?? [];
}

describe("Gen2 function secret boundary", () => {
  it("binds Apple IAP secrets only to Apple verification paths", () => {
    const bindings = Object.fromEntries(
      Object.entries(deployedFunctions)
        .map(([name, value]) => [name, secretNames(value)] as const)
        .filter(([, names]) => names.length > 0),
    );
    const appleSecrets = [
      "APPLE_IAP_PRIVATE_KEY_BASE64",
      "APPLE_IAP_KEY_ID",
      "APPLE_IAP_ISSUER_ID",
      "APPLE_APP_ID",
      "APPLE_IAP_ROOT_CERTIFICATES_BASE64_JSON",
    ];

    expect(bindings).toEqual({
      handleAppStoreServerNotificationV2: appleSecrets,
      verifySubscriptionPurchase: appleSecrets,
    });
  });
});
