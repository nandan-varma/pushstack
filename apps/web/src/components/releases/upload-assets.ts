import { MAX_RELEASE_ASSET_INLINE_BYTES } from "@/lib/limits";
import {
	finishReleaseAssetUploadFn,
	startReleaseAssetUploadFn,
	uploadReleaseAssetFn,
} from "@/server/releases";

async function toBase64(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	const step = 0x8000;
	for (let i = 0; i < bytes.length; i += step) {
		binary += String.fromCharCode(...bytes.subarray(i, i + step));
	}
	return btoa(binary);
}

/**
 * Attach `file` to a release. Small files travel in a server-function call;
 * larger ones are PUT straight to R2 on a presigned URL (a function request
 * body is capped at 4.5 MB) and then verified by the server.
 */
export async function uploadReleaseAsset(
	repoId: number,
	releaseId: number,
	file: File,
): Promise<void> {
	const contentType = file.type || "application/octet-stream";
	if (file.size <= MAX_RELEASE_ASSET_INLINE_BYTES) {
		await uploadReleaseAssetFn({
			data: {
				repoId,
				releaseId,
				name: file.name,
				contentType,
				content: await toBase64(file),
			},
		});
		return;
	}
	const { assetId, uploadUrl } = await startReleaseAssetUploadFn({
		data: { repoId, releaseId, name: file.name, contentType, size: file.size },
	});
	const response = await fetch(uploadUrl, {
		method: "PUT",
		body: file,
		headers: { "Content-Type": contentType },
	});
	if (!response.ok) {
		throw new Error(`Uploading ${file.name} failed (HTTP ${response.status})`);
	}
	await finishReleaseAssetUploadFn({ data: { repoId, assetId } });
}
