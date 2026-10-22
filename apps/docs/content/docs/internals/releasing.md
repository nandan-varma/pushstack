---
title: "Releasing packages"
description: "How the published npm packages (both git libraries and the CLI) get versioned, tagged and published with trusted publishing."
---

Three workspaces are published to npm:

| Workspace | Package | Tags |
| --- | --- | --- |
| `packages/git-fs-s3` | `git-fs-s3` | `git-fs-s3@v*` |
| `packages/git-edge` | `git-edge` | `git-edge@v*` |
| `apps/cli` | `@pstk/cli` | `@pstk/cli@v*` |

`apps/web`, `apps/docs` and `packages/tsconfig` are private: the app and the docs
site deploy from the repository, and the TypeScript configuration is consumed
through the workspace.

## Cutting a release

1. Bump the version in the workspace's `package.json`.
2. Add the release to its `CHANGELOG.md` (Keep a Changelog format, newest first).
   Replace the `unreleased` heading with the version and the date.
3. Commit, then push an **annotated** tag (`git tag -m`, never a lightweight
   one — the repository's git configuration rejects message-less tags):

   ```sh
   git tag -m "git-fs-s3 v0.16.0" git-fs-s3@v0.16.0
   git push origin git-fs-s3@v0.16.0
   ```

4. [`.github/workflows/release-packages.yml`](https://github.com/nandan-varma/pushstack/blob/main/.github/workflows/release-packages.yml)
   does the rest: it resolves the tag's package name to its workspace
   (`scripts/workspace-directory.mjs`), checks the tag against the version in
   `package.json`, runs `turbo run typecheck test build --filter=<package>`,
   packs with `pnpm pack` (which rewrites `workspace:*` ranges to real
   versions), publishes the tarball with `npm publish --provenance`, and opens a
   GitHub release.

**Never delete or move a pushed tag.** A published version cannot be
re-published; release a new patch instead. A tag whose version does not match
`package.json` fails the workflow before anything is packed.

## Trusted publishing, not tokens

There is no `NPM_TOKEN` anywhere in this repository. Each package's npm settings
list this repository and `release-packages.yml` as its trusted publisher, and
the workflow authenticates through OIDC (`id-token: write`), so npm trusts the
run itself and attaches a provenance attestation that points back at the exact
commit and workflow that built the tarball.

Because no token is involved, `setup-node` is used **without** `registry-url`:
a generated `.npmrc` would reference `NODE_AUTH_TOKEN`, which nothing sets.
The workflow installs the latest npm CLI instead, which trusted publishing
requires (npm 11.5.1 or newer).

Adding a fourth publishable workspace means:

- adding its `@v*` tag pattern to `release-packages.yml`'s `on.push.tags`;
- a `package.json` with a `files` list that includes the built output, and
  `publishConfig.access: "public"` for scoped names;
- configuring the trusted publisher on npmjs.com for that package;
- nothing else: the workspace directory is resolved by package name, and the
  version check, test run, pack and publish are shared.
