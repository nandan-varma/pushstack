# Changelog

Releases of `@pushstack/cli`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.1] - unreleased

- `pushstack` and `pst`: `auth login --with-token`, `auth status`, `auth token`,
  `auth logout`, `repo list`, `repo view`, `repo create`, and `api` for
  arbitrary requests against a host's `/api/v3`.
- Tokens are stored per host in an owner-only `hosts.json`; `PST_TOKEN`,
  `PST_HOST`, `PST_REPO` and `PST_CONFIG_DIR` override stored state.
- Requests paginate along the `Link` header and never follow a link to another
  host.
