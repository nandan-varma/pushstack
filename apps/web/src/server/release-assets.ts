/**
 * Release asset bytes: uploads (direct for small files, presigned PUT to R2
 * for large ones, verified afterwards), deletion, and the streamed download
 * at `/{owner}/{repo}/releases/download/{tag}/{name}`. Bytes live at
 * `getReleaseAssetKey` and never pass through a buffered response: reads are
 * chunked ranges, because Vercel caps a buffered response at 4.5 MB.
 */
import {
	MAX_RELEASE_ASSET_BYTES,
	MAX_RELEASE_ASSET_DIRECT_BYTES,
	MAX_RELEASE_ASSETS,
	RELEASE_UPLOAD_URL_TTL_SECONDS,
} from "#/lib/limits";
import { downloadNotFound, resolveDownloader } from "./download-auth";
import { releaseAssetStorage } from "./git-fs";
import { getReleaseAssetKey, ownerKeyOf } from "./git-storage-naming";
import { logError } from "./perf-log";
import {
	countAssets,
	createAssetRow,
	DuplicateAssetError,
	deleteAssetRow,
	findDraftReleaseByTag,
	findReleaseByTag,
	incrementDownloadCount,
	markAssetUploaded,
	type ReleaseAssetRow,
} from "./release-store";
import { getAccessForRepository } from "./repo-access";
import { findRepositoryByName } from "./repository-lookup";

/** A problem with an upload, in GitHub's 422 vocabulary. */
export class AssetInputError extends Error {
	constructor(
		readonly field: string,
		readonly code: "invalid" | "already_exists" | "too_large" | "missing_field",
		message?: string,
	) {
		super(message ?? `Asset ${field} is ${code}`);
	}
}

/** The deployment has no R2 to presign against. */
export class PresignUnavailableError extends Error {
	constructor() {
		super("Large asset uploads need R2 storage, which is not configured");
	}
}

type RepoKey = { name: string; owner: { username: string } };

const keyOf = (repo: RepoKey, assetId: number) =>
	getReleaseAssetKey(ownerKeyOf(repo), repo.name, assetId);

/** Names are file names: one path segment, no control characters. */
export function isValidAssetName(name: string): boolean {
	if (name === "." || name === ".." || /[/\\]/.test(name)) return false;
	for (const char of name) {
		const code = char.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) return false;
	}
	return true;
}

function validated(input: { name: string; label?: string | null }) {
	if (!isValidAssetName(input.name)) {
		throw new AssetInputError("name", "invalid");
	}
}

async function createRow(
	repo: RepoKey,
	input: Parameters<typeof createAssetRow>[0],
): Promise<number> {
	validated(input);
	if ((await countAssets(input.releaseId)) >= MAX_RELEASE_ASSETS) {
		throw new AssetInputError("release", "too_large", "Too many assets");
	}
	try {
		const { id, replacedPending } = await createAssetRow(input);
		if (replacedPending !== null) {
			await releaseAssetStorage.delete(keyOf(repo, replacedPending));
		}
		return id;
	} catch (error) {
		if (error instanceof DuplicateAssetError) {
			throw new AssetInputError("name", "already_exists");
		}
		throw error;
	}
}

/** Store the bytes of a small asset (≤ `MAX_RELEASE_ASSET_DIRECT_BYTES`). */
export async function uploadAssetBytes(
	repo: RepoKey,
	input: {
		releaseId: number;
		uploaderId: string;
		name: string;
		label: string | null;
		contentType: string;
		bytes: Uint8Array;
	},
): Promise<number> {
	if (input.bytes.byteLength === 0) {
		throw new AssetInputError("size", "invalid", "Empty files are not allowed");
	}
	if (input.bytes.byteLength > MAX_RELEASE_ASSET_DIRECT_BYTES) {
		throw new AssetInputError("size", "too_large");
	}
	const id = await createRow(repo, {
		releaseId: input.releaseId,
		uploaderId: input.uploaderId,
		name: input.name,
		label: input.label,
		contentType: input.contentType,
		size: input.bytes.byteLength,
		state: "open",
	});
	try {
		await releaseAssetStorage.put(keyOf(repo, id), input.bytes);
		await markAssetUploaded(id, input.bytes.byteLength);
	} catch (error) {
		await deleteAssetRow(id).catch(() => {});
		throw error;
	}
	return id;
}

/** Start a presigned upload: an `open` row and the URL to PUT the bytes to. */
export async function startAssetUpload(
	repo: RepoKey,
	input: {
		releaseId: number;
		uploaderId: string;
		name: string;
		label: string | null;
		contentType: string;
		size: number;
	},
): Promise<{ id: number; uploadUrl: string }> {
	if (input.size <= 0 || input.size > MAX_RELEASE_ASSET_BYTES) {
		throw new AssetInputError("size", "too_large");
	}
	const id = await createRow(repo, { ...input, state: "open" });
	const uploadUrl = await releaseAssetStorage
		.presignPut(keyOf(repo, id), RELEASE_UPLOAD_URL_TTL_SECONDS)
		.catch(async (error: unknown) => {
			await deleteAssetRow(id).catch(() => {});
			throw error;
		});
	if (!uploadUrl) {
		await deleteAssetRow(id);
		throw new PresignUnavailableError();
	}
	return { id, uploadUrl };
}

/**
 * Complete a presigned upload: the object must exist with exactly the
 * declared size (the URL cannot bind it), else the asset is discarded.
 */
export async function finishAssetUpload(
	repo: RepoKey,
	asset: ReleaseAssetRow,
): Promise<void> {
	if (asset.state === "uploaded") return;
	const key = keyOf(repo, asset.id);
	const stat = await releaseAssetStorage.head(key);
	if (!stat) {
		throw new AssetInputError("size", "missing_field", "Nothing was uploaded");
	}
	if (stat.size !== asset.size || stat.size > MAX_RELEASE_ASSET_BYTES) {
		await releaseAssetStorage.delete(key);
		await deleteAssetRow(asset.id);
		throw new AssetInputError(
			"size",
			"invalid",
			"The uploaded size differs from the declared size",
		);
	}
	await markAssetUploaded(asset.id, stat.size);
}

export async function deleteAsset(repo: RepoKey, assetId: number) {
	await releaseAssetStorage.delete(keyOf(repo, assetId));
	await deleteAssetRow(assetId);
}

/** Remove the objects of deleted assets (their rows are already gone). */
export async function deleteReleaseAssetObjects(
	repo: RepoKey,
	assetIds: number[],
): Promise<void> {
	for (const id of assetIds) {
		await releaseAssetStorage
			.delete(keyOf(repo, id))
			.catch((error: unknown) => {
				logError("release", `deleting asset ${id} failed`, error);
			});
	}
}

const CHUNK_BYTES = 2 * 1024 * 1024;

function byteStream(
	key: string,
	start: number,
	end: number,
): ReadableStream<Uint8Array> {
	let next = start;
	return new ReadableStream({
		async pull(controller) {
			if (next > end) return controller.close();
			const last = Math.min(next + CHUNK_BYTES - 1, end);
			const chunk = await releaseAssetStorage.getRange(key, next, last);
			if (!chunk) {
				return controller.error(new Error("Asset object is missing"));
			}
			controller.enqueue(chunk);
			next = last + 1;
		},
	});
}

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` against `size`; null when not satisfiable/unparseable. */
export function parseRange(
	header: string,
	size: number,
): { start: number; end: number } | "unsatisfiable" | null {
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match || (match[1] === "" && match[2] === "")) return null;
	let start: number;
	let end: number;
	if (match[1] === "") {
		const suffix = Number(match[2]);
		if (suffix === 0) return "unsatisfiable";
		start = Math.max(size - suffix, 0);
		end = size - 1;
	} else {
		start = Number(match[1]);
		end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
	}
	if (start >= size || start > end) return "unsatisfiable";
	return { start, end };
}

/** The stream response for an uploaded asset (REST `Accept: application/octet-stream` and the web download). */
export function assetResponse(
	repo: RepoKey,
	asset: ReleaseAssetRow,
	request: Request,
	options: { isPublic: boolean },
): Response {
	const headers: Record<string, string> = {
		"Content-Type": "application/octet-stream",
		"Content-Disposition": `attachment; filename="${asset.name.replace(/[^A-Za-z0-9._-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
		"X-Content-Type-Options": "nosniff",
		"Accept-Ranges": "bytes",
		"Cache-Control": options.isPublic
			? "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
			: "private, max-age=60",
	};
	const rangeHeader = request.headers.get("range");
	const range = rangeHeader ? parseRange(rangeHeader, asset.size) : null;
	if (range === "unsatisfiable") {
		return new Response(null, {
			status: 416,
			headers: { ...headers, "Content-Range": `bytes */${asset.size}` },
		});
	}
	const head = request.method === "HEAD";
	const key = keyOf(repo, asset.id);
	if (!head && (!range || range.start === 0)) {
		// A download is counted once, when the file is read from its start.
		incrementDownloadCount(asset.id).catch((error: unknown) =>
			logError("release", "counting a download failed", error),
		);
	}
	if (range) {
		return new Response(head ? null : byteStream(key, range.start, range.end), {
			status: 206,
			headers: {
				...headers,
				"Content-Length": String(range.end - range.start + 1),
				"Content-Range": `bytes ${range.start}-${range.end}/${asset.size}`,
			},
		});
	}
	return new Response(head ? null : byteStream(key, 0, asset.size - 1), {
		headers: { ...headers, "Content-Length": String(asset.size) },
	});
}

/**
 * `GET /{owner}/{repo}/releases/download/{tag}/{name}`: 404 for anything
 * unreadable (a private repository answers like a missing one) and for the
 * assets of a draft unless the caller can write.
 */
export async function serveReleaseDownload(
	request: Request,
	owner: string,
	name: string,
	tag: string,
	assetName: string,
): Promise<Response> {
	try {
		const repository = await findRepositoryByName(owner, name);
		if (!repository) return downloadNotFound();
		const downloader = await resolveDownloader(request);
		if ("response" in downloader) return downloader.response;
		const access = await getAccessForRepository(repository, downloader.userId);
		if (!access.canRead) return downloadNotFound();
		const release =
			(await findReleaseByTag(repository.id, tag)) ??
			(access.canWrite
				? await findDraftReleaseByTag(repository.id, tag)
				: null);
		const asset = release?.assets.find((value) => value.name === assetName);
		if (!asset) return downloadNotFound();
		return assetResponse(repository, asset, request, {
			isPublic: repository.visibility === "public",
		});
	} catch (error) {
		logError("release", `GET ${owner}/${name} release download failed`, error);
		return new Response("Internal error", { status: 500 });
	}
}
