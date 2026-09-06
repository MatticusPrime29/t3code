import * as Effect from "effect/Effect";

import branchPullRequest from "./048_ProjectionThreadBranchPullRequest.ts";
import trelloIntegration from "./048_TrelloIntegration.ts";

// Upstream and this fork both used id 48. Run both guarded migrations after
// the fork's existing ids so either history gains the missing schema without
// rewriting migration records or losing Trello data.
export default Effect.gen(function* () {
  yield* branchPullRequest;
  yield* trelloIntegration;
});
