---
title: "Submodules"
description: "What hosting submodules requires: external objects, separate access, no fetching or guessing."
---

PushStack hosts repositories with submodules, including private and nested
ones. A submodule is a tree entry with mode `160000`: a pinned commit in
another repository, whose objects stay there. Push, fetch, clone and repack
skip those external commits, and submodule URLs resolve against the parent's
clone remote — not its web-page URL — so a sibling repository is best added
with a relative URL: `git submodule add ../shared-library.git vendor/lib`.

Rules that are not obvious from the code:

- Access is checked per repository: reading the parent grants nothing on a
  private submodule, and external hosts use their own credentials.
- Browsing never fetches a remote repository and never executes configuration
  or includes; only known hosts link to a commit, other HTTP(S) URLs to a
  repository, and local paths, command transports and credentialed URLs not at
  all. A missing or ambiguous `.gitmodules` record still shows the pinned SHA.
- Web file edits preserve submodule entries and their modes; adding, updating
  or removing a submodule is done with Git, and the browser never advances
  another repository's pointer.
- Merging follows object identity: identical and one-sided pointer updates
  merge; competing updates, modify/delete and structural changes are conflicts
  that leave the branch alone. PushStack never guesses which external commit
  wins, so resolve locally and push the result.
