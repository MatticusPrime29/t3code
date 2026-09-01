import type { ProjectOriginalRepository } from "@t3tools/contracts";

export function buildMergeOriginalPrompt(repository: ProjectOriginalRepository): string {
  const source =
    repository.source === "detected"
      ? `the \`${repository.remoteName}\` remote (${repository.remoteUrl})`
      : `the configured original repository (${repository.remoteUrl})`;
  return `Bring this fork up to date with ${source}. First verify that it shares Git history with this repository; if it does not, stop and explain the incompatibility. Fetch the original repository's latest default branch, merge it into the current branch, and resolve any merge conflicts carefully while preserving the changes made in this fork. Run focused verification for the affected code. Do not commit or push anything; stop after the merge and conflict resolution, then summarize what changed and any decisions you made so I can review it.`;
}
