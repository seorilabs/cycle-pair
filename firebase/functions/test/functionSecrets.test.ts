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
  it("has no IAP secret bindings after purchase retirement", () => {
    const bindings = Object.fromEntries(
      Object.entries(deployedFunctions)
        .map(([name, value]) => [name, secretNames(value)] as const)
        .filter(([, names]) => names.length > 0),
    );
    expect(bindings).toEqual({});
  });
});
