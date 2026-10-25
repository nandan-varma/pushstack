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

1. Go to `/signup` and sign up with a username, email and password
   (at least 8 characters).
2. Open the verification email and click the link. **You cannot sign in until
   you do** — that is deliberate, so an address can't be claimed by someone who
   doesn't control it.
3. Sign in at `/login`.

Your **username is permanent**: it appears in your repository URLs and is the
first segment of every storage key your repositories live under, so it cannot be
changed after sign-up. Pick one you're happy with. Your display name, avatar and
password can all change later in `/settings`. Repositories live at
`/{username}/{repository}` like on GitHub, so names of top-level pages and
files (`settings`, `search`, `api`, `login`, `favicon.ico`, …) can't be
usernames.

Forgot your password? `/password_reset` emails a reset link that expires
after one hour.

A session lasts 7 days and is refreshed while you use it. `/settings` → Security
lists your active sessions and can sign out the others.

## Create a repository

Go to `/new`. You choose:

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

Later, `/{owner}/{name}/settings` → **General** renames the repository,
changes its description, website, topics (up to 20, lowercase letters, numbers
and hyphens; searchable as `topic:name`), visibility and default branch, turns
the Issues, Wiki and Projects flags on or off (stored; only Issues exists) and
marks it a **template repository**. Others then see **Use this template** and
get a copy of its files as one `Initial commit`. **Danger zone** archives the
repository, transfers it to another user, or deletes it (type the name to
confirm). An archived repository is read-only for everyone, owner included:
pushes are refused with `Repository was archived so is read-only.`, and
issues, comments, pull requests, labels and settings are locked until it is
unarchived.
A transfer is immediate (there is no invitation to accept) and the old URL does
not redirect. These settings are also `PATCH`/`DELETE /repos/{owner}/{repo}`,
`PUT /repos/{owner}/{repo}/topics`, `POST …/transfer` and `POST …/generate` in
the REST API. Renaming moves the repository's stored data, so
existing clones keep working through the new URL after a `git remote set-url`.

## URLs

Web URLs are GitHub's, so swapping the host in a GitHub link opens the same page:

| Page | URL |
| --- | --- |
| Repository | `/{owner}/{repo}` |
| Directory, file | `/{owner}/{repo}/tree/{ref}/{path}`, `/{owner}/{repo}/blob/{ref}/{path}` |
| Raw file bytes | `/{owner}/{repo}/raw/{ref}/{path}` |
| Source archive | `/{owner}/{repo}/archive/refs/heads/{branch}.zip`, `…/refs/tags/{tag}.tar.gz`, `…/archive/{sha}.zip` |
| Commits, one commit | `/{owner}/{repo}/commits/{ref}`, `/{owner}/{repo}/commit/{sha}` (`.diff`, `.patch`) |
| Compare | `/{owner}/{repo}/compare/{base}...{head}` (`.diff`, `.patch`) |
| New issue, template chooser | `/{owner}/{repo}/issues/new`, `…/issues/new/choose` |
| Issues, one issue | `/{owner}/{repo}/issues`, `/{owner}/{repo}/issues/{n}` |
| Pull requests | `/{owner}/{repo}/pulls` |
| One pull request | `/{owner}/{repo}/pull/{n}`, `…/pull/{n}/commits`, `…/pull/{n}/files` (`.diff`, `.patch`) |
| Labels | `/{owner}/{repo}/labels` |
| Releases | `/{owner}/{repo}/releases`, `…/releases/tag/{tag}`, `…/releases/latest`, `…/releases/new`, `…/releases/edit/{tag}` |
| Release asset download | `/{owner}/{repo}/releases/download/{tag}/{asset}` |
| Milestones | `/{owner}/{repo}/milestones`, `/{owner}/{repo}/milestone/{n}` |
| Upload a file | `/{owner}/{repo}/upload/{branch}/{directory}` |
| Clone | `/{owner}/{repo}.git` |
| New repository | `/new` |
| Sign in, sign up, reset password | `/login`, `/signup`, `/password_reset` |
| REST API | `/api/v3/…` (GitHub Enterprise Server's path) |

An issue number opened at `/pull/{n}` goes to `/issues/{n}`, and the reverse, as on GitHub.

## Clone a repository

Every repository's clone URL is shown on `/{owner}/{name}/setup`:

```bash
git clone https://git.nandan.fyi/<owner>/<repository>.git
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
git clone https://git.nandan.fyi/<owner>/<repository>.git
# Username: anything (or your token)
# Password: pst_…
```

To avoid typing it every time, use a credential helper or embed it in the
remote. **Push an existing project:**

```bash
git remote add origin https://git.nandan.fyi/<owner>/<repository>.git
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

- **Upload a file** — `/{owner}/{name}/upload`, up to 25 MB per file. Larger
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
- **Raw and download** — every file has a `/{owner}/{repo}/raw/{ref}/{path}` URL serving its exact
  bytes, used by downloads, images and media previews.
- **Source archives** — `/{owner}/{repo}/archive/refs/heads/{branch}.zip` (or `.tar.gz`, `refs/tags/{tag}`, a
  full commit SHA) streams a zipball or tarball whose entries sit under `{repo}-{ref}/`, as on GitHub; the
  commit SHA is the zip comment. The REST `zipball` and `tarball` routes (default branch when no ref) answer `302` to `/{owner}/{repo}/legacy.zip/{ref}` (or `legacy.tar.gz`), whose entries are named `{owner}-{repo}-{short sha}`. Archive downloads count against the API rate limit.
  Submodules become empty directories, and a private repository's archive accepts a personal access token.

- **Releases** — `/{owner}/{repo}/releases` lists a repository's releases: a tag with Markdown notes and
  downloadable files, plus the source archives of its tag. Writers draft, publish, edit and delete them;
  a draft is visible to writers only, and deleting a tag leaves its release behind as a draft. Publishing a
  release for a tag that does not exist creates a lightweight tag at the target branch or commit. Files
  stream from `/{owner}/{repo}/releases/download/{tag}/{asset}` (with `Range` support and a download count; a
  private repository's accepts a personal access token). Files up to 3 MB are uploaded through the app; larger
  ones (up to 2 GiB) go straight to R2 on a presigned URL, which needs R2 configured with a CORS rule allowing
  `PUT` from the site's origin.

Markdown is rendered for READMEs, issue and pull request bodies, and comments.
Relative links and images resolve against the file that contains them, so
`./diagram.png` in `docs/README.md` finds `docs/diagram.png`.

## Issues and pull requests

Anyone who can read a repository — a signed-in user, collaborator or not, and
read-only collaborators included — can **open an issue** and **comment** on
issues and pull requests, as on GitHub. Opening a **pull request** needs
**write access**, the same permission that lets you push. Labels, assignees,
and merging need write access too (see below).

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

### Issue and pull request templates

Commit templates on the repository's default branch. Markdown issue templates
live in `.github/ISSUE_TEMPLATE/*.md` and use YAML front matter with `name`,
`about`, and optional `title`, `labels` and `assignees`. The remaining Markdown
prefills the issue description. YAML issue forms (`*.yml` or `*.yaml`) in that
directory use GitHub's `name`, `description` and `body` schema: Markdown
instructions, text inputs, textareas, dropdowns and checkboxes. Submitted answers
become a Markdown issue body.

**New issue** opens `/{owner}/{repo}/issues/new/choose`. The directory's
`config.yml` controls `blank_issues_enabled` and `contact_links` (`name`, `url`,
`about`). To link directly to a template, use
`/{owner}/{repo}/issues/new?template=bug_report.md`. The `title`, `body`, `labels`
and `assignees` query parameters override template defaults; separate multiple
labels or usernames with commas. Changing labels and assignees requires write
access; repository-configured template defaults also apply for other reporters.
Missing template labels and ineligible assignees are ignored. An unknown
`template` name opens a blank issue, as on GitHub. A new issue is created
all-or-nothing: if any step after the insert fails, the issue is removed, so a
retry never duplicates it. Maintainers can
still open blank issues when `blank_issues_enabled` is false. Invalid issue
template files, including oversized files and invalid UTF-8, are omitted; invalid chooser configuration uses the defaults.
Discovery reads at most 50 template files, each at most 65,536 bytes, with a
combined limit of 256,000 bytes.

A `pull_request_template.md` file in `.github/`, the repository root or `docs/`
prefills the description when opening a pull request on the compare page. Under
`.github/PULL_REQUEST_TEMPLATE/` (or the same folder at the root or `docs/`), each
`*.md` file is a separate template; with several, the compare dialog offers a
chooser, and picking one replaces the description. GraphQL exposes `Repository.issueTemplates` and `Repository.pullRequestTemplates`
for clients such as `gh`.

## Collaborate

Add collaborators from `/{owner}/{name}/settings` → **Collaborators**, by
username, with one of three roles:

| Role | Can do |
| --- | --- |
| `read` | Clone, fetch, browse files, commits, issues and pull requests; open issues; comment on issues and pull requests, and submit comment-only reviews. |
| `write` | Everything `read` can, plus push, open pull requests, label and assign, approve or request changes on reviews, edit or delete others' comments, and merge. |
| `admin` | Everything `write` can, plus merge past blocking reviews, and view the collaborator list. |
| (owner) | Everything, plus repository settings, collaborators, repack and delete. |

Only the **owner** changes settings, collaborators and deletion — `admin` can
see who the collaborators are but not change them. Removing a collaborator
takes effect immediately.

Writers can assign issues and pull requests to the repository owner or a
write/admin collaborator, up to 10 assignees per thread. Assign issues while
creating them or use **Assignees → Edit** on an existing issue or pull request.
Assignment changes appear in the thread timeline. Readers can see assignments
but cannot change them.

**Review requests.** A pull request's author, or anyone with write access, can
ask the owner or a collaborator (never the author) for a review under
**Reviewers** in the pull request sidebar. The reviewer is notified, the request
shows in the timeline, and submitting a review clears it (you can ask again).
Search pull requests with `review-requested:@me` or `reviewed-by:username`.

**CODEOWNERS.** Put a `CODEOWNERS` file in `.github/`, the repository root or
`docs/` (the first found on the base branch is used). Patterns follow
gitignore-style rules and the last matching line wins. When a pull request opens,
the owners of the changed paths who are collaborators are requested
automatically, and a file's owners show above it in the blob view. Only
`@username` owners count for now; teams and e-mail owners are ignored.

## Find things

- `/search` finds repositories (public ones, plus your own private ones) and
  users by name or username.
- `/{username}` is a public profile: repositories, and recent activity in
  public repositories. Your own profile shows your private activity too.
- Starring a repository is per-account and shown on its page.
- `/dashboard` lists your repositories, your activity feed, and **Assigned to
  you**: your latest 20 open assigned issues and pull requests across
  repositories you can read. Closed and merged threads are excluded.

## Limits, in one place

| Limit | Value |
| --- | --- |
| Web file upload | 25 MB per file |
| Raw file download (`/{owner}/{repo}/raw/…`) | 50 MB — above that, `git clone` |
| Source archive (`/{owner}/{repo}/archive/…`) | 50,000 entries and 256 MiB of files — above that, `413` and `git clone` |
| Release asset | 2 GiB per file, 1,000 files per release; 4,000,000 bytes through `POST …/assets` (larger: presigned upload) |
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
