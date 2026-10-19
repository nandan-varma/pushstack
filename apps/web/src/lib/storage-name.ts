/**
 * The one rule for a repository name or a username.
 *
 * It is a security boundary, not cosmetics: the value becomes a single segment
 * of a repository's storage prefix (`repos/{ownerKey}/{repoName}`), and `gitFs`
 * resolves `..` in the paths it maps onto keys — so a name containing a
 * separator or a `..` addresses another repository's storage. Names are
 * validated at input and checked again when a key is built
 * (`src/server/git-storage-naming.ts`); see `apps/docs/content/docs/internals/security.md`.
 *
 * Client-safe on purpose (no imports, nothing server-only): the sign-up and
 * create-repository forms have to enforce the same rule the server does. A form
 * that accepts what the server rejects makes the user discover the rule from an
 * error, and one that rejects what the server accepts blocks valid names.
 */

/** Letters, digits, `.`, `-`, `_`; alphanumeric at both ends; never `.` or `..`. */
export const STORAGE_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * The same rule as an HTML `pattern` attribute — **derived from the regex** so
 * the two cannot drift. HTML anchors a pattern implicitly (`^(?:…)$`), and
 * `storage-name.test.ts` asserts that equivalence over a table of names.
 */
export const STORAGE_NAME_PATTERN = STORAGE_NAME_RE.source
	.replace(/^\^/, "")
	.replace(/\$$/, "");

/** Longest accepted name — the server's zod schema caps names at this. */
export const MAX_STORAGE_NAME_LENGTH = 100;

/** Longest accepted username — Better Auth's `maxUsernameLength` in `lib/auth.ts`. */
export const MAX_USERNAME_LENGTH = 30;

/** The rule in words, for a form hint or a `title` attribute. */
export const STORAGE_NAME_HINT =
	"Letters, numbers, dots, hyphens and underscores, starting and ending with a letter or number";
