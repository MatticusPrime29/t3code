import type { PreparedConnection } from "../connection/model.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { buildEnvironmentAuthHeaders } from "../state/environmentHttpAuth.ts";
import * as Effect from "effect/Effect";

export interface PreparedEnvironmentVoiceRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly credentials: RequestCredentials;
}

export const prepareEnvironmentVoiceRequest = Effect.fn(
  "clientRuntime.voiceInput.prepareEnvironmentVoiceRequest",
)(function* (input: { readonly connection: PreparedConnection; readonly url: string }) {
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const headers = yield* buildEnvironmentAuthHeaders(
    input.connection.httpAuthorization,
    "POST",
    input.url,
    signer,
  );
  return {
    headers: {
      ...(headers.authorization === undefined ? {} : { authorization: headers.authorization }),
      ...(headers.dpop === undefined ? {} : { dpop: headers.dpop }),
    },
    credentials: input.connection.httpAuthorization === null ? "include" : "omit",
  } satisfies PreparedEnvironmentVoiceRequest;
});
