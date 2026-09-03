# Project settings

## Customize a project icon

T3 Code selects a project icon automatically. It checks `t3.json`, common favicon and app icon
paths, and icon links in project HTML files. If it does not find an image, it chooses a built-in
icon from the project name.

To choose a different icon or emoji:

1. Open **Settings** and select **Projects**.
2. Select the project.
3. Next to **Project icon**, select **Choose icon**.
4. Search the full Lucide icon set and choose a color, or switch to **Emoji** and choose or paste
   an emoji.

To use an image from the project instead, select **Choose file**, search for an image, and select
it.

T3 Code supports SVG, PNG, ICO, JPEG, GIF, AVIF, and WebP files. The selected path applies to
each checkout in the project group and appears on your connected clients.

To use automatic detection again, select **Automatic**.

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

Turn on **Automatically pull** in a project's settings to keep its default-branch checkout current.
T3 Code checks in the background and when the server starts. It uses the branch's configured
upstream and only performs a fast-forward pull when the checkout has no working-tree changes,
untracked files, or local commits.

The pull is skipped if the checkout is on another branch, has no upstream, or contains local work.
Pull failures do not prevent the server from starting.
