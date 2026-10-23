/**
 * GitHub's releases at `/api/v3`: a repository's releases (list, get, latest,
 * by tag, create, update, delete, generated notes) and their assets. Drafts
 * are visible to writers only. Uploads: `POST …/assets?name=` takes the raw
 * bytes (up to 4,000,000: a function body is capped at 4.5 MB); larger files
 * use the presigned flow (`…/assets/uploads`, then `…/assets/{id}/finish`).
 */
import { MAX_RELEASE_ASSET_DIRECT_BYTES } from "#/lib/limits";
import {
	AssetInputError,
	assetResponse,
	deleteAsset,
	finishAssetUpload,
	PresignUnavailableError,
	startAssetUpload,
	uploadAssetBytes,
} from "../release-assets";
import {
	createRelease,
	deleteRelease,
	generateReleaseNotes,
	ReleaseInputError,
	updateRelease,
} from "../release-service";
import {
	countAssets,
	countReleases,
	DuplicateAssetError,
	findAsset,
	findLatestRelease,
	findRelease,
	findReleaseByTag,
	listAssets,
	listReleases as listReleaseRows,
	type ReleaseInput,
	updateAssetRow,
} from "../release-store";
import type { RepositoryRowWithOwner } from "../repository-lookup";
import type { ApiContext } from "./auth";
import {
	ApiError,
	json,
	linkHeader,
	noContent,
	notFoundError,
	pageParams,
	validationFailedError,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import { readableRepository, writableRepository } from "./repo-lookup";
import { release, releaseAsset } from "./serializers";
import { fullNameOf } from "./threads";

type ReleaseRow = NonNullable<Awaited<ReturnType<typeof findRelease>>>;

const serialize = (repo: RepositoryRowWithOwner, row: ReleaseRow) =>
	release({ fullName: fullNameOf(repo) }, row);

function inputError(
	error: ReleaseInputError | AssetInputError,
	resource: string,
) {
	return validationFailedError("Validation Failed", [
		{
			resource,
			field: error.field,
			code: error.code === "too_large" ? "invalid" : error.code,
		},
	]);
}

/** Map a service's input errors to GitHub's 422 (or 413 for an oversize body). */
async function guarded<T>(resource: string, run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof ReleaseInputError) throw inputError(error, resource);
		if (error instanceof AssetInputError) {
			if (error.code === "too_large" && error.field === "size") {
				throw new ApiError(413, "Request body too large");
			}
			throw inputError(error, resource);
		}
		if (error instanceof DuplicateAssetError) {
			throw inputError(new AssetInputError("name", "already_exists"), resource);
		}
		throw error;
	}
}

/** A release the caller may see: drafts need write access (404 otherwise). */
function visible(row: ReleaseRow | undefined, canWrite: boolean) {
	if (!row || (row.draft && !canWrite)) throw notFoundError();
	return row;
}

export async function listRepoReleases(ctx: ApiContext) {
	const { repo, access } = await readableRepository(ctx);
	const params = pageParams(ctx.url.searchParams);
	const [rows, total] = await Promise.all([
		params.reachable
			? listReleaseRows(repo.id, {
					includeDrafts: access.canWrite,
					limit: params.perPage,
					offset: params.offset,
				})
			: [],
		countReleases(repo.id, access.canWrite),
	]);
	return json(
		rows.map((row) => serialize(repo, row)),
		200,
		linkHeader(ctx.url, params, total),
	);
}

export async function getLatestRelease(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const row = await findLatestRelease(repo.id);
	if (!row) throw notFoundError();
	return json(serialize(repo, row));
}

export async function getReleaseByTag(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { tag } = pathParams(ctx, "repos/get-release-by-tag");
	const row = await findReleaseByTag(repo.id, tag);
	if (!row) throw notFoundError();
	return json(serialize(repo, row));
}

export async function getRelease(ctx: ApiContext) {
	const { repo, access } = await readableRepository(ctx);
	const { release_id } = pathParams(ctx, "repos/get-release");
	return json(
		serialize(
			repo,
			visible(await findRelease(repo.id, release_id), access.canWrite),
		),
	);
}

type ReleaseBody = {
	target_commitish?: string;
	name?: string | null;
	body?: string | null;
	draft?: boolean;
	prerelease?: boolean;
	make_latest?: "true" | "false" | "legacy";
};

/** The fields a request set, as store columns. */
function fieldsOf(
	data: ReleaseBody & { tag_name?: string },
): Partial<ReleaseInput> {
	return {
		...(data.tag_name !== undefined && { tagName: data.tag_name }),
		...(data.target_commitish !== undefined && {
			targetCommitish: data.target_commitish,
		}),
		...(data.name !== undefined && { name: data.name }),
		...(data.body !== undefined && { body: data.body }),
		...(data.draft !== undefined && { draft: data.draft }),
		...(data.prerelease !== undefined && { prerelease: data.prerelease }),
		...(data.make_latest !== undefined && { makeLatest: data.make_latest }),
	};
}

export async function createReleaseHandler(ctx: ApiContext) {
	const { repo, caller } = await writableRepository(ctx);
	const data = await requestBody(ctx, "repos/create-release", "Release");
	const created = await guarded("Release", async () => {
		let name = data.name ?? null;
		let body = data.body ?? null;
		if (data.generate_release_notes) {
			const notes = await generateReleaseNotes(repo, {
				tagName: data.tag_name,
				targetCommitish: data.target_commitish,
			});
			name ??= notes.name;
			body = body ? `${body}\n\n${notes.body}` : notes.body;
		}
		return createRelease(repo, caller.userId, {
			tagName: data.tag_name,
			targetCommitish: data.target_commitish ?? repo.defaultBranch,
			name,
			body,
			draft: data.draft ?? false,
			prerelease: data.prerelease ?? false,
			makeLatest: data.make_latest ?? "legacy",
		});
	});
	const row = await findRelease(repo.id, created);
	if (!row) throw new Error("Release missing after insert");
	const shaped = serialize(repo, row);
	return json(shaped, 201, { Location: shaped.url });
}

export async function generateNotesHandler(ctx: ApiContext) {
	const { repo } = await writableRepository(ctx);
	const data = await requestBody(
		ctx,
		"repos/generate-release-notes",
		"Release",
	);
	return json(
		await guarded("Release", () =>
			generateReleaseNotes(repo, {
				tagName: data.tag_name,
				targetCommitish: data.target_commitish,
				previousTagName: data.previous_tag_name,
			}),
		),
	);
}

async function writableRelease(
	ctx: ApiContext,
	id: "repos/update-release" | "repos/delete-release",
) {
	const { repo } = await writableRepository(ctx);
	const { release_id } = pathParams(ctx, id);
	const row = await findRelease(repo.id, release_id);
	if (!row) throw notFoundError();
	return { repo, row };
}

export async function updateReleaseHandler(ctx: ApiContext) {
	const { repo, row } = await writableRelease(ctx, "repos/update-release");
	const data = await requestBody(ctx, "repos/update-release", "Release");
	await guarded("Release", () => updateRelease(repo, row, fieldsOf(data)));
	const updated = await findRelease(repo.id, row.id);
	if (!updated) throw notFoundError();
	return json(serialize(repo, updated));
}

export async function deleteReleaseHandler(ctx: ApiContext) {
	const { repo, row } = await writableRelease(ctx, "repos/delete-release");
	if (!(await deleteRelease(repo, row.id))) throw notFoundError();
	return noContent();
}

// Assets ----------------------------------------------------------------

export async function listReleaseAssetsHandler(ctx: ApiContext) {
	const { repo, access } = await readableRepository(ctx);
	const { release_id } = pathParams(ctx, "repos/list-release-assets");
	const row = visible(await findRelease(repo.id, release_id), access.canWrite);
	const params = pageParams(ctx.url.searchParams);
	const [assets, total] = await Promise.all([
		params.reachable
			? listAssets(row.id, { limit: params.perPage, offset: params.offset })
			: [],
		countAssets(row.id),
	]);
	const fullName = fullNameOf(repo);
	return json(
		assets.map((asset) => releaseAsset({ fullName }, row.tagName, asset)),
		200,
		linkHeader(ctx.url, params, total),
	);
}

/** An asset the caller may see (those of a draft need write access). */
async function assetFor(
	ctx: ApiContext,
	id:
		| "repos/get-release-asset"
		| "repos/update-release-asset"
		| "repos/delete-release-asset"
		| "repos/finish-release-asset-upload",
	repoId: number,
	canWrite: boolean,
) {
	const { asset_id } = pathParams(ctx, id);
	const asset = await findAsset(repoId, asset_id);
	if (!asset || (asset.release.draft && !canWrite)) throw notFoundError();
	return asset;
}

export async function getReleaseAssetHandler(ctx: ApiContext) {
	const { repo, access } = await readableRepository(ctx);
	const asset = await assetFor(
		ctx,
		"repos/get-release-asset",
		repo.id,
		access.canWrite,
	);
	if (asset.state !== "uploaded" && !access.canWrite) throw notFoundError();
	if (
		(ctx.request.headers.get("accept") ?? "").includes(
			"application/octet-stream",
		) &&
		asset.state === "uploaded"
	) {
		return assetResponse(repo, asset, ctx.request, {
			isPublic: repo.visibility === "public",
		});
	}
	return json(
		releaseAsset({ fullName: fullNameOf(repo) }, asset.release.tagName, asset),
	);
}

export async function updateReleaseAssetHandler(ctx: ApiContext) {
	const { repo } = await writableRepository(ctx);
	const asset = await assetFor(
		ctx,
		"repos/update-release-asset",
		repo.id,
		true,
	);
	const data = await requestBody(
		ctx,
		"repos/update-release-asset",
		"ReleaseAsset",
	);
	await guarded("ReleaseAsset", async () => {
		const { isValidAssetName } = await import("../release-assets");
		if (data.name !== undefined && !isValidAssetName(data.name)) {
			throw new AssetInputError("name", "invalid");
		}
		await updateAssetRow(asset.id, {
			...(data.name !== undefined && { name: data.name }),
			...(data.label !== undefined && { label: data.label }),
		});
	});
	const updated = await findAsset(repo.id, asset.id);
	if (!updated) throw notFoundError();
	return json(
		releaseAsset(
			{ fullName: fullNameOf(repo) },
			asset.release.tagName,
			updated,
		),
	);
}

export async function deleteReleaseAssetHandler(ctx: ApiContext) {
	const { repo } = await writableRepository(ctx);
	const asset = await assetFor(
		ctx,
		"repos/delete-release-asset",
		repo.id,
		true,
	);
	await deleteAsset(repo, asset.id);
	return noContent();
}

/** The request body's bytes, 413 once they pass `max`. */
async function readBytes(request: Request, max: number): Promise<Uint8Array> {
	const tooLarge = () => new ApiError(413, "Request body too large");
	const declared = request.headers.get("content-length");
	if (declared !== null && Number(declared) > max) throw tooLarge();
	const chunks: Uint8Array[] = [];
	let total = 0;
	if (request.body) {
		const reader = request.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > max) {
				await reader.cancel();
				throw tooLarge();
			}
			chunks.push(value);
		}
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

const contentTypeOf = (request: Request) =>
	(request.headers.get("content-type") ?? "").trim().slice(0, 255) ||
	"application/octet-stream";

export async function uploadReleaseAssetHandler(ctx: ApiContext) {
	const { repo, caller } = await writableRepository(ctx);
	const { release_id } = pathParams(ctx, "repos/upload-release-asset");
	const row = await findRelease(repo.id, release_id);
	if (!row) throw notFoundError();
	const query = queryParams(ctx, "repos/upload-release-asset", "ReleaseAsset");
	const bytes = await readBytes(ctx.request, MAX_RELEASE_ASSET_DIRECT_BYTES);
	const id = await guarded("ReleaseAsset", () =>
		uploadAssetBytes(repo, {
			releaseId: row.id,
			uploaderId: caller.userId,
			name: query.name,
			label: query.label ?? null,
			contentType: contentTypeOf(ctx.request),
			bytes,
		}),
	);
	const asset = await findAsset(repo.id, id);
	if (!asset) throw new Error("Asset missing after upload");
	return json(
		releaseAsset({ fullName: fullNameOf(repo) }, row.tagName, asset),
		201,
	);
}

export async function createReleaseAssetUploadHandler(ctx: ApiContext) {
	const { repo, caller } = await writableRepository(ctx);
	const { release_id } = pathParams(ctx, "repos/create-release-asset-upload");
	const row = await findRelease(repo.id, release_id);
	if (!row) throw notFoundError();
	const data = await requestBody(
		ctx,
		"repos/create-release-asset-upload",
		"ReleaseAsset",
	);
	let started: Awaited<ReturnType<typeof startAssetUpload>>;
	try {
		started = await guarded("ReleaseAsset", () =>
			startAssetUpload(repo, {
				releaseId: row.id,
				uploaderId: caller.userId,
				name: data.name,
				label: data.label ?? null,
				contentType: data.content_type,
				size: data.size,
			}),
		);
	} catch (error) {
		if (error instanceof PresignUnavailableError) {
			throw new ApiError(501, error.message);
		}
		throw error;
	}
	const asset = await findAsset(repo.id, started.id);
	if (!asset) throw new Error("Asset missing after insert");
	return json(
		{
			...releaseAsset({ fullName: fullNameOf(repo) }, row.tagName, asset),
			upload_url: started.uploadUrl,
		},
		201,
	);
}

export async function finishReleaseAssetUploadHandler(ctx: ApiContext) {
	const { repo } = await writableRepository(ctx);
	const asset = await assetFor(
		ctx,
		"repos/finish-release-asset-upload",
		repo.id,
		true,
	);
	await guarded("ReleaseAsset", () => finishAssetUpload(repo, asset));
	const updated = await findAsset(repo.id, asset.id);
	if (!updated) throw notFoundError();
	return json(
		releaseAsset(
			{ fullName: fullNameOf(repo) },
			asset.release.tagName,
			updated,
		),
	);
}
