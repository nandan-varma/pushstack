---
title: "Commit signature verification"
description: "GPG and SSH signing keys, what Verified means, and where the verdicts come from."
---

Commits and annotated tags carry an optional signature. PushStack verifies it against the signing keys a user registered and reports GitHub's `verification` object on REST commit and tag JSON, and `Commit.signature` in GraphQL. A commit is **Verified** only when all three hold:

1. The object carries a signature header (`gpgsig` on a commit; an armored block appended to an annotated tag).
2. The signature names an OpenPGP or SSH key registered to an account whose verified email is the committer (or tagger) email.
3. The signature checks out cryptographically against that key.

Otherwise `verification.reason` carries GitHub's own value (`unsigned`, `unknown_key`, `bad_email`, `unverified_email`, `no_user`, `invalid`, `malformed_signature`, `unknown_signature_type`, `expired_key`, `not_signing_key`); `valid` is the only reason that sets `verified: true`.

The signed bytes are what Git signed: a commit object with its `gpgsig`/`gpgsig-sha256` header removed, and for a tag everything before the appended armor. A lightweight tag has no signature. A tag's REST `message` drops the signature block while `verification.payload` keeps the signed bytes, as GitHub serves it.

## Libraries

`openpgp` parses keys and signatures; we never implement packet parsing. SSH signatures use Node's `crypto`: a small length-prefixed reader parses the SSHSIG container, the covered bytes are rebuilt per [PROTOCOL.sshsig](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.sshsig), and `crypto.verify` checks ed25519, ECDSA and RSA. The npm `sshsig` package hardcodes the `file` namespace and so rejects Git's `git` signatures — that is why it is not used. The public key embedded in the signature must match the registered key's OpenSSH SHA256 fingerprint before the result is trusted. `openpgp` is server-only and never bundled into the browser.

## Keys

`gpg_keys` and `ssh_signing_keys` belong to a user row and hold only public keys: a GPG row keeps the armored key, its key ids (used to match an issuer without re-parsing), the emails and signing capability and validity dates; an SSH row keeps the public-key line, title and fingerprint. Every REST route is scoped to the token's owner, so a key on another account never verifies a commit. Adding or deleting a key needs a `repo:write` token (there is no `write:gpg_key` scope here); reads take any token. A private key in `armored_public_key` is a `422`. Deleting a key never rewrites history — its commits simply become `unknown_key` — and a key is capped by `MAX_SIGNING_KEYS_PER_USER` (creating past it is `422`).

## Cache

Verdicts are memoized in-process per object oid for five minutes (`ttl-cache.ts`), unsigned commits included, so a repeat look costs no object read or query. A key create or delete calls `clearVerificationCache()`, so the instance that handled the write reflects it immediately while other instances converge within the TTL.

## Deploy order

The schema change is additive — two new tables, no altered columns — so push the schema (`pnpm db:push`), then deploy the code: before it, unsigned commits short-circuit and the key routes return `404`. No backfill is needed, since verification is computed from the Git object on read.

Not verified: S/MIME and X.509 signatures (`unknown_signature_type`). Verification is a property of the object and the key registry, not of repository access. The web UI has no key settings page; REST and GraphQL are the surface.
