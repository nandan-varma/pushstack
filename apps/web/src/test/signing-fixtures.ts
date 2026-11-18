/**
 * Fixed signing-key fixtures for API tests: one armored OpenPGP public key and
 * one SSH key with an SSHSIG signature over {@link SSH_SIGNED_PAYLOAD}. They
 * are test data, not secrets — both private halves were discarded.
 */

/** An ed25519 OpenPGP public key whose user id is `gpg@pushstack.test`. */
export const GPG_PUBLIC_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

xjMEav0O4BYJKwYBBAHaRw8BAQdA3G6NOKAByWvnximbrzEUIRcM/X2LNuF6
Lv3ZeyI71FrNHEZpeHR1cmUgPGdwZ0BwdXNoc3RhY2sudGVzdD7CwBMEExYK
AIUFgmr9DuADCwkHCRBoFCd00SdClkUUAAAAAAAcACBzYWx0QG5vdGF0aW9u
cy5vcGVucGdwanMub3JniyPRJK816pMTwp0YdersSiJ4h0pb9hP517VOu5KQ
JPkFFQoIDgwEFgACAQIZAQKbAwIeARYhBNguGFSKQSDvxkOd8GgUJ3TRJ0KW
AAB9gwEA6K4nmN1mwoIBAOE0RAOqUJ+x1QybbYsSxGwzfBky0B8BANTntH+b
oklw4w6y1OV9W8LcGRIA48wGhqSbSHGntFUNzjgEav0O4BIKKwYBBAGXVQEF
AQEHQBnYspTI25P1a383YDA/RmPPI6VuQGlGop6edOZdbOcMAwEIB8K+BBgW
CgBwBYJq/Q7gCRBoFCd00SdClkUUAAAAAAAcACBzYWx0QG5vdGF0aW9ucy5v
cGVucGdwanMub3JndPZGPtknjlaWTm7YG8B3TyqRiHr7rjnuPoSIDyEIcG0C
mwwWIQTYLhhUikEg78ZDnfBoFCd00SdClgAA4VcA+wT+NKcySA9CtaQFLeM/
D1fkF7AZ4hGcm7cDSpKrDg+cAQDumpURXXfO898VUmGh+UlZsnXsjEiz+4I7
mGm5fusyAQ==
=iNp/
-----END PGP PUBLIC KEY BLOCK-----`;

/** An OpenSSH ed25519 public key (comment `ssh fixture`). */
export const SSH_PUBLIC_KEY = `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC3dBvbuAJjQOLLi7Eu0i+S5H2uDF6WOuwbduLcnhP1B ssh fixture`;

/** The exact commit content the SSH fixture signature covers. */
export const SSH_SIGNED_PAYLOAD = `tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904
author Sig User <sig@pushstack.test> 1700000000 +0000
committer Sig User <sig@pushstack.test> 1700000000 +0000

SSH signed commit
`;

/** `ssh-keygen -Y sign -n git` over {@link SSH_SIGNED_PAYLOAD}. */
export const SSH_SIGNATURE = `-----BEGIN SSH SIGNATURE-----
U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgLd0G9u4AmNA4suLsS7SL5Lkfa4
MXpY67Bt24tyeE/UEAAAADZ2l0AAAAAAAAAAZzaGE1MTIAAABTAAAAC3NzaC1lZDI1NTE5
AAAAQDb8TXv+a1iRaDLmcrm0NV94Dx6WM4W9dVfGyCKdEHA7e/UkIka3/4slIOBxR4UB/K
V5LAiOuopDHFG9YMzegQQ=
-----END SSH SIGNATURE-----`;

/** An annotated tag's content covered by {@link SSH_TAG_SIGNATURE}. */
export const SSH_TAG_PAYLOAD = `object aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
type commit
tag v1
tagger Sig User <sig@pushstack.test> 1700000000 +0000

SSH signed tag
`;

/** `ssh-keygen -Y sign -n git` over {@link SSH_TAG_PAYLOAD}. */
export const SSH_TAG_SIGNATURE = `-----BEGIN SSH SIGNATURE-----
U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgLd0G9u4AmNA4suLsS7SL5Lkfa4
MXpY67Bt24tyeE/UEAAAADZ2l0AAAAAAAAAAZzaGE1MTIAAABTAAAAC3NzaC1lZDI1NTE5
AAAAQPAd8emIsnrzweuc9oiRsUtGBVdA1hRrW38hvFhgY3Vgb3uLIHP0IxrjKbrp5QiNi1
NZcBgXLF/T4A4tgBsARA0=
-----END SSH SIGNATURE-----`;
