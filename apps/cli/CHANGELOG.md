# Changelog

Releases of `@pstk/cli`, the PushStack CLI. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.1] - unreleased

- Remotes and pull request arguments use GitHub's URL shapes:
  `https://{host}/{owner}/{repo}.git` and `…/{owner}/{repo}/pull/{n}`.
- `pushstack` and `pst`: `auth login --with-token`, `auth status`, `auth token`,
  `auth logout`, `repo list`, `repo view`, `repo create`, and `api` for
  arbitrary requests against a host's `/api/v3`.
- Tokens are stored per host in an owner-only `hosts.json`; `PST_TOKEN`,
  `PST_HOST`, `PST_REPO` and `PST_CONFIG_DIR` override stored state.
- Requests paginate along the `Link` header and never follow a link to another
  host.
- Requests are built from `@pushstack/api-contract` (bundled through its
  zod-free client entry): operation ids, paths and response types are shared
  with the server instead of hand-written.
