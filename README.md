# PushStack

A GitHub-compatible code forge: Git over HTTPS, repositories, issues, pull
requests, code browsing, and GitHub's REST and GraphQL APIs. The instance at
[git.nandan.fyi](https://git.nandan.fyi) hosts this project's own
[issues](https://git.nandan.fyi/nandan/pushstack/issues) and
[pull requests](https://git.nandan.fyi/nandan/pushstack/pulls).

## Run it locally

Node 24 (`.node-version`) and pnpm 12.14.0 (`packageManager`).

```bash
npm install --global pnpm@12.14.0
pnpm install
pnpm dev:local   # http://localhost:3000
```

Local development uses PGlite and on-disk Git under `apps/web/.pushstack-local/`,
needs no cloud accounts, and prints verification and password-reset links in the
terminal. To run against real services, copy `apps/web/.env.example` to
`apps/web/.env.local`; the
[deployment guide](https://docs.git.nandan.fyi/docs/internals/deployment) lists
the variables and storage requirements.

## Documentation

- [User guide](https://docs.git.nandan.fyi/docs/guide)
- [REST compatibility](https://docs.git.nandan.fyi/docs/api)
- [Architecture](https://docs.git.nandan.fyi/docs/internals)

## License

Copyright (C) 2026 Nandan Varma. Licensed under the
[GNU Affero General Public License v3 or later](LICENSE); running a modified
version as a network service requires offering its corresponding source to that
service's users.
