import {
	GitInvalidRequestError,
	isFullSha,
	isNotFoundError,
	isSafeRefName,
} from "git-fs-s3";
import type { CommitInfo } from "git-fs-s3/ops";
import {
	createBlobObject,
	createCommitObject,
	createRef,
	createTagObject,
	createTreeObject,
	type GitIdentityInput,
	updateRef,
} from "../git-objects";
import {
	getAllRefs,
	getBlobByOid,
	getBlobSize,
	getBlobSizes,
	getCommit,
	getTagObject,
	getTreeByOid,
	type RefTarget,
} from "../git-read";
import { safeCommitRevSchema } from "../git-ref-name";
import { ownerKeyOf } from "../git-storage-naming";
import { deleteTag } from "../git-write";
import { deleteHeadBranch } from "../pull-request-store";
import { draftReleasesForDeletedTag } from "../release-store";
import type { RepositoryRowWithOwner } from "../repository-lookup";
import { type ApiContext, callerIdentity } from "./auth";
import { apiCaps } from "./caps";
import {
	ApiError,
	apiUrl,
	encodePath,
	htmlUrl,
	json,
	noContent,
	notFoundError,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import { readableRepository, writableRepository } from "./repo-lookup";
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
	const { repo, caller } = await writableRepository(ctx);
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
		else if (tag) {
			await deleteTag(ownerKeyOf(repo), repo.name, tag);
			await draftReleasesForDeletedTag(repo.id, tag);
		} else throw new ApiError(422, "Reference does not exist");
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
	// A full sha may name a tree directly; anything else names a commit.
	const oid = isFullSha(rev)
		? rev
		: (await getCommit(ownerKey, repo.name, rev)).commit.tree;
	// GitHub treats any `recursive` value as true.
	const recursive =
		queryParams(ctx, "git/get-tree", "Tree").recursive !== undefined;
	return json(await treeObject(repo, oid, recursive));
}

/** A tree in GitHub's shape: entries with blob sizes, `truncated` past the cap. */
async function treeObject(
	repo: RepositoryRowWithOwner,
	oid: string,
	recursive: boolean,
) {
	const ownerKey = ownerKeyOf(repo);
	const fullName = fullNameOf(repo);
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
	return {
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
	};
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

/** Run a Git database write, mapping its refusals to GitHub's 422. */
async function gitWrite<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	} catch (error) {
		if (error instanceof GitInvalidRequestError) {
			throw new ApiError(422, error.message);
		}
		throw error;
	}
}

function identityOf(
	input: { name: string; email: string; date?: string } | undefined,
	fallback: { name: string; email: string },
): GitIdentityInput {
	return input
		? {
				name: input.name,
				email: input.email,
				date: input.date ? new Date(input.date) : undefined,
			}
		: { name: fallback.name, email: fallback.email };
}

/** `POST /repos/{owner}/{repo}/git/blobs`: `utf-8` or `base64` content. */
export async function createGitBlob(ctx: ApiContext) {
	const { repo } = await writableRepository(ctx);
	const body = await requestBody(ctx, "git/create-blob", "Blob");
	const bytes =
		body.encoding === "base64"
			? Buffer.from(body.content.replace(/\s/g, ""), "base64")
			: new TextEncoder().encode(body.content);
	const sha = await gitWrite(() =>
		createBlobObject(ownerKeyOf(repo), repo.name, bytes),
	);
	return json(
		{ sha, url: apiUrl(`/repos/${fullNameOf(repo)}/git/blobs/${sha}`) },
		201,
	);
}

/** `POST /repos/{owner}/{repo}/git/trees`: `tree` entries over `base_tree`. */
export async function createGitTree(ctx: ApiContext) {
	const { repo } = await writableRepository(ctx);
	const body = await requestBody(ctx, "git/create-tree", "Tree");
	const sha = await gitWrite(() =>
		createTreeObject(ownerKeyOf(repo), repo.name, {
			baseTree: body.base_tree,
			entries: body.tree,
		}),
	);
	return json(await treeObject(repo, sha, false), 201);
}

/** `POST /repos/{owner}/{repo}/git/commits`: author/committer default to the caller. */
export async function createGitCommit(ctx: ApiContext) {
	const { repo, caller } = await writableRepository(ctx);
	const body = await requestBody(ctx, "git/create-commit", "Commit");
	const me = await callerIdentity(caller);
	const author = identityOf(body.author ?? body.committer, me);
	const sha = await gitWrite(() =>
		createCommitObject(ownerKeyOf(repo), repo.name, {
			message: body.message,
			tree: body.tree,
			parents: body.parents,
			author,
			committer: identityOf(body.committer, author),
		}),
	);
	const info = await getCommit(ownerKeyOf(repo), repo.name, sha);
	return json(gitCommitObject(fullNameOf(repo), info), 201);
}

/** `GET /repos/{owner}/{repo}/git/tags/{tag_sha}`: an annotated tag object. */
export async function getGitTag(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { tag_sha: sha } = pathParams(ctx, "git/get-tag");
	if (!isFullSha(sha)) throw notFoundError();
	const tag = await getTagObject(ownerKeyOf(repo), repo.name, sha);
	if (!tag) throw notFoundError();
	return json(gitTagObject(fullNameOf(repo), sha, tag));
}

/** `POST /repos/{owner}/{repo}/git/tags`: the object only; create `refs/tags/…` separately. */
export async function createGitTag(ctx: ApiContext) {
	const { repo, caller } = await writableRepository(ctx);
	const body = await requestBody(ctx, "git/create-tag", "Tag");
	const tagger = identityOf(body.tagger, await callerIdentity(caller));
	const sha = await gitWrite(() =>
		createTagObject(ownerKeyOf(repo), repo.name, {
			tag: body.tag,
			message: body.message,
			object: body.object,
			type: body.type,
			tagger,
		}),
	);
	const tag = await getTagObject(ownerKeyOf(repo), repo.name, sha);
	if (!tag) throw new Error(`Tag ${sha} missing after write`);
	return json(gitTagObject(fullNameOf(repo), sha, tag), 201);
}

function gitTagObject(
	fullName: string,
	sha: string,
	tag: Awaited<ReturnType<typeof getTagObject>> & object,
) {
	const kind = { commit: "commits", tree: "trees", blob: "blobs", tag: "tags" }[
		tag.type
	];
	return {
		sha,
		url: apiUrl(`/repos/${fullName}/git/tags/${sha}`),
		tag: tag.tag,
		message: commitMessage(tag.message),
		tagger: gitIdentity(tag.tagger),
		object: {
			sha: tag.object,
			type: tag.type,
			url: apiUrl(`/repos/${fullName}/git/${kind}/${tag.object}`),
		},
		verification: {
			verified: false,
			reason: "unsigned",
			signature: null,
			payload: null,
			verified_at: null,
		},
	};
}

/** The ref just written, in GitHub's shape. */
async function refResponse(
	repo: RepositoryRowWithOwner,
	ref: string,
	status: 200 | 201,
) {
	const refs = await getAllRefs(ownerKeyOf(repo), repo.name);
	const target = refs.find((candidate) => candidate.ref === ref);
	if (!target) throw new Error(`Ref ${ref} missing after write`);
	return json(refObject(fullNameOf(repo), target), status);
}

/** `POST /repos/{owner}/{repo}/git/refs`: `ref` is fully qualified (`refs/heads/…`). */
export async function createGitRef(ctx: ApiContext) {
	const { repo } = await writableRepository(ctx);
	const body = await requestBody(ctx, "git/create-ref", "Reference");
	await gitWrite(() =>
		createRef(ownerKeyOf(repo), repo.name, body.ref, body.sha),
	);
	return refResponse(repo, body.ref, 201);
}

/** `PATCH /repos/{owner}/{repo}/git/refs/{ref}`: fast-forward, or any move with `force`. */
export async function updateGitRef(ctx: ApiContext) {
	const { repo } = await writableRepository(ctx);
	const name = qualified(pathParams(ctx, "git/update-ref").ref);
	const body = await requestBody(ctx, "git/update-ref", "Reference");
	if (!name) throw new ApiError(422, "Reference does not exist");
	await gitWrite(() =>
		updateRef(ownerKeyOf(repo), repo.name, name, body.sha, body.force),
	);
	return refResponse(repo, name, 200);
}
