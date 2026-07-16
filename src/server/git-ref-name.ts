import { z } from "zod";

// Git ref-name validation, mirrored from isomorphic-git's own internal `bad`
// pattern (the one `git.branch`/the top-level `git.writeRef` check refs
// against before touching disk — see node_modules/isomorphic-git's
// isValidRef). Several of isomorphic-git's OTHER ref-touching primitives —
// git.commit, git.merge, git.deleteBranch, and the top-level git.resolveRef/
// git.deleteRef used directly by git-http-iso.ts's receive-pack handler —
// do NOT run this check internally: they resolve straight through
// fs.write/fs.rm(join(gitdir, ref)) with no jail to gitdir. Every branch/ref
// name that originates from request input (a branch name typed into the UI,
// a pushed ref-update command, a pull request's source/target branch) must
// be validated against this before it reaches any of those primitives —
// otherwise a "../"-laden name lets a caller with write access to any single
// repo read, corrupt, or delete another repo's local ref/object files that
// happen to sit under the same shared base directory (see getRepoPath in
// git-manager-iso.ts).
const BAD_REF_COMPONENT =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control chars are exactly what git's own ref-name rules reject — this needs to match the same range.
	/(^|[/.])([/.]|$)|^@$|@\{|[\x00-\x20\x7f~^:?*[\\]|\.lock(\/|$)/;

/** Validates a fully-qualified ref (must start with refs/heads/ or refs/tags/). */
export function isSafeFullRefName(ref: string): boolean {
	if (!ref.startsWith("refs/heads/") && !ref.startsWith("refs/tags/")) {
		return false;
	}
	return !BAD_REF_COMPONENT.test(ref);
}

/**
 * Validates a bare branch name (no refs/ prefix) — the shape every branch
 * name entering this app from user input takes (uploadFile's branchName,
 * createBranch's name/fromBranch, a PR's source/target branch, ...). Rejects
 * anything that looks like a full ref path: a name of "refs/heads/x" would
 * otherwise sail through unprefixed at call sites that build
 * `refs/heads/${name}` themselves (doubling the prefix into something that
 * still resolves), or be used as-is at call sites that pass a name already
 * containing "refs/" straight through — rejecting the prefix here closes
 * both off at the source.
 */
export function isSafeBranchName(name: string): boolean {
	if (!name || name.startsWith("refs/") || name === "HEAD") return false;
	if (/^[0-9a-f]{40}$/i.test(name)) return false;
	return !BAD_REF_COMPONENT.test(name);
}

export const safeBranchNameSchema = z
	.string()
	.min(1)
	.refine(isSafeBranchName, "Invalid branch name");

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

/** True for a full 40-hex-char commit SHA — the shape `isSafeBranchName` deliberately rejects. */
export function isFullSha(value: string): boolean {
	return FULL_SHA_RE.test(value);
}

export const safeCommitShaSchema = z
	.string()
	.refine(isFullSha, "Invalid commit SHA");

/**
 * Validates a "ref" field that may name either a branch or a commit it's
 * pinned to — the shape the blob/tree/history viewers' route params take
 * (e.g. the Permalink button on the blob page generates a URL with a full
 * commit SHA in place of the branch name, and the "Raw" link reuses whatever
 * ref the page is currently viewing). isSafeBranchName alone rejects a
 * 40-hex-char value on purpose (to keep a stored branch name from ever being
 * ambiguous with a SHA at write time) — this is for read paths that need to
 * accept both shapes, without weakening the traversal check either shape is
 * still run through.
 */
export function isSafeRefName(value: string): boolean {
	return isSafeBranchName(value) || isFullSha(value);
}

export const safeRefNameSchema = z
	.string()
	.min(1)
	.refine(isSafeRefName, "Invalid ref name");

// Shared with api/raw.$.ts, which reads path segments straight off the URL
// rather than through files.ts's createServerFn validators — any new place
// that accepts a repo-relative file path from request input should validate
// it the same way rather than re-deriving these checks ad hoc.
export function isSafeRepoPath(p: string): boolean {
	if (p.startsWith("/")) return false;
	if (p.split("/").some((segment) => segment === "..")) return false;
	if (/^\.git(\/|$)/i.test(p)) return false;
	if (p.includes("\0")) return false;
	return true;
}

export const safeRepoPathSchema = z
	.string()
	.refine((p) => !p.startsWith("/"), "Path must be relative")
	.refine(
		(p) => !p.split("/").some((segment) => segment === ".."),
		"Path must not contain '..' segments",
	)
	.refine(
		(p) => !/^\.git(\/|$)/i.test(p),
		"Path must not reference git internals",
	)
	.refine((p) => !p.includes("\0"), "Path must not contain null bytes");
