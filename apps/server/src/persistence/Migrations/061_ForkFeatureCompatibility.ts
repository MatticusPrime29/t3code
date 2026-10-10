import * as Effect from "effect/Effect";

import forkFeatureCompatibility from "./059_ForkFeatureCompatibility.ts";
import mcpAppModelContext from "./059_McpAppModelContext.ts";

// The fork already recorded id 59 for its features. Repair both guarded schema
// changes after the shared range without rewriting either migration ledger.
export default Effect.gen(function* () {
  yield* forkFeatureCompatibility;
  yield* mcpAppModelContext;
});
