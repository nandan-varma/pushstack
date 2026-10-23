/**
 * The tree-entry name checks of git's `fsck` (what `receive.fsckObjects`
 * enforces on GitHub), so a push cannot plant names that become path
 * traversal or a nested `.git` in an archive or a checkout.
 */

import git from "isomorphic-git";
import { getObjectTypes } from "../object-size.js";
import type { Repo } from "../ops/types.js";
import { createSemaphore } from "../semaphore.js";

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

/**
 * Name-check every tree among `oids` (a pack just stored), reachable or not:
 * an unreferenced bad tree must not be storable and referenced by a later
 * push. Bounded by the pack. Returns the first failure as an fsck-style
 * message, or null when every tree is fine.
 */
export async function findInvalidTree(
	repo: Repo,
	oids: Iterable<string>,
): Promise<string | null> {
	const types = await getObjectTypes(repo, [...oids]);
	// A type the headers could not give (null) fails closed: the object is
	// read and checked if it is a tree, and rejected if it cannot be read.
	const candidates = [...types].filter(
		([, type]) => type === "tree" || type === null,
	);
	const reads = createSemaphore(16);
	let found: string | null = null;
	await Promise.all(
		candidates.map(([oid, type]) =>
			reads.run(async () => {
				if (found) return;
				try {
					const obj = await git.readObject({ ...repo, oid });
					if (obj.type !== "tree") return;
					for (const entry of obj.object as { path: string }[]) {
						const problem = treeEntryNameProblem(entry.path);
						if (problem) {
							found ??= `object ${oid}: ${problem.id}: ${problem.message}`;
							return;
						}
					}
				} catch (error) {
					// isomorphic-git refuses to parse `..`, `.git`, a backslash, …
					const e = error as { code?: string; data?: { filepath?: string } };
					if (e?.code === "UnsafeFilepathError") {
						const name = e.data?.filepath ?? "";
						const problem = treeEntryNameProblem(name);
						found ??= `object ${oid}: ${problem?.id ?? "hasUnsafeName"}: ${problem?.message ?? `contains unsafe name '${name}'`}`;
						return;
					}
					found ??= `object ${oid}: unreadable ${type === "tree" ? "tree" : "object"}`;
				}
			}),
		),
	);
	return found;
}
