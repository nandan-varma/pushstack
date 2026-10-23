/**
 * The tree-entry name checks of git's `fsck` (what `receive.fsckObjects`
 * enforces on GitHub), so a push cannot plant names that become path
 * traversal or a nested `.git` in an archive or a checkout.
 */

export interface TreeNameProblem {
	/** git's fsck message id (`hasDotdot`, …). */
	id: string;
	message: string;
}

/** Code points HFS+ ignores when comparing names (git's `is_hfs_ignorable`). */
const HFS_IGNORABLE = /[‌-‏‪-‮⁪-⁯﻿]/gu;

/**
 * `.git` as NTFS resolves it: trailing dots/spaces, a `:stream` suffix or a
 * `\` separator after it, or its 8.3 name `git~1` (git's `is_ntfs_dotgit`).
 */
function isNtfsDotgit(name: string): boolean {
	const lower = name.toLowerCase();
	const stem = lower.startsWith(".git")
		? lower.slice(4)
		: lower.startsWith("git~1")
			? lower.slice(5)
			: null;
	if (stem === null) return false;
	const end = stem.search(/[:\\]/);
	return /^[ .]*$/.test(end === -1 ? stem : stem.slice(0, end));
}

function isDotgit(name: string): boolean {
	return (
		name.toLowerCase() === ".git" ||
		name.replace(HFS_IGNORABLE, "").toLowerCase() === ".git" ||
		isNtfsDotgit(name)
	);
}

/** Why `name` is not allowed as a tree entry, or null when it is fine. */
export function treeEntryNameProblem(name: string): TreeNameProblem | null {
	if (name === "") {
		return { id: "emptyName", message: "contains empty pathname" };
	}
	if (name === ".") return { id: "hasDot", message: "contains '.'" };
	if (name === "..") return { id: "hasDotdot", message: "contains '..'" };
	if (name.includes("/")) {
		return { id: "fullPathname", message: "contains full pathname" };
	}
	if (name.includes("\0")) {
		return { id: "nulInName", message: "contains NUL in a name" };
	}
	if (isDotgit(name)) return { id: "hasDotgit", message: "contains '.git'" };
	return null;
}
