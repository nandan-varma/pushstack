---
title: "Gists"
description: "Design note for issue #221: a summary, with the work split into follow-up issues."
---

**Design only — not implemented.** Issue
[#221](https://github.com/nandan-varma/pushstack/issues/221), split into #355
(schema, `gists/{id}/git` prefix, clone at `/{id}.git`), #356 (REST
create/get/update/delete/list/revisions), #357 (REST stars, forks, commits,
comments), #358 (web pages, raw URLs), #359 (GraphQL `User.gists`, `gh gist`).

- **Secret means unlisted, not private**: anyone holding the id reads it over
  web, REST and clone; only listings hide it.
- It is *not* a `repositories` row — that would put it in repo listings and
  search, collide with `(owner_id, name)` and give it private-repo semantics.
  It gets its own tables, a `gist-access.ts` shaped like `repo-access.ts` and a
  lock keyed `gists/{id}`, the same string as its storage prefix.
- Bytes use the same `git-fs-s3` ops, `git-storage-naming.ts` stays the only
  key builder, and GitHub's names, URLs, status codes and shapes are followed
  exactly. Limits live in `limits.ts`; a `Gist` response stays under Vercel's
  4.5 MB cap by truncating inline content, and creation is refused past 300
  files instead of truncating the files map. Tokens need the `gist` scope.

Anything more belongs in the issue, not here.
