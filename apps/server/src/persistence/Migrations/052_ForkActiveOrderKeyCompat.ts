import * as Effect from "effect/Effect";

import originalRepository from "./049_ProjectionProjectOriginalRepository.ts";
import activeOrderKey from "./049_ProjectionThreadsActiveOrderKey.ts";

// Both histories used id 49. Apply both guarded migrations after the fork's
// existing ids so neither schema change is skipped on an existing database.
export default Effect.gen(function* () {
  yield* originalRepository;
  yield* activeOrderKey;
});
