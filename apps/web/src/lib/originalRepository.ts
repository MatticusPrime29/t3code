import type { ProjectOriginalRepository, RepositoryIdentity } from "@t3tools/contracts";
import {
  detectSourceControlProviderFromGitRemoteUrl,
  normalizeGitRemoteUrl,
} from "@t3tools/shared/git";
export { buildMergeOriginalPrompt } from "@t3tools/client-runtime/original-repository";

export type OriginalRepositoryValidation =
  | { readonly ok: true; readonly repository: ProjectOriginalRepository }
  | { readonly ok: false; readonly message: string };

function repositoryCoordinates(remoteUrl: string) {
  const canonical = normalizeGitRemoteUrl(remoteUrl);
  const [host, ...path] = canonical.split("/");
  return host && path.length >= 2 ? { canonical, host, name: path.at(-1) ?? "" } : null;
}

/**
 * Manual connections stay deliberately conservative. A fork can change owner,
 * but it remains on the same forge and normally keeps the repository name.
 */
export function validateConfiguredOriginalRepository(
  repositoryIdentity: RepositoryIdentity | null | undefined,
  remoteUrl: string,
): OriginalRepositoryValidation {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return { ok: false, message: "Enter the original repository URL." };
  if (!repositoryIdentity) {
    return {
      ok: false,
      message: "T3 Code cannot verify this project because it has no Git remote.",
    };
  }
  if (!detectSourceControlProviderFromGitRemoteUrl(trimmed)) {
    return { ok: false, message: "Enter a supported Git repository URL." };
  }

  const current = repositoryCoordinates(repositoryIdentity.locator.remoteUrl);
  const original = repositoryCoordinates(trimmed);
  if (!current || !original) {
    return { ok: false, message: "Enter a complete Git repository URL." };
  }
  if (current.canonical === original.canonical) {
    return { ok: false, message: "The original must be different from this repository." };
  }
  if (current.host !== original.host || current.name !== original.name) {
    return {
      ok: false,
      message: "The original must use the same Git host and repository name.",
    };
  }

  return {
    ok: true,
    repository: { remoteName: "upstream", remoteUrl: trimmed, source: "configured" },
  };
}
