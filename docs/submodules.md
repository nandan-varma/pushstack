# Submodules

Pushstack hosts Git repositories containing submodules, including private and
nested submodules. A submodule is a tree entry with mode `160000`: a pinned
commit in another repository. Its objects stay in that repository. Push,
fetch, clone and repack skip these external commits when walking the parent
repository's object graph.

## Using Git

Commit both `.gitmodules` and the submodule entry in the parent repository.
For another Pushstack repository under the same owner, use a relative URL:

```sh
git submodule add ../shared-library.git vendor/shared-library
git commit -m "Add shared library"
git push
```

Clone everything, including nested submodules:

```sh
git clone --recurse-submodules https://git.nandan.fyi/api/git/OWNER/REPO.git
```

For an existing clone, use `git submodule update --init --recursive`.
After changing a submodule's checkout, commit and push its changes to its own
repository first, then commit and push the updated pointer in the parent.
Remove submodules with `git rm`, committing the `.gitmodules` change too.
Use your Git credential helper with a Pushstack personal access token for
private repositories. Access is checked separately on every repository;
access to the parent does not grant access to a private submodule. External
hosts use their own credentials. Relative URLs resolve against the parent's
clone remote, not its web-page URL.

## Browser and reviews

- Tree rows identify submodules and show their pinned commit. Opening one
  shows its repository URL, pinned SHA and pointer history, without trying
  to display it as a regular file.
- Repository URLs come from the root `.gitmodules` at the viewed revision.
  Pushstack, GitHub, GitLab.com and Bitbucket links can open the pinned
  commit. Other HTTP(S) hosts get a repository link. Local paths, command
  transports, URLs with credentials and unsupported URLs are not linked.
- Missing or ambiguous `.gitmodules` records still show the pinned SHA.
  Browsing never fetches a remote repository or executes config/includes.
- Commit and PR diffs show submodule additions, removals, pointer updates
  and file/directory conversions, with both object IDs. PR navigation uses
  the exact merge-base and head revisions used to calculate the diff.
- Unrelated web file edits preserve submodule entries and their modes.
  Add, update and remove submodules using Git; the browser does not edit
  another repository or advance its pointer automatically.

## Merging

Unchanged, identical and one-sided pointer updates merge normally, as do
one-sided additions/deletions. Different updates to the same pointer,
modify/delete conflicts and competing structural changes are reported as
conflicts, without moving the target branch. Resolve these locally with
Git, push the resolution, and retry the merge. Pushstack never guesses
which external commit should win or fetches an external repository to
infer its ancestry.

The native-Git smoke suite (`pnpm smoke:git`) verifies private nested
submodules through push, recursive clone/update, web edits, repack and fresh
clone, using isolated Git configuration and in-memory storage/database.
