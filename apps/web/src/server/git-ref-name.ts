/**
 * Zod schemas for every branch/ref/path-shaped input. Several isomorphic-git
 * primitives (commit, merge, deleteBranch, resolveRef, deleteRef) don't
 * validate ref names, and gitFs resolves `..` in the paths it maps onto R2
 * keys — an unvalidated name is a cross-repository traversal.
 */
import {
	isFullSha,
	isSafeBranchName,
	isSafeRefName,
	isSafeRepoPath,
} from "git-fs-s3";
import { z } from "zod";

/** A bare branch name (write paths: never a sha). */
export const safeBranchNameSchema = z
	.string()
	.min(1)
	.refine(isSafeBranchName, "Invalid branch name");

/** A full 40-hex commit sha. */
export const safeCommitShaSchema = z
	.string()
	.refine(isFullSha, "Invalid commit SHA");

/** A branch name or a full commit sha (read paths, e.g. permalinks). */
export const safeRefNameSchema = z
	.string()
	.min(1)
	.refine(isSafeRefName, "Invalid ref name");

/**
 * What GitHub's `/commit/{rev}` accepts: a branch, tag, `HEAD`, a full sha or
 * an abbreviated sha. Abbreviations (4+ hex) pass as ref names; the tag/branch
 * spelling is checked against the same traversal rules as any ref.
 */
export const safeCommitRevSchema = z
	.string()
	.min(1)
	.refine((rev) => rev === "HEAD" || isSafeRefName(rev), "Invalid revision");

/** A repository-relative path (`""` is the root). */
export const safeRepoPathSchema = z
	.string()
	.refine(isSafeRepoPath, "Invalid path");
