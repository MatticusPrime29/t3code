import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PrimaryConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { prepareEnvironmentVoiceRequest } from "./environmentRequest.ts";

const target = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

function connection(
  httpAuthorization: PreparedConnection["httpAuthorization"],
): PreparedConnection {
  return {
    environmentId: target.environmentId,
    label: target.label,
    httpBaseUrl: target.httpBaseUrl,
    socketUrl: target.wsBaseUrl,
    httpAuthorization,
    target,
  };
}

it.effect("uses cookies for a same-origin environment voice request", () =>
  Effect.gen(function* () {
    const prepared = yield* prepareEnvironmentVoiceRequest({
      connection: connection(null),
      url: "https://environment.example.test/api/voice/transcriptions",
    });
    expect(prepared).toEqual({ headers: {}, credentials: "include" });
  }),
);

it.effect("creates bearer and DPoP authorization for remote voice requests", () =>
  Effect.gen(function* () {
    const bearer = yield* prepareEnvironmentVoiceRequest({
      connection: connection({ _tag: "Bearer", token: "bearer-token" }),
      url: "https://environment.example.test/api/voice/transcriptions",
    });
    expect(bearer).toEqual({
      headers: { authorization: "Bearer bearer-token" },
      credentials: "omit",
    });

    const url = "https://relay.example.test/api/voice/transcriptions";
    const dpop = yield* prepareEnvironmentVoiceRequest({
      connection: connection({ _tag: "Dpop", accessToken: "access-token" }),
      url,
    });
    expect(dpop).toEqual({
      headers: { authorization: "DPoP access-token", dpop: `POST ${url}` },
      credentials: "omit",
    });
  }).pipe(
    Effect.provideService(
      ManagedRelayDpopSigner,
      ManagedRelayDpopSigner.of({
        thumbprint: Effect.succeed("thumbprint"),
        createProof: ({ method, url }) => Effect.succeed(`${method} ${url}`),
      }),
    ),
  ),
);
