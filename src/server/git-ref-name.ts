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
