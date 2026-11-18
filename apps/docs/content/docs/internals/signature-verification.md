---
title: "Commit signature verification"
description: "GPG and SSH signing keys, what Verified means, and where the verdicts come from."
---

Commits and annotated tags carry an optional signature. Pushstack verifies
that signature against the signing keys a user registered and reports
GitHub's `verification` object on REST commit and tag JSON, and
`Commit.signature` in GraphQL. A commit shows **Verified** only when all of
the following hold:

1. The object carries a signature header (`gpgsig` on a commit; an armored
   block appended to an annotated tag).
2. The signature names a public OpenPGP key or SSH key registered to a
   **Pushstack account whose verified email is the committer (or tagger)
   email**.
3. The signature checks out cryptographically against that key.

When any check fails the object is unverified and `verification.reason` says
why, using GitHub's values: `unsigned`, `unknown_key`, `bad_email`,
`unverified_email`, `no_user`, `invalid`, `malformed_signature`,
`unknown_signature_type`, `expired_key`, `not_signing_key`. `valid` is the
only reason that sets `verified: true`.

## What signs what

- **Commit**: the signed payload is the commit object with its `gpgsig` (or
  `gpgsig-sha256`) header removed — exactly the bytes Git signed. The
  verifier reads the raw object from R2, splits the header out, and checks the
  armor.
- **Annotated tag**: Git appends the signature to the tag object; the payload
  is everything before the armor.
- A lightweight tag has no signature. Both `git commit -S` with
  `gpg.format = openpgp` and `git commit -S` with `gpg.format = ssh` are
  understood; S/MIME (`smimesign`) yields `unknown_signature_type`.

A tag's REST `message` is the object message without the signature block, as
GitHub serves it; `verification.payload` keeps the signed bytes.

## Libraries

- **OpenPGP** ([`openpgp`](https://www.npmjs.com/package/openpgp), LGPL-3.0+)
  parses keys and signatures and performs verification. Pushstack never
  implements packet parsing.
- **SSH signatures** use Node's `crypto` directly. The SSHSIG container is
  parsed with a small length-prefixed reader (magic, version, embedded public
  key, namespace, reserved, hash algorithm, signature), the covered bytes are
  rebuilt per [OpenSSH's PROTOCOL.sshsig](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.sshsig),
  and `crypto.verify` checks ed25519, ECDSA (P-256/384/521) and RSA
  signatures. The npm `sshsig` package is not used: it hardcodes the `file`
  namespace, so it rejects Git's `git` namespace signatures.
  The verifier matches the public key embedded in the signature against the
  registered key's OpenSSH SHA256 fingerprint before trusting the result.

`openpgp` is a server-only dependency: verification runs while rendering or
serving commit JSON and is never bundled into the browser. It adds nothing
to the client bundle.

## Where keys live

`gpg_keys` and `ssh_signing_keys` in Postgres (`apps/web/src/db/app-schema.ts`),
owned by the user row. Only public keys are stored:

- A GPG row keeps the armored key (`public_key`), its primary key id, every
  primary/subkey id (`key_ids`, used to match a signature's issuer without
  re-parsing the key), the user ids' emails, whether a key can sign, and the
  key's creation and expiry times.
- An SSH row keeps the public-key line, the user's title and the OpenSSH
  SHA256 fingerprint.

The REST endpoints are GitHub's:

| Endpoint | Operation id |
| --- | --- |
| `GET /user/gpg_keys` | `users/list-gpg-keys-for-authenticated-user` |
| `POST /user/gpg_keys` | `users/create-gpg-key-for-authenticated-user` |
| `GET /user/gpg_keys/{gpg_key_id}` | `users/get-gpg-key-for-authenticated-user` |
| `DELETE /user/gpg_keys/{gpg_key_id}` | `users/delete-gpg-key-for-authenticated-user` |
| `GET /user/ssh_signing_keys` | `users/list-ssh-signing-keys-for-authenticated-user` |
| `POST /user/ssh_signing_keys` | `users/create-ssh-signing-key-for-authenticated-user` |
| `GET /user/ssh_signing_keys/{ssh_signing_key_id}` | `users/get-ssh-signing-key-for-authenticated-user` |
| `DELETE /user/ssh_signing_keys/{ssh_signing_key_id}` | `users/delete-ssh-signing-key-for-authenticated-user` |

Every route is scoped to the token's owner; there is no route to another
user's keys and a key belonging to another account never verifies a commit.
Adding and deleting a key need a `repo:write` token (PushStack has no GitHub
`write:gpg_key` / `write:ssh_signing_key` scopes); reads take any token.
A private key in `armored_public_key` is a `422`. Deleting a key never rewrites
history: the commits it signed simply become `unverified`/`unknown_key`.

## Limits and caps

All in `apps/web/src/lib/limits.ts` (mirrored in the API contract for request
validation):

- `MAX_GPG_KEY_CHARS` (65,536) — one armored OpenPGP key per request.
- `MAX_SSH_SIGNING_KEY_CHARS` (2,048) — one OpenSSH public-key line.
- `MAX_SIGNING_KEY_TITLE_CHARS` (100) — the SSH key title.
- `MAX_SIGNING_KEYS_PER_USER` (50) — per collection; creating past it is a
  `422`.
- `MAX_VERIFICATION_CACHE_ENTRIES` (5,000) — verdict cache size.

## Cache

Verdicts are memoized in-process per object oid (`commit:<oid>`, `tag:<oid>`)
for five minutes using `ttl-cache.ts`. A key create or delete calls
`clearVerificationCache()`, so the instance that handled the write reflects it
immediately; other serverless instances converge within the TTL. Unsigned
commits are cached too and cost no object read or query after the first look.
A signed commit costs one raw object read (from R2) plus the account/key
reads for the batch; a page of commits shares those reads.

## Database deploy order

The schema change is additive: two new tables, no altered columns.

1. Push the schema (`pnpm db:push`) — creates `gpg_keys` and
   `ssh_signing_keys`. Nothing reads them yet.
2. Deploy the code. Before the push, commit reads never touch the new tables,
   because unsigned commits short-circuit and the REST key routes return
   `404` (unknown operation); after it, verification works.

No backfill is needed: verification is computed from the Git object on read.

## Not verified

- S/MIME and X.509 signatures (`unknown_signature_type`).
- Re-verification of a commit against a key from a **different** repository:
  verification is a property of the object and the key registry, not of
  repository access.
- The web UI does not yet have a settings page for keys; the REST API and
  GraphQL are the supported surface.
