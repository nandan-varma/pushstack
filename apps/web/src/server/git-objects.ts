/**
 * The REST API's Git database writes — blobs, trees, commits, annotated tags
 * and refs — each under the repository lock. Objects land as packs (never
 * loose); since a client writes them before any ref names them, their packs
 * carry a `.keep` for a day so a repack in between can't drop them as
 * unreachable. Refusals are GitInvalidRequestError (the API's 422).
 */
import {
	existingObjects,
	GitInvalidRequestError,
	isFullSha,
	isNotFoundError,
	isSafeBranchName,
	isSafeTreePath,
} from "git-fs-s3";
import { type Repo, withPackedWrites } from "git-fs-s3/ops";
import git from "isomorphic-git";
import { repoFor } from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";

/** How long unreferenced objects a client wrote survive repacks. */
const OBJECT_KEEP_MS = 24 * 60 * 60 * 1000;

function writeObjects<T>(
	ownerKey: string,
	repoName: string,
	fn: (repo: Repo) => Promise<T>,
): Promise<T> {
	return withRepositoryLock(ownerKey, repoName, () =>
		withPackedWrites(repoFor(ownerKey, repoName), fn, {
			keepUntil: new Date(Date.now() + OBJECT_KEEP_MS),
		}),
	);
}

const invalid = (message: string) => new GitInvalidRequestError(message);

/** The object type at `oid`, or null when the repository doesn't have it. */
async function objectType(repo: Repo, oid: string): Promise<string | null> {
	if (!isFullSha(oid)) return null;
	try {
		const { type } = await git.readObject({ ...repo, oid, format: "parsed" });
		return type;
	} catch (error) {
		if (isNotFoundError(error)) return null;
		throw error;
	}
}

export function createBlobObject(
	ownerKey: string,
	repoName: string,
	content: Uint8Array,
): Promise<string> {
	return writeObjects(ownerKey, repoName, (repo) =>
		git.writeBlob({ ...repo, blob: content }),
	);
}

export interface GitIdentityInput {
	name: string;
	email: string;
	/** When it happened; default now. */
	date?: Date;
}

function signature({ name, email, date }: GitIdentityInput) {
	return {
		name,
		email,
		timestamp: Math.floor((date ?? new Date()).getTime() / 1000),
		timezoneOffset: 0,
	};
}

export type TreeEntryMode =
	| "100644"
	| "100755"
	| "040000"
	| "160000"
	| "120000";

export interface TreeEntryInput {
	path: string;
	mode: TreeEntryMode;
	type: "blob" | "tree" | "commit";
	/** The object; `null` deletes the path from `base_tree`. */
	sha?: string | null;
	/** UTF-8 content for a new blob (instead of `sha`). */
	content?: string;
}

const TYPE_OF_MODE: Record<TreeEntryMode, TreeEntryInput["type"]> = {
	"100644": "blob",
	"100755": "blob",
	"120000": "blob",
	"040000": "tree",
	"160000": "commit",
};

interface PendingEntry {
	segments: string[];
	mode: TreeEntryMode;
	type: TreeEntryInput["type"];
	/** null: delete. */
	oid: string | null;
}

/** Check entries before taking the lock: shape, paths, modes, duplicates. */
function validateTreeEntries(entries: TreeEntryInput[]): void {
	const paths = new Set<string>();
	for (const entry of entries) {
		if (!isSafeTreePath(entry.path)) {
			throw invalid(`tree.path ${entry.path} is invalid`);
		}
		if (paths.has(entry.path)) {
			throw invalid(`tree.path ${entry.path} appears more than once`);
		}
		paths.add(entry.path);
		if (TYPE_OF_MODE[entry.mode] !== entry.type) {
			throw invalid(`tree.mode ${entry.mode} doesn't match type ${entry.type}`);
		}
		const hasSha = entry.sha !== undefined;
		if (hasSha === (entry.content !== undefined)) {
			throw invalid(
				`tree entry ${entry.path} needs exactly one of sha or content`,
			);
		}
		if (entry.content !== undefined && entry.type !== "blob") {
			throw invalid(`tree entry ${entry.path}: content is for blobs only`);
		}
		if (typeof entry.sha === "string" && !isFullSha(entry.sha)) {
			throw invalid(`tree.sha ${entry.sha} is not a valid object`);
		}
	}
}

/** Apply `entries` (relative to this directory) to the tree `baseOid`; null when it ends up empty. */
async function applyEntries(
	repo: Repo,
	baseOid: string | undefined,
	entries: PendingEntry[],
	isRoot: boolean,
): Promise<string | null> {
	const existing = baseOid
		? (await git.readTree({ ...repo, oid: baseOid })).tree
		: [];
	const byName = new Map(existing.map((entry) => [entry.path, entry]));
	const nested = new Map<string, PendingEntry[]>();
	for (const entry of entries) {
		const [name, ...rest] = entry.segments as [string, ...string[]];
		if (rest.length > 0) {
			nested.set(name, [
				...(nested.get(name) ?? []),
				{ ...entry, segments: rest },
			]);
		} else if (entry.oid === null) {
			byName.delete(name);
		} else {
			byName.set(name, {
				path: name,
				mode: entry.mode,
				oid: entry.oid,
				type: entry.type,
			});
		}
	}
	for (const [name, children] of nested) {
		const current = byName.get(name);
		const childOid = await applyEntries(
			repo,
			current?.type === "tree" ? current.oid : undefined,
			children,
			false,
		);
		if (childOid === null) byName.delete(name);
		else
			byName.set(name, {
				path: name,
				mode: "040000",
				oid: childOid,
				type: "tree",
			});
	}
	if (byName.size === 0 && !isRoot) return null;
	return git.writeTree({ ...repo, tree: [...byName.values()] });
}

/**
 * `POST …/git/trees`: a tree from `base_tree` (if any) with `entries`
 * applied — nested paths create or edit subtrees, a `null` sha deletes.
 */
export function createTreeObject(
	ownerKey: string,
	repoName: string,
	options: { baseTree?: string; entries: TreeEntryInput[] },
): Promise<string> {
	validateTreeEntries(options.entries);
	return writeObjects(ownerKey, repoName, async (repo) => {
		if (
			options.baseTree !== undefined &&
			(await objectType(repo, options.baseTree)) !== "tree"
		) {
			throw invalid(`base_tree ${options.baseTree} is not a valid tree`);
		}
		const referenced = options.entries.filter(
			(entry): entry is TreeEntryInput & { sha: string } =>
				typeof entry.sha === "string" && entry.type !== "commit",
		);
		// Blobs are only checked for presence (reading one could mean reading
		// megabytes); trees are small enough to check their type too.
		const present = await existingObjects(
			repo,
			referenced.map((entry) => entry.sha),
		);
		for (const entry of referenced) {
			if (!present.has(entry.sha)) {
				throw invalid(`tree.sha ${entry.sha} is not a valid ${entry.type}`);
			}
			if (
				entry.type === "tree" &&
				(await objectType(repo, entry.sha)) !== "tree"
			) {
				throw invalid(`tree.sha ${entry.sha} is not a valid tree`);
			}
		}
		const pending: PendingEntry[] = await Promise.all(
			options.entries.map(async (entry) => ({
				segments: entry.path.split("/"),
				mode: entry.mode,
				type: entry.type,
				oid:
					entry.content !== undefined
						? await git.writeBlob({
								...repo,
								blob: new TextEncoder().encode(entry.content),
							})
						: (entry.sha ?? null),
			})),
		);
		return (await applyEntries(
			repo,
			options.baseTree,
			pending,
			true,
		)) as string;
	});
}

/** `POST …/git/commits`: a commit object; no ref moves. */
export function createCommitObject(
	ownerKey: string,
	repoName: string,
	options: {
		message: string;
		tree: string;
		parents: string[];
		author: GitIdentityInput;
		committer: GitIdentityInput;
	},
): Promise<string> {
	return writeObjects(ownerKey, repoName, async (repo) => {
		if ((await objectType(repo, options.tree)) !== "tree") {
			throw invalid(`Tree SHA ${options.tree} does not exist`);
		}
		for (const parent of options.parents) {
			if ((await objectType(repo, parent)) !== "commit") {
				throw invalid(`Parent SHA ${parent} does not exist`);
			}
		}
		return git.writeCommit({
			...repo,
			commit: {
				message: options.message,
				tree: options.tree,
				parent: options.parents,
				author: signature(options.author),
				committer: signature(options.committer),
			},
		});
	});
}

/** `POST …/git/tags`: an annotated tag object; the ref is created separately, as on GitHub. */
export function createTagObject(
	ownerKey: string,
	repoName: string,
	options: {
		tag: string;
		message: string;
		object: string;
		type: "commit" | "tree" | "blob" | "tag";
		tagger: GitIdentityInput;
	},
): Promise<string> {
	if (!isSafeBranchName(options.tag)) {
		throw invalid(`Invalid tag name: ${options.tag}`);
	}
	return writeObjects(ownerKey, repoName, async (repo) => {
		if ((await objectType(repo, options.object)) !== options.type) {
			throw invalid(`Object ${options.object} is not a valid ${options.type}`);
		}
		return git.writeTag({
			...repo,
			tag: {
				object: options.object,
				type: options.type,
				tag: options.tag,
				tagger: signature(options.tagger),
				message: options.message,
			},
		});
	});
}

/** `refs/heads/…` or `refs/tags/…` with a valid name, else null. */
export function writableRefName(ref: string): string | null {
	const match = /^refs\/(heads|tags)\/(.+)$/.exec(ref);
	return match && isSafeBranchName(match[2] as string) ? ref : null;
}

/** What a ref may point at: branches name commits; tags commits or tag objects. */
async function assertRefTarget(repo: Repo, ref: string, sha: string) {
	const type = await objectType(repo, sha);
	const allowed = ref.startsWith("refs/heads/")
		? type === "commit"
		: type === "commit" || type === "tag";
	if (!allowed) throw invalid("Object does not exist");
}

/** `POST …/git/refs`: a new branch or tag; 422 if it exists. */
export function createRef(
	ownerKey: string,
	repoName: string,
	ref: string,
	sha: string,
): Promise<void> {
	if (!writableRefName(ref)) throw invalid("Reference name is invalid");
	return withRepositoryLock(ownerKey, repoName, async () => {
		const repo = repoFor(ownerKey, repoName);
		await assertRefTarget(repo, ref, sha);
		const exists = await git
			.resolveRef({ ...repo, ref, depth: 1 })
			.then(() => true)
			.catch((error: unknown) => {
				if (isNotFoundError(error)) return false;
				throw error;
			});
		if (exists) throw invalid("Reference already exists");
		await git.writeRef({ ...repo, ref, value: sha });
	});
}

/**
 * `PATCH …/git/refs/{ref}`: move an existing ref. A branch only fast-forwards
 * unless `force` (GitHub's "Update is not a fast forward").
 */
export function updateRef(
	ownerKey: string,
	repoName: string,
	ref: string,
	sha: string,
	force: boolean,
): Promise<void> {
	if (!writableRefName(ref)) throw invalid("Reference does not exist");
	return withRepositoryLock(ownerKey, repoName, async () => {
		const repo = repoFor(ownerKey, repoName);
		const current = await git
			.resolveRef({ ...repo, ref, depth: 1 })
			.catch((error: unknown) => {
				if (isNotFoundError(error)) throw invalid("Reference does not exist");
				throw error;
			});
		await assertRefTarget(repo, ref, sha);
		if (
			!force &&
			current !== sha &&
			!(await git.isDescendent({ ...repo, oid: sha, ancestor: current }))
		) {
			throw invalid("Update is not a fast forward");
		}
		await git.writeRef({ ...repo, ref, value: sha, force: true });
	});
}
