import forkCompatibility from "./055_ForkUpstreamSchemaCompatibility.ts";

// The upstream ledger owns ids 48-58. Preserve the fork's feature tables and
// project settings on fresh upstream databases as well as existing fork state.
export default forkCompatibility;
