---
title: "User guide"
description: "Create an account and a repository, clone, push with a token, issues, pull requests, roles and limits."
---

This page is for people who *use* PushStack: creating repositories, cloning and
pushing, and working with issues and pull requests. For how the platform is
built, see [architecture.md](/docs/internals).

Everything here is about the hosted instance at
[git.nandan.fyi](https://git.nandan.fyi).

## Create an account

1. Go to `/auth/register` and sign up with a username, email and password
   (at least 8 characters).
2. Open the verification email and click the link. **You cannot sign in until
   you do** — that is deliberate, so an address can't be claimed by someone who
   doesn't control it.
3. Sign in at `/auth/login`.

Your **username is permanent**: it appears in your repository URLs and is the
first segment of every storage key your repositories live under, so it cannot be
changed after sign-up. Pick one you're happy with. Your display name, avatar and
password can all change later in `/settings`.

Forgot your password? `/auth/forgot-password` emails a reset link that expires
after one hour.

A session lasts 7 days and is refreshed while you use it. `/settings` → Security
lists your active sessions and can sign out the others.

## Create a repository

Go to `/repositories/new`. You choose:

- **Name** — letters, digits, `.`, `-` and `_`, must start and end with a letter
  or digit, up to 100 characters. The name is part of every storage key, so it
  can't contain `/`, can't be `.` or `..`, and can't be reused by someone else
  under your account.
- **Visibility** — `public` repositories can be read (and cloned) by anyone,
  including signed-out visitors. `private` ones are visible only to you and your
  collaborators, and answer `404` to everyone else — a private repository never
  reveals that it exists.
- **Description** — optional, shown on the repository page and in link previews.

New repositories start empty, on a default branch called `main`. The first push
or web upload creates that branch.

Later, `/repo/{owner}/{name}/settings` → **General** renames the repository,
changes its description, visibility and default branch; **Danger zone** deletes
it (type the name to confirm). Renaming moves the repository's stored data, so
existing clones keep working through the new URL after a `git remote set-url`.

## Clone a repository

Every repository's clone URL is shown on `/repo/{owner}/{name}/setup`:

```bash
git clone https://git.nandan.fyi/api/git/<owner>/<repository>.git
```

Public repositories clone anonymously. Private ones need a token, below.

## Push with a personal access token

**Push requires a personal access token. Passwords are not accepted over git**,
and neither are browser sessions — a token can be scoped, revoked, and expires
on its own, which a password cannot.

Create one in `/settings` → **Git access** → **Personal access tokens**:

| Field | What to know |
| --- | --- |
| Name | For your own reference, e.g. "laptop". |
| Scope | `repo:read` clones and fetches. `repo:write` also pushes (it implies read). |
| Lifetime | 1–365 days, or never. |

The token is shown **once**, on creation — copy it then. Only its SHA-256 hash is
stored, so nobody, including this server, can show it to you again. Revoke any
token from the same page; the list shows when each was last used.

Tokens start with `pst_`. Git clients can't hold a browser session, so pass the
token as the Basic-auth **password** (or username — either slot works):

```bash
git clone https://git.nandan.fyi/api/git/<owner>/<repository>.git
# Username: anything (or your token)
# Password: pst_…
```

To avoid typing it every time, use a credential helper or embed it in the
remote. **Push an existing project:**

```bash
git remote add origin https://git.nandan.fyi/api/git/<owner>/<repository>.git
git branch -M main
git push -u origin main
```

The same steps, plus `git init` and a first commit, are on the repository's
Setup page and can be copied from there.

### If a push is refused

| Response | What it means |
| --- | --- |
| `401 Authentication required` | No token was sent. Git prompts for one if the URL is HTTPS. |
| `401 Invalid credentials` | The token is wrong, or was revoked, or has expired. |
| `403 … no write access` | The token is valid but its scope is `repo:read`, or your account has only read access to that repository. |
| `non-fast-forward, ref updated by another push` | The ref moved since your last fetch, so the update was rejected. Run `git fetch` and rebase or merge; a `git push --force` then works, because the check compares against the value you fetched. |
| `repository lock` timeout | Another write to the same repository held the lock for too long. Retry. |

Two limits apply to pushes: the request body is capped at 50 MB, and a branch
name has to be a valid git ref (no spaces, no `..`, no leading or trailing `.`).

## Work in the browser

The web UI can do most of what the CLI can, without a clone:

- **Upload a file** — `/repo/{owner}/{name}/upload`, up to 25 MB per file. Larger
  files should go through `git push`.
- **Delete a file** — from the file's page.
- **Create a branch** — from the branch picker; **delete** one too, except the
  default branch, which git clients need to know what to check out.
- **Change the default branch** — `/settings` → General. This moves `HEAD`, so
  new clones check out the branch you pick.
- **Browse** — the file tree, a file's history, any commit, and the diff a commit
  introduced. A file pinned to a commit SHA (the Permalink button) is a stable
  URL that never changes.
- **Submodules** — a submodule appears as a pinned commit with a link to the
  repository it points at; the parent repository stores only that pointer.
- **Raw and download** — every file has a `/api/raw/…` URL serving its exact
  bytes, used by downloads, images and media previews.

Markdown is rendered for READMEs, issue and pull request bodies, and comments.
Relative links and images resolve against the file that contains them, so
`./diagram.png` in `docs/README.md` finds `docs/diagram.png`.

## Issues and pull requests

Opening an issue, commenting, or opening a pull request all require **write
access** to the repository — the same permission that lets you push. Read-only
collaborators can browse and clone but not comment.

Issues and pull requests share one number sequence per repository (`#1`, `#2`,
…), the same way GitHub's do. In any markdown body:

- `#12` links to issue or pull request 12 — but only when that number belongs to
  exactly one of them. If both exist, the shorthand stays plain text rather than
  guessing wrong.
- A commit SHA (7–40 hex characters) links to that commit.
- Writing `Closes #4`, `Fixes #12` or `Resolves #7` in a pull request body closes
  those issues when the pull request merges. Only those verbs count — a bare
  `#4` never closes anything.

**Merging** is allowed for owners, admins and write collaborators. A merge is a
fast-forward when the target hasn't moved, and an object-level three-way merge
otherwise. If both sides changed the same file incompatibly, the merge is
refused and the conflicting paths are listed; resolve them in git and push
again. A merged pull request can no longer be edited or reopened.

## Collaborate

Add collaborators from `/repo/{owner}/{name}/settings` → **Collaborators**, by
username, with one of three roles:

| Role | Can do |
| --- | --- |
| `read` | Clone, fetch, browse files, commits, issues and pull requests. |
| `write` | Everything `read` can, plus push, comment, open issues and pull requests, and merge. |
| `admin` | Everything `write` can, plus view the collaborator list. |
| (owner) | Everything, plus repository settings, collaborators, repack and delete. |

Only the **owner** changes settings, collaborators and deletion — `admin` is
currently limited to seeing who the collaborators are. Removing a collaborator
takes effect immediately.

## Find things

- `/search` finds repositories (public ones, plus your own private ones) and
  users by name or username.
- `/users/{username}` is a public profile: repositories, and recent activity in
  public repositories. Your own profile shows your private activity too.
- Starring a repository is per-account and shown on its page.
- `/dashboard` lists your repositories and your activity feed.

## Limits, in one place

| Limit | Value |
| --- | --- |
| Web file upload | 25 MB per file |
| Raw file download (`/api/raw`) | 50 MB — above that, `git clone` |
| Git push request body | 50 MB |
| Issue, pull request and comment body | 65,536 characters |
| Commit message (web UI) | 10,000 characters |
| Repository name | 100 characters |
| Token lifetime | 1–365 days, or never |
| Session | 7 days, refreshed on use |

Sign-in, sign-up and password changes are rate-limited to **3 attempts per 10
seconds** per IP address; password-reset and verification emails to **3 per
minute**; other account endpoints to 20 per minute. The counters live in the
database, so the limit is shared by every server instance rather than being
per-instance. Git requests are not rate-limited: a token is high-entropy and
scoped, so guessing one isn't a realistic attack.
