# Project settings

Open **Settings → Projects**. The project and machine pickers start at **All projects** and
**All machines**.

Change the default model, workspace, automatic pull, agent browser access, or actions for projects that inherit those values.
Select an individual project to override a default. Reset its row to inherit again. Changing a
default preserves explicit project overrides. Workspace preferences in `t3.json` take precedence
over machine defaults when the project has no explicit workspace override.

Select a machine to limit edits to it. **All machines** writes defaults to connected machines;
offline machines keep their previous values. Mixed values are indicated when selected machines
or checkouts disagree. Browser access changes apply when an agent session next starts.

Project grouping has a client-wide default across machines, with individual checkout overrides.
Shared actions apply to inheriting projects; editing a project's actions creates an independent list.
Reset that list to use shared actions again. Existing project actions are preserved.

Project names, icons, removal, and importing actions from a checkout remain project-specific.
When there are several checkouts, the checkout picker selects which actions and grouping to edit.

## Project icons

Choose an icon, emoji, or image from the project to make it easier to recognize. The choice applies
to selected checkouts in the project group and appears on connected clients. Choose **Automatic** to
let T3 Code detect an icon again.

## Connect a fork to its original repository

When a checkout has a Git remote named `upstream`, T3 Code automatically treats that remote as the
fork's original repository. The connection appears under **Settings → Projects → Project** and is
available on every connected client.

If the checkout does not have an `upstream` remote, enter the original repository URL in **Original
repository**. T3 Code accepts a different repository owner only when the Git host and repository
name match the current project. Remove the configured value to disconnect it.

Connected projects show **Merge original** in the web and desktop chat header and in the mobile Git
menu. Select it to add a merge instruction to the composer. The agent verifies the shared Git
history, fetches and merges the original default branch, resolves conflicts, and runs focused
checks. It stops before committing or pushing so you can review the result and ask for those steps
separately.

## Keep the default branch current

Enable **Automatically pull** to keep the default-branch checkout up to date with its configured
upstream.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.
