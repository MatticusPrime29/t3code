import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { captureProviderStderr, PROVIDER_STDERR_TAIL_MAX_CHARS } from "./ProviderStderr.ts";

it.effect("drains stderr and returns bounded, redacted process diagnostics", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const { stderrExcerpt } = yield* captureProviderStderr(
        {
          stderr: Stream.make(
            new TextEncoder().encode(
              `${"x".repeat(8192)}\nInvalid config: sk-proj-abcdefghijklmnopqrstuvwxyz012345`,
            ),
          ),
        },
        scope,
      );
      const excerpt = yield* stderrExcerpt;
      assert.isAtMost(excerpt.length, PROVIDER_STDERR_TAIL_MAX_CHARS);
      assert.include(excerpt, "Invalid config: [redacted]");
      assert.notInclude(excerpt, "sk-proj-");
    }),
  ),
);
