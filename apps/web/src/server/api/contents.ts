import { GitInvalidRequestError, isNotFoundError } from "git-fs-s3";
import type { TreeEntry } from "git-fs-s3/ops";
import {
	getBlobByOid,
	getBlobSize,
	getBlobSizes,
	getCommit,
	getPathEntry,
	getSubmoduleUrls,
	getTreeByOid,
} from "../git-read";
import {
	safeBranchNameSchema,
	safeCommitRevSchema,
	safeRepoPathSchema,
} from "../git-ref-name";
import { ownerKeyOf } from "../git-storage-naming";
import { deleteFile, FileShaError, putFile } from "../git-write";
import { type ApiContext, callerIdentity, requireScope } from "./auth";
import { apiCaps } from "./caps";
import { gitCommitObject } from "./git-data";
import {
	ApiError,
	apiUrl,
	encodePath,
	forbiddenError,
	htmlUrl,
	json,
	notFoundError,
	validationFailedError,
} from "./http";
import {
	pathParams,
	queryParams,
	type RequestBody,
	requestBody,
} from "./input";
import { readableRepository } from "./repo-lookup";
import { fullNameOf } from "./threads";

/** Base64 wrapped at 60 characters per line, as GitHub encodes `content`. */
function wrappedBase64(bytes: Uint8Array): string {
	const encoded = Buffer.from(bytes).toString("base64");
	return encoded.replace(/.{1,60}/g, "$&\n");
}

const kindOf = (entry: TreeEntry) =>
	entry.type === "tree"
		? "dir"
		: entry.type === "commit"
			? "submodule"
			: entry.mode === "120000"
				? "symlink"
				: "file";

interface Location {
	fullName: string;
	ref: string;
}

function baseShape(
	entry: TreeEntry,
	size: number,
	{ fullName, ref }: Location,
) {
	const path = encodePath(entry.path);
	const query = `?ref=${encodeURIComponent(ref)}`;
	const kind = kindOf(entry);
	const url = apiUrl(`/repos/${fullName}/contents/${path}${query}`);
	const gitUrl =
		kind === "dir"
			? apiUrl(`/repos/${fullName}/git/trees/${entry.oid}`)
			: kind === "submodule"
				? null
				: apiUrl(`/repos/${fullName}/git/blobs/${entry.oid}`);
	const htmlPath =
		kind === "dir"
			? `/${fullName}/tree/${encodePath(ref)}/${path}`
			: `/${fullName}/blob/${encodePath(ref)}/${path}`;
	const html = kind === "submodule" ? null : htmlUrl(htmlPath);
	return {
		type: kind,
		size,
		name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
		path: entry.path,
		sha: entry.oid,
		url,
		git_url: gitUrl,
		html_url: html,
		download_url:
			kind === "file" || kind === "symlink"
				? htmlUrl(`/api/raw/${fullName}/${encodePath(ref)}/${path}`)
				: null,
		_links: { self: url, git: gitUrl, html },
	};
}

export async function getContents(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { path: rawPath } = pathParams(ctx, "repos/get-content");
	const path = rawPath.replace(/\/+$/, "");
	const ref =
		queryParams(ctx, "repos/get-content", "Content").ref || repo.defaultBranch;
	if (
		!safeRepoPathSchema.safeParse(path).success ||
		!safeCommitRevSchema.safeParse(ref).success
	) {
		throw notFoundError();
	}
	const ownerKey = ownerKeyOf(repo);
	const location = { fullName: fullNameOf(repo), ref };
	const { entry, commitOid } = await getPathEntry(
		ownerKey,
		repo.name,
		ref,
		path,
	);
	if (!entry) throw notFoundError();

	if (entry.type === "tree") {
		const { entries } = await getTreeByOid(ownerKey, repo.name, entry.oid, {
			limit: apiCaps.directoryEntries,
		});
		const listed = entries.map((child) => ({
			...child,
			path: path ? `${path}/${child.path}` : child.path,
		}));
		const sizes = await getBlobSizes(
			ownerKey,
			repo.name,
			listed.filter((child) => child.type === "blob").map((child) => child.oid),
			apiCaps.sizeReadConcurrency,
		);
		return json(
			listed.map((child) =>
				baseShape(child, sizes.get(child.oid) ?? 0, location),
			),
		);
	}

	if (entry.type === "commit") {
		const urls = await getSubmoduleUrls(ownerKey, repo.name, commitOid);
		return json({
			...baseShape(entry, 0, location),
			submodule_git_url: urls.get(path) ?? null,
		});
	}

	const size = await getBlobSize(ownerKey, repo.name, entry.oid);
	if (entry.mode === "120000") {
		const target =
			size <= apiCaps.symlinkTargetBytes
				? new TextDecoder().decode(
						await getBlobByOid(ownerKey, repo.name, entry.oid),
					)
				: null;
		return json({ ...baseShape(entry, size, location), target });
	}
	if (size > apiCaps.contentsInlineBytes) {
		return json({
			...baseShape(entry, size, location),
			content: "",
			encoding: "none",
		});
	}
	const bytes = await getBlobByOid(ownerKey, repo.name, entry.oid);
	return json({
		...baseShape(entry, size, location),
		content: wrappedBase64(bytes),
		encoding: "base64",
	});
}

type FileWriteOperation =
	| "repos/create-or-update-file-contents"
	| "repos/delete-file";
type FileWriteBody = RequestBody<FileWriteOperation>;

/** What every file write needs: a writable repo, a valid path and branch, an author. */
async function fileWriteTarget<Id extends FileWriteOperation>(
	ctx: ApiContext,
	id: Id,
) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	if (!access.canWrite) {
		throw forbiddenError("Resource not accessible by personal access token");
	}
	const { path } = pathParams(ctx, id as FileWriteOperation);
	if (!safeRepoPathSchema.safeParse(path).success) throw notFoundError();
	const body: FileWriteBody = await requestBody(
		ctx,
		id as FileWriteOperation,
		"Content",
	);
	const branch = body.branch ?? repo.defaultBranch;
	if (!safeBranchNameSchema.safeParse(branch).success) {
		throw new ApiError(404, "Branch not found");
	}
	// GitHub: the author defaults to the committer, the committer to the caller.
	const identity =
		body.author ?? body.committer ?? (await callerIdentity(caller));
	return {
		repo,
		path,
		branch,
		body: body as RequestBody<Id>,
		author: { name: identity.name, email: identity.email },
	};
}

/** The written file's content entry and commit, in GitHub's shape. */
async function fileCommitResponse(
	repo: { name: string } & Parameters<typeof ownerKeyOf>[0] &
		Parameters<typeof fullNameOf>[0],
	branch: string,
	path: string,
	commitSha: string,
	size: number | null,
) {
	const ownerKey = ownerKeyOf(repo);
	const fullName = fullNameOf(repo);
	const info = await getCommit(ownerKey, repo.name, commitSha);
	let content = null;
	if (size !== null) {
		const { entry } = await getPathEntry(ownerKey, repo.name, commitSha, path);
		if (!entry) throw new Error(`${path} missing from ${commitSha}`);
		content = {
			...baseShape(entry, size, { fullName, ref: branch }),
			type: "file" as const,
		};
	}
	return { content, commit: gitCommitObject(fullName, info) };
}

/** Map git-write's refusals to GitHub's statuses. */
function fileWriteError(error: unknown, path: string, sha?: string): never {
	if (error instanceof FileShaError) {
		if (error.reason === "missing") {
			throw validationFailedError(
				'Invalid request.\n\n"sha" wasn\'t supplied.',
				[],
			);
		}
		throw new ApiError(409, `${path} does not match ${sha}`);
	}
	if (error instanceof GitInvalidRequestError) {
		throw new ApiError(
			/does not exist/.test(error.message) ? 404 : 422,
			/does not exist/.test(error.message) ? "Branch not found" : error.message,
		);
	}
	throw error;
}

/**
 * `PUT /repos/{owner}/{repo}/contents/{path}`: create a file (201) or replace
 * it (200, `sha` naming the blob being replaced) with one commit.
 */
export async function putContents(ctx: ApiContext) {
	const target = await fileWriteTarget(
		ctx,
		"repos/create-or-update-file-contents",
	);
	const { repo, path, branch, body } = target;
	const bytes = Buffer.from(body.content, "base64");
	const result = await putFile(ownerKeyOf(repo), repo.name, {
		branch,
		path,
		content: bytes,
		message: body.message,
		author: target.author,
		expectedSha: body.sha,
	}).catch((error: unknown) => fileWriteError(error, path, body.sha));
	return json(
		await fileCommitResponse(
			repo,
			branch,
			path,
			result.commitSha,
			bytes.length,
		),
		result.created ? 201 : 200,
	);
}

/** `DELETE /repos/{owner}/{repo}/contents/{path}`: `sha` must name the file's blob. */
export async function deleteContents(ctx: ApiContext) {
	const target = await fileWriteTarget(ctx, "repos/delete-file");
	const { repo, path, branch, body } = target;
	const commitSha = await deleteFile(ownerKeyOf(repo), repo.name, {
		branch,
		filePath: path,
		message: body.message,
		author: target.author,
		expectedSha: body.sha,
	}).catch((error: unknown) => {
		if (isNotFoundError(error)) throw notFoundError();
		return fileWriteError(error, path, body.sha);
	});
	return json(await fileCommitResponse(repo, branch, path, commitSha, null));
}
