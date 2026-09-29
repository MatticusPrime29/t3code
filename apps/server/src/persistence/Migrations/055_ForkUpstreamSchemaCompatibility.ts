import * as Effect from "effect/Effect";

import forkSchemaCompatibility from "./054_ForkSchemaCompatibility.ts";
import autoSettleDisabledAt from "./054_ProjectionThreadsAutoSettleDisabledAt.ts";

// Both histories recorded a different migration at id 54. The migrator skips
// older ids, so id 55 repeats both guarded changes for either existing history.
export default Effect.gen(function* () {
  yield* forkSchemaCompatibility;
  yield* autoSettleDisabledAt;
});
