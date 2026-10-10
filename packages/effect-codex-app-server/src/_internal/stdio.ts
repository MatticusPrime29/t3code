import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import * as CodexError from "../errors.ts";

const encoder = new TextEncoder();

export const makeChildStdio = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  Stdio.make({
    args: Effect.succeed([]),
    stdin: handle.stdout,
    stdout: () =>
      Sink.mapInput(handle.stdin, (chunk: string | Uint8Array) =>
        typeof chunk === "string" ? encoder.encode(chunk) : chunk,
      ),
    stderr: () => Sink.drain,
  });

export const makeInMemoryStdio = Effect.fn("makeInMemoryStdio")(function* () {
  const input = yield* Queue.unbounded<Uint8Array, Cause.Done<void>>();
  const output = yield* Queue.unbounded<string>();
  const decoder = new TextDecoder();

  return {
    stdio: Stdio.make({
      args: Effect.succeed([]),
      stdin: Stream.fromQueue(input),
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) =>
          Queue.offer(
            output,
            typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }),
          ),
        ),
      stderr: () => Sink.drain,
    }),
    input,
    output,
  };
});

type ChildProcessTerminationHandle = Pick<
  ChildProcessSpawner.ChildProcessHandle,
  "exitCode" | "pid"
>;

/**
 * Builds the error reported when the child goes away. `stderrExcerpt`, when
 * supplied, is read at exit time and attached to the process-exited error so
 * callers see why the child died instead of a bare exit code.
 */
export const makeTerminationError = (
  handle: ChildProcessTerminationHandle,
  stderrExcerpt?: Effect.Effect<string>,
): Effect.Effect<CodexError.CodexAppServerError> =>
  Effect.match(handle.exitCode, {
    onFailure: (cause) =>
      new CodexError.CodexAppServerTransportError({
        operation: "read-process-exit-status",
        pid: handle.pid,
        cause,
      }),
    onSuccess: (code) => new CodexError.CodexAppServerProcessExitedError({ code, pid: handle.pid }),
  }).pipe(
    Effect.flatMap((error) =>
      stderrExcerpt === undefined || error._tag !== "CodexAppServerProcessExitedError"
        ? Effect.succeed(error)
        : Effect.map(stderrExcerpt, (excerpt) =>
            excerpt.trim().length === 0
              ? error
              : new CodexError.CodexAppServerProcessExitedError({
                  ...(error.code !== undefined ? { code: error.code } : {}),
                  ...(error.pid !== undefined ? { pid: error.pid } : {}),
                  stderr: excerpt,
                }),
          ),
    ),
  );
