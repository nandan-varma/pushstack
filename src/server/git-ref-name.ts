import {
	isFullSha,
	isSafeBranchName,
	isSafeFullRefName,
	isSafeRefName,
	isSafeRepoPath,
} from "@nandan-varma/git-fs-s3";
import { z } from "zod";

// Git ref-name/path validation now lives in @nandan-varma/git-fs-s3's refs.ts
// (extracted from an earlier version of this exact file — see that package's
// own doc comment for the full rationale: several isomorphic-git primitives —
// git.commit, git.merge, git.deleteBranch, and the top-level git.resolveRef/
// git.deleteRef used directly by git-fs-s3's receive-pack handler — do NOT
// validate ref names internally, so anything from request input must be
// checked before it reaches any of them or a "../"-laden name lets a caller
// with write access to any single repo read, corrupt, or delete another
// repo's storage). Re-exported here so every branch-name-shaped field in this
// app still imports from one place; only the zod-schema wrappers below are
// pushstack-local additions.
export {
	isFullSha,
	isSafeBranchName,
	isSafeFullRefName,
	isSafeRefName,
	isSafeRepoPath,
};

export const safeBranchNameSchema = z
	.string()
	.min(1)
	.refine(isSafeBranchName, "Invalid branch name");

export const safeCommitShaSchema = z
	.string()
	.refine(isFullSha, "Invalid commit SHA");

export const safeRefNameSchema = z
	.string()
	.min(1)
	.refine(isSafeRefName, "Invalid ref name");

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
