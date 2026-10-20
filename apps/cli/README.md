# PushStack CLI

`@pushstack/cli` provides the `pst` and `pushstack` commands for PushStack's
GitHub-compatible REST API. Requires Node.js 22 or newer.

```sh
npm install -g @pushstack/cli
pst --help
pst auth login --with-token < token.txt
pst auth status
pst repo list
pst repo view alice/project --json nameWithOwner,url
pst repo create project --private --add-readme
pst api repos/alice/project
pst api 'repos/{owner}/{repo}' -X GET
```

Create a personal access token on your PushStack host. Login verifies it before
saving it in `hosts.json` with owner-only permissions. Tokens are stored as plain
text; protect your account and configuration directory. `auth logout` removes
the stored credential, while `auth token` prints it explicitly. Status masks
credentials unless `--show-token` is supplied.

The default host is `git.nandan.fyi`; use `--hostname localhost:3000` for local
development. Localhost uses HTTP; other hosts use HTTPS. Hostnames may include a
port but must not include a scheme or path.

Environment settings:

- `PST_TOKEN`: overrides stored credentials.
- `PST_HOST`: selects the host unless `--hostname` is supplied.
- `PST_REPO`: selects `OWNER/REPO`, ahead of inference from git remotes.
- `PST_CONFIG_DIR`: configuration directory, otherwise
  `$XDG_CONFIG_HOME/pushstack` or `~/.config/pushstack`.

`repo view` accepts `OWNER/REPO` or `--repo/-R`. `repo list` accepts an optional
owner, `--limit/-L`, `--visibility public|private`, and `--json` fields.
`repo create` requires `--public` or `--private`; supported options include
`--description/-d`, `--add-readme`, `--gitignore/-g`, and `--license/-l`.
Repositories can only be created under the authenticated user.

`issue list` (`ls`) shows 30 open issues by default. Use `--limit/-L`
(1–10000), `--state/-s open|closed|all`, repeatable `--label/-l`, and
`--assignee/-a` to filter. Labels may be comma-separated and are combined as
an AND filter. The assignee filter accepts a login, `@me`, `none`, or `*`.
Pagination follows API Link headers and counts only issues, excluding pull
requests from the shared issues API.

`issue view <number>` displays an issue. Both list and view accept `--json`
with comma-separated fields: `number`, `title`, `body`, `state`, `stateReason`,
`url`, `author`, `assignees`, `labels`, `createdAt`, `updatedAt`, `closedAt`.
State and reason values use uppercase GitHub CLI naming. Authors and assignees
include `login`; labels include `name`, `color`, and `description`.

`issue create` requires `--title/-t`; supply `--body/-b` or
`--body-file/-F path` (`-` reads stdin). Labels and assignees support repeated
flags or comma-separated names; `@me` resolves to the active token's account.
`issue close <number>` accepts `--reason/-r completed|not_planned` (default
`completed`), and `issue reopen <number>` reopens it. These commands print the
issue URL. View, close and reopen reject pull request numbers.

All issue commands accept `--repo/-R OWNER/REPO` and `--hostname`, using
`PST_REPO` and then matching git remotes when `--repo` is omitted. Each
subcommand supports `--help`. Creation is noninteractive; no editor or
comment-on-close option is provided.

```sh
pst issue list -R alice/project -l bug -a @me --json number,title,url
pst issue create -R alice/project -t "Fix login" -F description.md -l bug
pst issue view 12 -R alice/project
pst issue close 12 -R alice/project -r not_planned
pst issue reopen 12 -R alice/project
```

`pr list|view|create|merge|close|reopen|checkout` mirror gh: they take a
number, `#N`, URL, head branch or (by default) the current branch's pull
request; `--json` uses gh's field names (`headRefName`, `baseRefName`,
`state` as `OPEN`/`CLOSED`/`MERGED`, ...). `pr merge` makes merge commits only;
`pr checkout` fetches the head branch with git. See the documentation site
for every flag.

```sh
pst pr create -t "Fix login" -F description.md
pst pr merge 7 -t "Fix login (#7)"
pst pr checkout 7
```

`api` accepts relative API endpoints, `--method/-X`, `--header/-H`,
`--raw-field/-f key=value`, and typed `--field/-F key=value`. Fields default to a
POST body; GET/HEAD fields become query parameters. `--input file` (or `-` for
stdin), `--include/-i`, `--silent`, and `--paginate` are supported. Pagination
stays on the selected host's API. Commands return 0 on success, 1 on failure,
and 4 when authentication is required or rejected.

The CLI covers auth, repositories, issues, pull requests and direct API requests. It does not
provide interactive login, organization creation, cloning, or pushing.

From the monorepo root:

```sh
pnpm --filter @pushstack/cli test
pnpm --filter @pushstack/cli typecheck
pnpm --filter @pushstack/cli build
```
