import { isFullSha, isNotFoundError, isSafeRefName } from "git-fs-s3";
import type { CommitInfo } from "git-fs-s3/ops";
import {
	getAllRefs,
	getBlobByOid,
	getBlobSize,
	getBlobSizes,
	getCommit,
	getTreeByOid,
	type RefTarget,
} from "../git-read";
import { safeCommitRevSchema } from "../git-ref-name";
import { ownerKeyOf } from "../git-storage-naming";
import { deleteTag } from "../git-write";
import { deleteHeadBranch } from "../pull-request-store";
import { type ApiContext, requireScope } from "./auth";
import { apiCaps } from "./caps";
import {
	ApiError,
	apiUrl,
	encodePath,
	forbiddenError,
	htmlUrl,
	json,
	noContent,
	notFoundError,
} from "./http";
import { pathParams, queryParams } from "./input";
import { readableRepository } from "./repo-lookup";
import { commitMessage, gitIdentity } from "./serializers";
import { fullNameOf } from "./threads";

function refObject(fullName: string, target: RefTarget) {
	const objectKind = target.type === "tag" ? "tags" : "commits";
	return {
		ref: target.ref,
		url: apiUrl(`/repos/${fullName}/git/${encodePath(target.ref)}`),
		object: {
			sha: target.sha,
			type: target.type,
			url: apiUrl(`/repos/${fullName}/git/${objectKind}/${target.sha}`),
		},
	};
}

/** `refs/`-qualified form of a route's `ref` (GitHub takes `heads/main`). */
function qualified(ref: string): string | null {
	const full = `refs/${ref.replace(/^refs\//, "")}`;
	return isSafeRefName(full.slice("refs/".length)) ? full : null;
}

async function refsOf(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const refs = await getAllRefs(ownerKeyOf(repo), repo.name);
	return { fullName: fullNameOf(repo), refs };
}

/** `GET /repos/{owner}/{repo}/git/ref/{ref}`: exactly one ref, else 404. */
export async function getRef(ctx: ApiContext) {
	const name = qualified(pathParams(ctx, "git/get-ref").ref);
	if (!name) throw notFoundError();
	const { fullName, refs } = await refsOf(ctx);
	const target = refs.find((candidate) => candidate.ref === name);
	if (!target) throw notFoundError();
	return json(refObject(fullName, target));
}

/** `GET /repos/{owner}/{repo}/git/matching-refs/{ref}`: refs starting with `ref` (`[]` when none). */
export async function listMatchingRefs(ctx: ApiContext) {
	const { ref: raw } = pathParams(ctx, "git/list-matching-refs");
	const prefix = raw === "" ? "refs/" : qualified(raw);
	const { fullName, refs } = await refsOf(ctx);
	if (!prefix) return json([]);
	return json(
		refs
			.filter((target) => target.ref.startsWith(prefix))
			.map((target) => refObject(fullName, target)),
	);
}

/**
 * The legacy `GET /repos/{owner}/{repo}/git/refs[/{ref}]`: an exact match is
 * one object, a prefix match an array, nothing a 404.
 */
export async function listRefs(ctx: ApiContext) {
	const { ref: raw } = pathParams(ctx, "git/list-refs");
	const { fullName, refs } = await refsOf(ctx);
	if (raw === undefined) {
		return json(refs.map((target) => refObject(fullName, target)));
	}
	const name = qualified(raw);
	if (!name) throw notFoundError();
	const exact = refs.find((target) => target.ref === name);
	if (exact) return json(refObject(fullName, exact));
	const matching = refs.filter((target) => target.ref.startsWith(`${name}/`));
	if (matching.length === 0) throw notFoundError();
	return json(matching.map((target) => refObject(fullName, target)));
}

/**
 * `DELETE /repos/{owner}/{repo}/git/refs/{ref}`: a branch (`heads/…`) or a
 * tag (`tags/…`). A missing ref is GitHub's 422 "Reference does not exist";
 * so is the default branch, which clones need.
 */
export async function deleteRef(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	if (!access.canWrite) {
		throw forbiddenError("Resource not accessible by personal access token");
	}
	const name = qualified(pathParams(ctx, "git/delete-ref").ref);
	const branch = name?.startsWith("refs/heads/")
		? name.slice("refs/heads/".length)
		: null;
	const tag = name?.startsWith("refs/tags/")
		? name.slice("refs/tags/".length)
		: null;
	if (branch === repo.defaultBranch) {
		throw new ApiError(422, "Cannot delete the default branch");
	}
	try {
		if (branch) await deleteHeadBranch(repo, branch, caller.userId);
		else if (tag) await deleteTag(ownerKeyOf(repo), repo.name, tag);
		else throw new ApiError(422, "Reference does not exist");
	} catch (error) {
		if (isNotFoundError(error)) {
			throw new ApiError(422, "Reference does not exist");
		}
		throw error;
	}
	return noContent();
}

export function gitCommitObject(fullName: string, info: CommitInfo) {
	const { commit, oid } = info;
	return {
		sha: oid,
		url: apiUrl(`/repos/${fullName}/git/commits/${oid}`),
		html_url: htmlUrl(`/${fullName}/commit/${oid}`),
		author: gitIdentity(commit.author),
		committer: gitIdentity(commit.committer),
		tree: {
			sha: commit.tree,
			url: apiUrl(`/repos/${fullName}/git/trees/${commit.tree}`),
		},
		message: commitMessage(commit.message),
		parents: commit.parent.map((sha) => ({
			sha,
			url: apiUrl(`/repos/${fullName}/git/commits/${sha}`),
			html_url: htmlUrl(`/${fullName}/commit/${sha}`),
		})),
		verification: {
			verified: false,
			reason: "unsigned",
			signature: null,
			payload: null,
			verified_at: null,
		},
	};
}

/** `GET /repos/{owner}/{repo}/git/commits/{commit_sha}`: a full sha only. */
export async function getGitCommit(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { commit_sha: sha } = pathParams(ctx, "git/get-commit");
	if (!isFullSha(sha)) throw notFoundError();
	const info = await getCommit(ownerKeyOf(repo), repo.name, sha);
	return json(gitCommitObject(fullNameOf(repo), info));
}

/**
 * `GET /repos/{owner}/{repo}/git/trees/{tree_sha}`: a tree sha, or (as
 * GitHub allows) a commit sha or ref naming one; `recursive` flattens it.
 */
export async function getGitTree(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { tree_sha: rev } = pathParams(ctx, "git/get-tree");
	if (!safeCommitRevSchema.safeParse(rev).success) throw notFoundError();
	const ownerKey = ownerKeyOf(repo);
	const fullName = fullNameOf(repo);
	// A full sha may name a tree directly; anything else names a commit.
	const oid = isFullSha(rev)
		? rev
		: (await getCommit(ownerKey, repo.name, rev)).commit.tree;
	// GitHub treats any `recursive` value as true.
	const recursive =
		queryParams(ctx, "git/get-tree", "Tree").recursive !== undefined;
	const tree = await getTreeByOid(ownerKey, repo.name, oid, {
		recursive,
		limit: apiCaps.treeEntries,
	});
	const sizes = await getBlobSizes(
		ownerKey,
		repo.name,
		tree.entries
			.filter((entry) => entry.type === "blob")
			.map((entry) => entry.oid),
		apiCaps.sizeReadConcurrency,
	);
	return json({
		sha: tree.sha,
		url: apiUrl(`/repos/${fullName}/git/trees/${tree.sha}`),
		tree: tree.entries.map((entry) => ({
			path: entry.path,
			mode: entry.mode,
			type: entry.type,
			sha: entry.oid,
			...(entry.type === "blob" && {
				size: sizes.get(entry.oid) ?? 0,
				url: apiUrl(`/repos/${fullName}/git/blobs/${entry.oid}`),
			}),
			...(entry.type === "tree" && {
				url: apiUrl(`/repos/${fullName}/git/trees/${entry.oid}`),
			}),
		})),
		truncated: tree.truncated,
	});
}

export async function getGitBlob(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { file_sha: sha } = pathParams(ctx, "git/get-blob");
	if (!isFullSha(sha)) throw notFoundError();
	const ownerKey = ownerKeyOf(repo);
	const size = await getBlobSize(ownerKey, repo.name, sha);
	if (size > apiCaps.blobBytes) {
		throw new ApiError(
			403,
			`This API returns blobs up to ${apiCaps.blobBytes} bytes in size`,
		);
	}
	const bytes = await getBlobByOid(ownerKey, repo.name, sha).catch(
		(error: unknown) => {
			if ((error as { code?: string })?.code === "ObjectTypeError") {
				throw notFoundError();
			}
			throw error;
		},
	);
	return json({
		sha,
		size,
		url: apiUrl(`/repos/${fullNameOf(repo)}/git/blobs/${sha}`),
		content: Buffer.from(bytes)
			.toString("base64")
			.replace(/.{1,60}/g, "$&\n"),
		encoding: "base64",
	});
}
