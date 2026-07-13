import path from "node:path";
import git from "isomorphic-git";
import type { getBareRepoOptions } from "./git-manager-iso";
import type { getRepoOptions } from "./git-repo-storage";

export interface TreeEntry {
	path: string;
	mode: string;
	type: "blob" | "tree";
	oid: string;
	size?: number;
}

// Build/update a git tree by overlaying new blobs onto an existing tree
export async function upsertTree(
	repo: ReturnType<typeof getBareRepoOptions>,
	treeOid: string | undefined,
	entries: Map<string, string>, // relativePath -> blobOid
): Promise<string> {
	const existing = treeOid
		? (await git.readTree({ ...repo, oid: treeOid })).tree
		: [];
	const byName = new Map(existing.map((e) => [e.path, e]));
	const direct = new Map<string, string>();
	const nested = new Map<string, Map<string, string>>();
	for (const [filePath, blobOid] of entries) {
		const slash = filePath.indexOf("/");
		if (slash === -1) {
			direct.set(filePath, blobOid);
		} else {
			const dir = filePath.slice(0, slash);
			const rest = filePath.slice(slash + 1);
			if (!nested.has(dir)) nested.set(dir, new Map());
			nested.get(dir)?.set(rest, blobOid);
		}
	}
	for (const [name, blobOid] of direct) {
		byName.set(name, {
			mode: "100644",
			path: name,
			oid: blobOid,
			type: "blob",
		});
	}
	for (const [dir, subEntries] of nested) {
		const entry = byName.get(dir);
		const subtreeOid = entry?.type === "tree" ? entry.oid : undefined;
		const newOid = await upsertTree(repo, subtreeOid, subEntries);
		byName.set(dir, { mode: "040000", path: dir, oid: newOid, type: "tree" });
	}
	return git.writeTree({ ...repo, tree: Array.from(byName.values()) });
}

// Remove a file path from a tree, returning the new root tree OID
export async function deleteFromTree(
	repo: ReturnType<typeof getBareRepoOptions>,
	treeOid: string,
	filePath: string,
): Promise<string> {
	const existing = (await git.readTree({ ...repo, oid: treeOid })).tree;
	const byName = new Map(existing.map((e) => [e.path, e]));
	const slash = filePath.indexOf("/");
	if (slash === -1) {
		byName.delete(filePath);
	} else {
		const dir = filePath.slice(0, slash);
		const rest = filePath.slice(slash + 1);
		const entry = byName.get(dir);
		if (entry?.type === "tree") {
			const newOid = await deleteFromTree(repo, entry.oid, rest);
			byName.set(dir, { ...entry, oid: newOid });
		}
	}
	return git.writeTree({ ...repo, tree: Array.from(byName.values()) });
}

export async function findTreeEntry(
	repo: Awaited<ReturnType<typeof getRepoOptions>>,
	rootTreeOid: string,
	treePath: string,
): Promise<TreeEntry | null> {
	if (!treePath) {
		return {
			path: "",
			mode: "040000",
			type: "tree",
			oid: rootTreeOid,
		};
	}

	const parts = treePath.split("/").filter(Boolean);
	let currentTreeOid = rootTreeOid;
	let currentPath = "";

	for (const [index, part] of parts.entries()) {
		const tree = await git.readTree({ ...repo, oid: currentTreeOid });
		const entry = tree.tree.find((candidate) => candidate.path === part);

		if (!entry) {
			return null;
		}

		currentPath = currentPath
			? path.posix.join(currentPath, entry.path)
			: entry.path;

		if (index === parts.length - 1) {
			return {
				path: currentPath,
				mode: entry.mode,
				type: entry.type as "blob" | "tree",
				oid: entry.oid,
			};
		}

		if (entry.type !== "tree") {
			return null;
		}

		currentTreeOid = entry.oid;
	}

	return null;
}

export async function listTreeEntries(
	repo: Awaited<ReturnType<typeof getRepoOptions>>,
	treeOid: string,
	prefix: string = "",
): Promise<TreeEntry[]> {
	const tree = await git.readTree({ ...repo, oid: treeOid });

	return tree.tree.map((entry) => ({
		path: prefix ? path.posix.join(prefix, entry.path) : entry.path,
		mode: entry.mode,
		type: entry.type as "blob" | "tree",
		oid: entry.oid,
	}));
}
