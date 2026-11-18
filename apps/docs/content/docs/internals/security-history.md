---
title: "Security history"
description: "How the security rules were arrived at, including the vulnerabilities behind them."
---

Each section is the investigation that produced one invariant in [security.md](/docs/internals/security). The rule says what must hold; this says why, so you can tell whether it still applies when you change the code around it. Where something was exploitable it was fixed in the same change that added the rule, and the rule keeps it fixed.

## Stored XSS in markdown rendering

`MarkdownRenderer` renders fully attacker-controlled content: issue and PR bodies, comments, READMEs. Its link/image renderer used to emit a raw `<a href>`/`<img src>` for anything that did not match a known external or repo-reference pattern — exactly the case when no `branch` context is available, as in issue and comment bodies — so `[click me](javascript:…)` was a live link running in the viewer's authenticated session.

**Fix**: `isSafeHref`/`isSafeImageSrc` gate every href/src as an allowlist, not a blocklist: no scheme is a relative reference (safe by construction), an explicit scheme only `http:`, `https:` or `mailto:` (plus `data:image/…` for images, which cannot execute script the way a `data:text/html` navigation can). Anything else is rejected by construction rather than by keeping a blocklist current.

**The subtle half is what "has no scheme" means.** The predicates cannot judge the literal prefix; they must judge what the browser's URL parser will do, and that parser removes ASCII tab and newline characters and strips leading C0 controls and spaces *before* it reads the scheme. `<java\tscript:alert(1)>` and `<\u0001javascript:alert(1)>` are therefore live `javascript:` URLs even though neither starts with `javascript:`, and the original prefix-anchored test called both "relative, safe". So a value containing a C0 control or space is now rejected before the scheme is considered. Nothing legitimate is lost, because a markdown destination cannot carry them.

That markdown parser pre-encodes those characters — `java\tscript:` arrives as `java%09script:`, which no browser resolves as a scheme — but that is not this app's control and could silently stop, so `MarkdownRenderer.render.test.tsx` asserts the *outcome* through the browser's own URL parser instead of trusting the encoding. If a react-markdown upgrade, a `rehype-raw` addition or a new caller stops pre-encoding a user-controlled href, the test says so.

## Path traversal via repository name

Repository `name` was validated with only `z.string().min(1).max(100)`. The name is a segment of the gitdir (`repos/{ownerKey}/{repoName}/git`) and every path isomorphic-git hands `gitFs` is normalized (`..` resolved) before it becomes an R2 key, so a repository named `..` put its gitdir at `repos/git` and a name like `../victim/repo` landed inside another user's repository. S3 itself has no path resolution, but `gitFs` does and every git operation goes through it, so these segments are paths, not opaque strings.

**Fix, at two layers**: names and usernames must match `STORAGE_NAME_RE` (alphanumeric at both ends, so never `.` or `..`), and key construction checks every segment against the same pattern and throws rather than sanitizing. Keep both: the second covers a caller that skips validation.

## Path traversal via git branch/ref names

More severe than the name bug: ref names — a push's ref-update command, a branch typed into the web UI, a pull request's source or target branch — reached isomorphic-git primitives that never validate a ref name themselves (`git.commit`, `git.merge`, `git.deleteBranch`, `git.resolveRef`, `git.deleteRef`), resolving straight through `fs.write`/`fs.rm(join(gitdir, ref))`.

That alone would be contained if the storage layer re-verified containment per repository, but it does not: the object-store `fs` is constructed with no key prefix and maps whatever path isomorphic-git hands it onto an R2 key, normalized only against the store's own root. A `../`-laden ref collapses to a path like `repos/{victim}/repo/git/refs/heads/main` and the store reads, writes or deletes exactly that key even though the operation started on the attacker's own repo. This was directly exploitable in production, through two ordinary paths:

1. **A push's receive-pack commands** passed the client-supplied `refName` straight to `resolveRef`/`deleteRef`/`writeRef`. `writeRef` validates internally; the other two do not, so a delete command naming a traversal ref with the all-zero old oid passed the compare-and-swap (a bad ref path reads as "does not exist yet") and deleted the victim's ref file.
2. **Web-UI branch operations** (`uploadFile`, `deleteFile`, `createBranch`, `deleteBranch`, pull request branch fields) accepted a bare `z.string()`, so "delete branch" reached `git.deleteBranch`, and a traversal target branch merged by anyone with merge rights reached `git.merge`/`git.commit`.

**Fix**: `isSafeFullRefName` (the `refs/heads/…`/`refs/tags/…` shape a push uses) and `isSafeBranchName` (the bare shape every other entry point uses, also rejecting anything that already looks like a full ref path), both on the character classes isomorphic-git's own `isValidRef` uses, applied at three layers: schema validation on every branch-shaped field, re-validation in `git-write.ts` immediately before isomorphic-git, and `applyRefUpdates` rejecting a bad push command with `ok: false, reason: "invalid ref name"`.

## Path traversal via the raw-content route

The raw-content route read its `ref` and `path` straight off the decoded URL and passed them into `getFileContent`. Being a route handler rather than a validated server function, it never ran the schemas, and `getFileContent` resolves `ref` with `git.resolveRef` — one of the non-validating primitives — through the normalizing `gitFs`, so a crafted `ref` could read another repository's data past that repository's read check, which had only ever validated the repo named in the URL.

**Fix**: validate `ref` and `path` (`isSafeRefName`/`isSafeRepoPath`) before they reach the content layer and answer `404` otherwise. A new route handler that reads request path segments directly runs the same validators instead of assuming access control is enough.

Note the split these bugs forced: `isSafeBranchName` rejects 40-hex values so a stored branch name is never ambiguous with a commit SHA, which is why read paths that accept a pinned revision use `safeRefNameSchema` (a valid branch name *or* a full SHA) while write paths keep the stricter schema, and commit ids use `safeCommitShaSchema`.

## Dependency vulnerabilities

`pnpm audit` and `pnpm audit --prod` report zero vulnerabilities, and the policy is to repair the graph at its owner: remove the unused plugin or peer graph, upgrade the dependency whose transitive dependency is vulnerable, replace a tool that drags in a bad chain. Broad overrides and advisory exclusions have failed twice — an open-ended `undici` override resolved to a major whose internal paths broke jsdom, and moving overrides into the workspace file silently disabled them and reintroduced vulnerable versions. A clean audit alone does not establish API compatibility: inspect the full path with `pnpm why`/`pnpm audit --json`, then run audit, typecheck, tests, build and the native-git smoke checks.
