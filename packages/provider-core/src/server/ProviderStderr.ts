// @effect-diagnostics nodeBuiltinImport:off -- The excerpt sanitizer masks the home directory, which only the Node os module can resolve.
import * as NodeOS from "node:os";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

/** Last few KiB of a provider child process stderr kept for startup / exit diagnostics. */
export const PROVIDER_STDERR_TAIL_MAX_CHARS = 4_096;

/**
 * How long an exit path waits for the stderr reader to finish before reporting
 * the tail. The child is already gone, so this only covers chunks still in
 * flight; waiting longer would stall the error the user is waiting on.
 */
export const PROVIDER_STDERR_DRAIN_GRACE = "250 millis" as const;

const PAIRING_URL_PATTERN = /https?:\/\/[^\s]*\/pair#[^\s]*/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._\-+=/]+/gi;
const BASIC_AUTH_PATTERN = /\bAuthorization:\s*Basic\s+\S+/gi;
const API_KEY_HEADER_PATTERN = /\bx-api-key:\s*\S+/gi;
const SECRET_TOKEN_PATTERN =
  /\b(?:sk-[A-Za-z0-9][A-Za-z0-9-]{7,}|ghp_[A-Za-z0-9]+|xox[a-zA-Z]-[A-Za-z0-9-]+)\b/g;

export function appendProviderStderrTail(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  return next.length <= PROVIDER_STDERR_TAIL_MAX_CHARS
    ? next
    : next.slice(-PROVIDER_STDERR_TAIL_MAX_CHARS);
}

/** Bounded, redacted excerpt safe to put on user-facing adapter errors. */
export function sanitizeProviderStderrExcerpt(
  text: string,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = NodeOS.homedir(),
): string {
  let result = text.replaceAll("\0", "");
  const homes = [environment.HOME, environment.USERPROFILE, homeDirectory].filter(
    (value): value is string => typeof value === "string" && value.length > 1,
  );
  for (const home of new Set(homes)) {
    result = result.split(home).join("~");
  }
  result = result
    .replace(PAIRING_URL_PATTERN, "[pairing-url]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(BASIC_AUTH_PATTERN, "Authorization: Basic [redacted]")
    .replace(API_KEY_HEADER_PATTERN, "x-api-key: [redacted]")
    .replace(SECRET_TOKEN_PATTERN, "[redacted]");
  return result.trim();
}

/** Owns the child's stderr reader and supplies bounded diagnostics when it exits. */
export const captureProviderStderr = Effect.fn("provider.captureStderr")(function* (
  handle: Pick<ChildProcessSpawner.ChildProcessHandle, "stderr">,
  scope: Scope.Scope,
) {
  const tail = yield* Ref.make("");
  const drained = yield* Deferred.make<void>();
  yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Ref.update(tail, (current) => appendProviderStderrTail(current, chunk)),
    ),
    Effect.ensuring(Deferred.succeed(drained, undefined)),
    Effect.ignore,
    Effect.forkIn(scope),
  );
  return {
    stderrExcerpt: Deferred.await(drained).pipe(
      Effect.timeout(PROVIDER_STDERR_DRAIN_GRACE),
      Effect.ignore,
      Effect.andThen(Ref.get(tail)),
      Effect.map((text) => sanitizeProviderStderrExcerpt(text)),
    ),
  };
});
