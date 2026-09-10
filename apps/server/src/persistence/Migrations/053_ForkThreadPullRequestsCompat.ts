import * as Effect from "effect/Effect";

import threadPullRequests from "./050_ProjectionThreadPullRequests.ts";

// Upstream and this fork both used id 50. Re-run the guarded upstream
// migration after the fork's compatibility chain so existing databases from
// either history gain the pull-request link table without rewriting records.
export default Effect.gen(function* () {
  yield* threadPullRequests;
});
