---
title: "Releasing packages"
description: "Tags, trusted publishing and what a new publishable workspace needs."
---

Two workspaces are published to npm:

| Workspace | Package | Tags |
| --- | --- | --- |
| `packages/git-fs-s3` | `git-fs-s3` | `git-fs-s3@v*` |
| `packages/git-edge` | `git-edge` | `git-edge@v*` |

Everything else is private: it deploys from the repository.

## Cutting a release

Bump the version, move the changelog's `unreleased` heading to the version and
date, commit, then push an **annotated** tag — `git tag -m "git-fs-s3 v0.16.0"
git-fs-s3@v0.16.0`, then `git push origin <tag>`; the repository's git
configuration rejects message-less tags.

`.github/workflows/release-packages.yml` resolves the tag's package name to its
workspace, verifies it against `package.json`, runs typecheck/test/build for
that filter, packs (rewriting `workspace:*` ranges), publishes with
`--provenance` and opens a GitHub release; a version mismatch fails before
anything is packed.

**Never delete or move a pushed tag.** A published version cannot be
re-published; release a new patch instead.

## Trusted publishing, not tokens

The workflow holds no `NPM_TOKEN`: each package's npm settings name this
repository and `release-packages.yml`, and the run authenticates through OIDC,
so npm attaches a provenance attestation pointing at the exact commit and
workflow. Because no token exists, `setup-node` runs without `registry-url` (a
generated `.npmrc` would reference nothing) and the workflow installs the
latest npm CLI, which trusted publishing requires.

The *first* publish of a package, and its trusted-publisher entry, must happen
manually — chicken and egg — and npm requires that configuration's first OIDC
publish within two days, so recreate an expired one instead of retrying. Never
tag an already published version to trigger a second publish.

A new publishable workspace needs its `@v*` tag pattern in the workflow, a
`files` list including the build output, `publishConfig.access: "public"` for a
scoped name, and that manual bootstrap; pack and publish are shared, keyed by
package name.

## Keep dogfooding current

After merging or publishing, run `node scripts/sync-dogfood.mjs` to inspect the
GitHub → PushStack sync, then rerun with `--apply`. It uses the existing `gh`
logins and named remotes, fast-forwards main, adds missing immutable tags, and
copies published release notes. Divergent history, moved tags, and release
assets that need a separate transfer stop the sync; it never force-pushes or
prunes destination data.
