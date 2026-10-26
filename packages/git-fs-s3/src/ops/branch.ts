import git from "isomorphic-git";
import {
	GitConflictError,
	GitInvalidRequestError,
	isAbsentError,
} from "../git-errors.js";
import { isPullHeadRef, isSafeBranchName } from "../refs.js";
import { peelToCommit } from "./history.js";
import type { Repo } from "./types.js";

export interface Branch {
	name: string;
	commit: string;
	isDefault: boolean;
}

export interface Tag {
	name: string;
	/** The commit the tag names (annotated tags peeled). */
	commit: string;
	/** The tag object's own oid, for annotated tags; absent for lightweight ones. */
	tagObject?: string;
}

/**
 * Defense in depth for every branch-name argument below: `git.deleteBranch`
 * and raw resolveRef/writeRef reads don't validate ref names internally the
 * way `git.branch` does (see refs.ts) — guard at the point the primitives are
 * actually called, not just at an API boundary far above.
 */
export function assertSafeBranchName(name: string): void {
	if (!isSafeBranchName(name)) {
		throw new GitInvalidRequestError(`Invalid branch name: ${name}`);
	}
}

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

type RecursiveFileLister = {
	listFilesRecursively(dirpath: string): Promise<string[]>;
};

export function hasRecursiveFileLister(
	fs: Repo["fs"],
): fs is Repo["fs"] & RecursiveFileLister {
	return (
		typeof fs === "object" &&
		fs !== null &&
		"listFilesRecursively" in fs &&
		typeof (fs as Partial<RecursiveFileLister>).listFilesRecursively ===
			"function"
	);
}

type PromisesFs = {
	readFile(path: string, encoding: "utf8"): Promise<string | Uint8Array>;
};

// Repo.fs is typed as isomorphic-git's own fs union (promise- or
// callback-based) since that's what git.readTree's signature allows, but
// every fs this package actually constructs (git-fs.ts) is promise-based —
// this just keeps the callback-style branch honest instead of crashing on
// it. Shared by every loose-ref fast path below instead of each repeating
// the same cast + presence check.
export function getPromisesFs(fs: Repo["fs"]): PromisesFs | null {
	const promises = (fs as { promises?: PromisesFs }).promises;
	return promises ?? null;
}

function decodeFileContent(content: string | Uint8Array): string {
	return typeof content === "string"
		? content
		: new TextDecoder().decode(content);
}

/**
 * Lists loose branch names without isomorphic-git's recursive readdir/stat
 * traversal. Object stores already return only leaf keys in a recursive LIST,
 * so this is one request regardless of branch-name nesting. Ordinary
 * filesystems retain isomorphic-git's implementation and packed refs remain
 * supported there.
 */
async function listLooseBranches(repo: Repo): Promise<string[] | null> {
	return listLooseRefNames(repo, "refs/heads");
}

/**
 * Loose ref names under `dir` (e.g. `refs/tags`) in one recursive listing,
 * or `null` when the fs can't list recursively (use isomorphic-git's walk).
 */
export async function listLooseRefNames(
	repo: Repo,
	dir: "refs/heads" | "refs/tags",
): Promise<string[] | null> {
	if (!hasRecursiveFileLister(repo.fs)) return null;
	const names = await repo.fs.listFilesRecursively(`${repo.gitdir}/${dir}`);
	return names.filter(isSafeBranchName);
}

/**
 * Every `refs/pull/<n>/head` ref. An object store lists the whole `refs/pull`
 * tree in one recursive LIST; isomorphic-git's walk would read one directory
 * per pull request, so it is only the fallback for other filesystems.
 */
export async function listPullHeadRefNames(repo: Repo): Promise<string[]> {
	const names = hasRecursiveFileLister(repo.fs)
		? await repo.fs.listFilesRecursively(`${repo.gitdir}/refs/pull`)
		: await git.listRefs({ ...repo, filepath: "refs/pull" });
	return names.map((name) => `refs/pull/${name}`).filter(isPullHeadRef);
}

/** Read packed branch refs so the object-store fast path preserves Git semantics. */
async function readPackedBranches(repo: Repo): Promise<Map<string, string>> {
	if (!hasRecursiveFileLister(repo.fs)) return new Map();
	const promisesFs = getPromisesFs(repo.fs);
	if (!promisesFs) return new Map();
	try {
		const content = await promisesFs.readFile(
			`${repo.gitdir}/packed-refs`,
			"utf8",
		);
		const refs = new Map<string, string>();
		for (const line of decodeFileContent(content).split("\n")) {
			const match = /^([0-9a-f]{40}) refs\/heads\/(.+)$/i.exec(line);
			if (match?.[1] && match[2] && isSafeBranchName(match[2])) {
				refs.set(match[2], match[1]);
			}
		}
		return refs;
	} catch (error) {
		if (isAbsentError(error)) return new Map();
		throw error;
	}
}

/** Read the symbolic HEAD directly when the object-store fs is available. */
async function getCurrentLooseBranch(repo: Repo): Promise<string | null> {
	if (!hasRecursiveFileLister(repo.fs)) return null;
	const promisesFs = getPromisesFs(repo.fs);
	if (!promisesFs) return null;
	try {
		const content = await promisesFs.readFile(`${repo.gitdir}/HEAD`, "utf8");
		const head = decodeFileContent(content).trim();
		const match = /^ref: refs\/heads\/(.+)$/.exec(head);
		return match?.[1] && isSafeBranchName(match[1]) ? match[1] : null;
	} catch (error) {
		// No HEAD file is "no branch"; a failed read is not (#93).
		if (isAbsentError(error)) return null;
		throw error;
	}
}

/**
 * Resolve a fully-qualified ref's oid with one read instead of isomorphic-
 * git's own `resolveRef`, which does a stat *then* a read for a loose ref
 * (two round trips against object storage) — wasteful specifically here,
 * where the caller already knows the ref exists (it came from a directory
 * listing moments earlier). Reads the loose file directly and falls back to
 * `git.resolveRef` only when that doesn't pan out (packed-refs, or anything
 * else the plain-loose-file assumption doesn't cover), so correctness for
 * those cases is unchanged — this only removes the redundant round trip on
 * the common path.
 */
export async function resolveLooseRefFast(
	repo: Repo,
	ref: string,
): Promise<string> {
	const promisesFs = getPromisesFs(repo.fs);
	if (promisesFs) {
		try {
			const content = await promisesFs.readFile(
				`${repo.gitdir}/${ref}`,
				"utf8",
			);
			const oid = decodeFileContent(content).trim();
			if (FULL_SHA_RE.test(oid)) return oid;
		} catch {
			// Not a loose file (packed-refs, or genuinely absent) — fall through.
		}
	}
	return git.resolveRef({ ...repo, ref });
}

/** All branches with their tip commits; [] for an empty repository. */
export async function listBranches(repo: Repo): Promise<Branch[]> {
	try {
		const [looseBranches, looseCurrentBranch, packedBranches] =
			await Promise.all([
				listLooseBranches(repo),
				getCurrentLooseBranch(repo),
				readPackedBranches(repo),
			]);
		const branches =
			looseBranches === null
				? await git.listBranches(repo)
				: [...new Set([...looseBranches, ...packedBranches.keys()])].sort();
		const currentBranch =
			looseBranches === null
				? await git
						.currentBranch({ ...repo, fullname: false })
						.catch((error: unknown) => {
							if (isAbsentError(error)) return null;
							throw error;
						})
				: looseCurrentBranch;

		return Promise.all(
			branches.map(async (branch) => {
				const packedCommit = packedBranches.get(branch);
				return {
					name: branch,
					commit:
						packedCommit && !looseBranches?.includes(branch)
							? packedCommit
							: await resolveLooseRefFast(repo, `refs/heads/${branch}`),
					isDefault: branch === currentBranch,
				};
			}),
		);
	} catch (err: unknown) {
		if ((err as { code?: string }).code === "NotFoundError") return [];
		throw err;
	}
}

/** Create `name` pointing at the tip of `startPoint` (no checkout). */
export async function createBranchFrom(
	repo: Repo,
	name: string,
	startPoint: string,
): Promise<void> {
	assertSafeBranchName(name);
	assertSafeBranchName(startPoint);
	const object = await resolveLooseRefFast(repo, `refs/heads/${startPoint}`);
	const collision = await findRefCollision(repo, `refs/heads/${name}`);
	if (collision) {
		throw new GitConflictError(
			`Branch ${name} can't be created: ${collision} exists`,
		);
	}
	try {
		await git.branch({ ...repo, ref: name, checkout: false, object });
	} catch (err) {
		if ((err as { code?: string }).code === "AlreadyExistsError") {
			throw new GitConflictError(`Branch ${name} already exists`);
		}
		throw err;
	}
}

/** Delete a branch ref (validated — deleteBranch has no internal ref check). */
export async function deleteBranchByName(
	repo: Repo,
	name: string,
): Promise<void> {
	assertSafeBranchName(name);
	// Same rule as receive-pack: deleting the branch HEAD names leaves every
	// clone without a default branch.
	const current =
		(await getCurrentLooseBranch(repo)) ??
		(await git
			.currentBranch({ ...repo, fullname: false })
			.catch((error: unknown) => {
				// A failed HEAD read must not skip this guard: isomorphic-git's
				// deleteBranch would then detach HEAD instead of refusing (#93).
				if (isAbsentError(error)) return null;
				throw error;
			}));
	if (current === name) {
		throw new GitInvalidRequestError(
			`Cannot delete ${name}: it is the default branch`,
		);
	}
	await git.deleteBranch({ ...repo, ref: name });
}

/** Throws (NotFoundError) unless the branch resolves. */
export async function assertBranchExists(
	repo: Repo,
	name: string,
): Promise<void> {
	assertSafeBranchName(name);
	await resolveLooseRefFast(repo, `refs/heads/${name}`);
}

/** All tags with the commits they name, sorted by name; [] when there are none. */
export async function listTags(repo: Repo): Promise<Tag[]> {
	const names = (await listLooseRefNames(repo, "refs/tags")) ?? [];
	const all = new Set([
		...names,
		...(await git.listTags(repo).catch((error: unknown) => {
			if (isAbsentError(error)) return [] as string[];
			throw error;
		})),
	]);
	const tags = await Promise.all(
		[...all].filter(isSafeBranchName).map(async (name): Promise<Tag | null> => {
			try {
				const oid = await resolveLooseRefFast(repo, `refs/tags/${name}`);
				const commit = await peelToCommit(repo, oid);
				return commit === oid
					? { name, commit }
					: { name, commit, tagObject: oid };
			} catch (error) {
				// A tag deleted since the listing, or naming a missing object, is
				// not listed; a failed read fails the listing instead of
				// silently shortening it (#93).
				if (isAbsentError(error)) return null;
				throw error;
			}
		}),
	);
	return tags
		.filter((tag): tag is Tag => tag !== null)
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/**
 * An existing ref that `ref` (fully qualified) can't coexist with: one that
 * is a directory prefix of it (`refs/heads/a` for `refs/heads/a/b`) or lives
 * under it. Git stores refs as files, so it refuses such pairs; object
 * storage would accept both, so creations check here. Null when none.
 */
export async function findRefCollision(
	repo: Repo,
	ref: string,
): Promise<string | null> {
	return refCollisionIn(await listAllRefNames(repo), ref);
}

/** Every ref's full name (`refs/heads/main`, …). */
export async function listAllRefNames(repo: Repo): Promise<string[]> {
	return (await git.listRefs({ ...repo, filepath: "refs" })).map(
		(name) => `refs/${name}`,
	);
}

/** Of `names`, one that `ref` collides with as file and directory, else null. */
export function refCollisionIn(
	names: readonly string[],
	ref: string,
): string | null {
	return (
		names.find(
			(name) => ref.startsWith(`${name}/`) || name.startsWith(`${ref}/`),
		) ?? null
	);
}
