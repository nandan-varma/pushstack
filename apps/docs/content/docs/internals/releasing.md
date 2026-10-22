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

## Bootstrapping a new package

Do this once, before the first automated release. Trusted publishing is configured
in an existing package's npm settings, so the owner must publish its first version
manually. The CLI's `@pstk/cli@0.0.1` has already been published; use the next
unpublished version for its first OIDC release.

1. Confirm the final package name and publishing rights on npm. For a scoped
   package, the owner must control the user scope or have permission in the npm
   organization. Check that the organization exists and its name is available
   before choosing the scope; a GitHub organization does not create an npm one.
   `npm view <package> versions --json` checks existing versions; a registry 404
   alone does not prove that a name can be claimed. See npm's
   [scoped package guide](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).
2. Set the manifest's final `name`, initial `version`, `files`, public
   `publishConfig.access`, and `repository.url` pointing at
   `https://github.com/nandan-varma/pushstack.git`. Add its tag pattern to
   `release-packages.yml` and merge those changes before tagging.
3. From the repository root, build and validate the workspace, then pack it
   with pnpm so workspace dependency ranges are rewritten. For a new CLI
   package, these commands use its current name and workspace:

   ```sh
   pnpm exec turbo run typecheck test build --filter=@pstk/cli
   mkdir -p /tmp/pushstack-first-publish
   pnpm --filter @pstk/cli pack --pack-destination /tmp/pushstack-first-publish
   ```

   Inspect the generated tarball's file list with `tar -tzf <tarball.tgz>` and
   confirm its manifest's name, version, entrypoints and dependencies. Use a
   fresh output directory for each attempt to avoid selecting an old tarball.
4. The owner logs in with their npm account and publishes that exact tarball
   interactively (complete npm's 2FA challenge):

   ```sh
   npm login
   npm whoami
   npm publish /tmp/pushstack-first-publish/pstk-cli-0.0.1.tgz --access public
   npm view @pstk/cli@0.0.1 version
   ```

   The path and version above illustrate the initial CLI release; do not run
   them again for the already published version. Local manual publishing does
   not use the workflow's OIDC identity or its `--provenance` flag.
5. In that package's npm **Settings → Trusted publishing**, add a GitHub Actions
   publisher with these exact values:

   | Field | Value |
   | --- | --- |
   | Organization or user | `nandan-varma` |
   | Repository | `pushstack` |
   | Workflow filename | `release-packages.yml` (filename only) |
   | Environment name | Leave empty (the workflow declares no environment) |
   | Allowed actions | Allow direct `npm publish` |

   Repeat for each package. See npm's
   [trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).
6. Follow **Cutting a release** below for the next unpublished version. Never
   tag the manually published version to trigger another publish of it.
   npm requires the new trust configuration's first successful publish within
   two days; recreate an expired configuration before trying again. Check the
   workflow's publish result and the npm version's provenance after that run.

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

The automated release workflow needs no `NPM_TOKEN`. After the bootstrap above,
each package's npm settings list this repository and `release-packages.yml` as
its trusted publisher. The workflow authenticates through OIDC (`id-token: write`), so npm trusts the
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
- completing the manual first publish and trusted publisher bootstrap above;
- nothing else: the workspace directory is resolved by package name, and the
  version check, test run, pack and publish are shared.
