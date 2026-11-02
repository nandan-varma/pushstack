---
title: "Deployment"
description: "The Cloudflare Workers that serve the web app and docs, their configuration, and the environment variable reference."
---

## Runtime: a Cloudflare Worker

The web app is one Cloudflare Worker, `pushstack-staging`. `apps/web/vite.config.ts`
builds it with `@cloudflare/vite-plugin`, and `apps/web/wrangler.jsonc` configures it:

- `compatibility_flags: ["nodejs_compat"]` supplies the Node built-ins and globals
  that some dependencies still assume (Better Auth's scrypt via `node:crypto`,
  isomorphic-git's use of `Buffer`). The app's own server code uses only Web APIs
  (`fetch`, WebCrypto, `TextEncoder`, `CompressionStream`) and `node:async_hooks`.
- `d1_databases` binds the application database as `DB` (see
  [database.md](/docs/internals/database)). The Worker reaches it only through that
  binding; there is no connection string.
- `r2_buckets` binds the git bucket as `GIT_BUCKET`
  (see [git-storage.md](/docs/internals/git-storage)). The Worker never writes to a
  local filesystem: every git read and write goes through that binding.
- `workers_dev` and `preview_urls` are off. The only route is the custom domain
  `pushstack.staging.nandan.fyi`.

The docs site is a separate Worker, `pushstack-docs` (`apps/docs/wrangler.jsonc`). It
is a Node-compat Worker serving static assets and SSR, with no bindings and no
secrets.

Both Workers are deployed with wrangler. Staging is deployed with:

```bash
pnpm --filter @pushstack/web deploy:staging   # vite build, then wrangler deploy
```

Production is a later cutover. It will add an `env.production` block to
`apps/web/wrangler.jsonc`; until then, there is one environment.

## Configuration: `env`, not `process.env`

Server code reads configuration through `env` from `cloudflare:workers`, which
`apps/web/src/server/env.ts` re-exports. Do not read `process.env` in server code.
Two isomorphic modules are the exception: `src/lib/git-utils.ts` and
`src/lib/perf-log.ts` read `process.env`, which the Worker fills from vars and secrets.
They must not import `cloudflare:workers`, or the browser bundle would pull it in.

Binding types come from the config:

```bash
pnpm --filter @pushstack/web cf-typegen   # regenerates worker-configuration.d.ts from wrangler.jsonc
```

Run it after any change to `apps/web/wrangler.jsonc`. Optional variables that wrangler
does not declare are typed by hand in `src/env.d.ts`.

Under vitest, `cloudflare:workers` is aliased to `src/test/cloudflare-workers.ts`. That
module exports an `env` whose `GIT_BUCKET` is an in-memory R2 bucket
(`createFakeR2Bucket` from `git-fs-s3/testing`). Every other name falls through to
`process.env`.

## Environment variables

Variables are public configuration and live in `wrangler.jsonc` under `vars`.
Secrets are set with `wrangler secret put` and declared under `secrets.required`, so
they are typed and checked.

Required vars (`apps/web/wrangler.jsonc`):

| Name | Purpose |
| --- | --- |
| `ENVIRONMENT` | `staging` or `production`. |
| `BETTER_AUTH_URL` | The app's public origin, for example `https://pushstack.staging.nandan.fyi`. It is the only trusted origin for Better Auth. |
| `R2_BUCKET_NAME` | Bucket name used to build presigned upload URLs. |
| `R2_ENDPOINT` | R2 S3 API endpoint, `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Used only to presign URLs. |

Optional vars:

| Name | Purpose |
| --- | --- |
| `VITE_SENTRY_DSN` | Public Sentry DSN. Unset, the Sentry SDK does nothing. |
| `RESEND_EMAIL_FROM` | Sender address for transactional email. |
| `PUSHSTACK_PERF_LOG` | `1` turns on server-side perf logs (see [performance.md](/docs/internals/performance)). |
| `GIT_CACHE_MAX_SIZE` | Byte budget for the raw R2 object cache. Default 16 MiB. |
| `GIT_CACHE_TTL` | Default TTL for cached objects, in seconds. Default 3600. |
| `GIT_HTTP_MAX_BODY_BYTES` | Largest git push body accepted. Default 16 MiB. |
| `SLOW_REQUEST_MS` | Requests slower than this are logged as warnings. Default 3000. |
| `RATE_LIMIT_*` | Rate-limit windows and counts, read in `apps/web/src/server/config.ts`. |

Required secret (`wrangler secret put`):

| Name | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Session signing secret. Generate with `pnpm dlx @better-auth/cli secret`. |

Optional secrets:

| Name | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Sends password reset and email verification mail through Resend. |
| `R2_ACCESS_KEY_ID` | R2 S3 credential, used only to presign browser uploads (`presignR2Put` in `apps/web/src/lib/r2.ts`). |
| `R2_SECRET_ACCESS_KEY` | Pair of `R2_ACCESS_KEY_ID`, same use. |

The R2 S3 credentials exist for one job. A bucket binding cannot sign a URL, so
release-asset uploads too large for a request body are `PUT` by the browser straight
to R2 on a presigned URL. Without them, release assets over 4,000,000 bytes cannot
be uploaded. Everything else goes through `GIT_BUCKET`.

Build-time variables (read by `apps/web/vite.config.ts` in the Node build, not by the
Worker):

```bash
SENTRY_AUTH_TOKEN=...   # when set, the Sentry Vite plugin uploads source maps
SENTRY_ORG=...
SENTRY_PROJECT=...
```

Unset `SENTRY_AUTH_TOKEN` and the build skips the upload, so local and dev builds
need no Sentry account.

### Local development

`pnpm dev` runs the Worker under workerd with a simulated local R2 bucket and D1
database. Put the secrets and any optional vars in `apps/web/.dev.vars`, one
`KEY=value` per line. There is no database URL to set: `pnpm dev` uses the
simulated D1 unless wrangler is told otherwise.

## Database

The database is Cloudflare D1 (SQLite), bound as `DB`. `apps/web/src/db/index.ts`
wraps the binding in Drizzle's `drizzle-orm/d1` client, created at module scope.
There is no connection string, pool or secret for it. See
[database.md](/docs/internals/database) for the schema and migrations.

Schema changes reach the database only as migrations in `apps/web/migrations/`,
applied with `pnpm --filter @pushstack/web db:migrate:remote`. `rate_limits`, the
shared auth rate-limiter counter table ([security.md](/docs/internals/security)),
is part of that schema. A deploy that introduces it must have the migrations
applied to the target database *before* the code that writes to it is live.
Otherwise the first rate-limited request fails against a missing table.

## Response headers

Dynamic responses get the static security headers and `X-Robots-Tag` from
`apps/web/src/server/security-headers.ts`, applied by a request middleware registered
in `src/start.ts`. Static assets get the same headers from `apps/web/public/_headers`,
and a test keeps the two in step. The nonce-based Content-Security-Policy is built per
request in `src/server/csp.ts`.

Client IP comes from `CF-Connecting-IP`, which Cloudflare sets on every request. Rate
limits and Better Auth both use it. `X-Forwarded-For` and `X-Real-IP` are ignored
because a caller can set them.

## Error tracking

On the server, `withSentry` from `@sentry/cloudflare` wraps the Worker's default export
in `apps/web/src/server.ts`. In the browser, the SDK is `@sentry/tanstackstart-react`,
loaded lazily. Both are no-ops without a DSN.

## Crawler traffic

Every repo view (`blob`, `blame`, `raw`, `tree`, `commit`, `archive`) renders in the
Worker, and the HTML is not cacheable: it carries a per-request CSP nonce and
session-dependent content. Crawlers are therefore refused at two layers:

- `apps/web/public/robots.txt` disallows everything for every agent. Every response
  carries `X-Robots-Tag: noindex, nofollow, noarchive, noimageai, noai`. Well-behaved
  crawlers stop here.
- Rate limits in `apps/web/src/server/config.ts` cap anonymous git reads and API
  requests per client IP. Git smart HTTP is limited separately from the REST API.

`raw` and `archive` already set `Cache-Control` through `cacheControl()` in
`src/server/raw.ts`: commit-pinned URLs are immutable, and branch URLs get a
60-second `s-maxage`.

## isomorphic-git, not a native binary

There's no native `git` binary dependency anywhere. All git operations go through
isomorphic-git, with a custom `fs` plugin (`git-fs.ts`, built on the published
`git-fs-s3` package) that reads and writes objects directly in R2. See
[git-storage.md](/docs/internals/git-storage) for the read and write model. No
operation needs a working directory, since commits and merges are built on the object
graph. The Worker does not need a `git` binary.

## Workers

| Worker | Source | Config |
| --- | --- | --- |
| `pushstack-staging` | `apps/web` | `apps/web/wrangler.jsonc` |
| `pushstack-docs` | `apps/docs` | `apps/docs/wrangler.jsonc` |

Both are Node-compat Workers deployed with wrangler. The docs site needs no database,
auth secret or object-storage credentials.
