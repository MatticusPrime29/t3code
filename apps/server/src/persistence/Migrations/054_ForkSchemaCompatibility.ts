import * as Effect from "effect/Effect";

import autoPullCompatibility from "./050_ForkAutoPullCompat.ts";
import branchPullRequestCompatibility from "./051_ForkBranchPullRequestCompat.ts";
import activeOrderKeyCompatibility from "./052_ForkActiveOrderKeyCompat.ts";
import threadPullRequestsCompatibility from "./053_ForkThreadPullRequestsCompat.ts";
import threadMessageContext from "./051_ProjectionThreadMessageContext.ts";
import threadTitleState from "./052_ProjectionThreadTitleState.ts";
import pullRequestFilesViewed from "./053_PullRequestFilesViewed.ts";

// The fork and upstream independently assigned ids 48-53. Existing databases
// therefore skip the other history's migrations by number. Re-run every
// guarded schema change after both ranges so either history converges without
// rewriting migration records or dropping fork data.
export default Effect.gen(function* () {
  yield* autoPullCompatibility;
  yield* branchPullRequestCompatibility;
  yield* activeOrderKeyCompatibility;
  yield* threadPullRequestsCompatibility;
  yield* threadMessageContext;
  yield* threadTitleState;
  yield* pullRequestFilesViewed;
});
