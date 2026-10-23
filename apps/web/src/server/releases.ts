import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	MAX_BODY_CHARS,
	MAX_RELEASE_ASSET_INLINE_BYTES,
	MAX_RELEASE_ASSET_NAME_CHARS,
	MAX_RELEASE_NAME_CHARS,
	MAX_RELEASE_TAG_CHARS,
	maxBase64CharsForBytes,
} from "#/lib/limits";
import { safeRefNameSchema } from "./git-ref-name";
import {
	AssetInputError,
	deleteAsset,
	finishAssetUpload,
	PresignUnavailableError,
	startAssetUpload,
	uploadAssetBytes,
} from "./release-assets";
import {
	createRelease,
	deleteRelease,
	generateReleaseNotes,
	ReleaseInputError,
	updateRelease,
} from "./release-service";
import {
	countReleases,
	findAsset,
	findDraftReleaseByTag,
	findLatestRelease,
	findRelease,
	findReleaseByTag,
	listReleases,
} from "./release-store";
import {
	getRepositoryAccess,
	readWithAccess,
	writeWithAccess,
} from "./repo-access";
import { getCurrentUserOptional } from "./session";

const RELEASES_PAGE_SIZE = 20;

const tagName = z.string().min(1).max(MAX_RELEASE_TAG_CHARS);

/** Service errors as messages a person can act on. */
async function plainErrors<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof ReleaseInputError) {
			if (error.field === "tag_name") {
				throw new Error(
					error.code === "already_exists"
						? "A release for this tag already exists"
						: "That is not a valid tag name",
				);
			}
			throw new Error("The target branch or commit doesn't exist");
		}
		if (error instanceof AssetInputError) {
			throw new Error(
				error.code === "already_exists"
					? "A file with this name is already attached"
					: error.message,
			);
		}
		if (error instanceof PresignUnavailableError) throw error;
		throw error;
	}
}

export const getReleases = createServerFn({ method: "GET" })
	.validator(
		z.object({ repoId: z.number(), page: z.number().int().min(1).max(500) }),
	)
	.handler(({ data }) =>
		readWithAccess("getReleases", data.repoId, async (repo) => {
			const user = await getCurrentUserOptional();
			const access = await getRepositoryAccess(repo.id, user?.id);
			const canWrite = Boolean(access?.canWrite);
			const [releases, total, latest] = await Promise.all([
				listReleases(repo.id, {
					includeDrafts: canWrite,
					limit: RELEASES_PAGE_SIZE,
					offset: (data.page - 1) * RELEASES_PAGE_SIZE,
				}),
				countReleases(repo.id, canWrite),
				findLatestRelease(repo.id),
			]);
			return {
				releases,
				total,
				pageSize: RELEASES_PAGE_SIZE,
				latestId: latest?.id ?? null,
				canWrite,
				defaultBranch: repo.defaultBranch,
			};
		}),
	);

export const getReleaseByTagName = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number(), tag: tagName }))
	.handler(({ data }) =>
		readWithAccess("getReleaseByTagName", data.repoId, async (repo) => {
			const user = await getCurrentUserOptional();
			const access = await getRepositoryAccess(repo.id, user?.id);
			const canWrite = Boolean(access?.canWrite);
			const release =
				(await findReleaseByTag(repo.id, data.tag)) ??
				(canWrite ? await findDraftReleaseByTag(repo.id, data.tag) : null);
			if (!release) throw notFound();
			const latest = await findLatestRelease(repo.id);
			return {
				release,
				canWrite,
				isLatest: latest?.id === release.id,
				defaultBranch: repo.defaultBranch,
			};
		}),
	);

/** The tag of the latest release, for `/releases/latest`; null when there is none. */
export const getLatestReleaseTag = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(({ data }) =>
		readWithAccess("getLatestReleaseTag", data.repoId, async (repo) => {
			const latest = await findLatestRelease(repo.id);
			return latest ? latest.tagName : null;
		}),
	);

const releaseFields = {
	tagName,
	targetCommitish: safeRefNameSchema,
	name: z.string().max(MAX_RELEASE_NAME_CHARS),
	body: z.string().max(MAX_BODY_CHARS),
	draft: z.boolean(),
	prerelease: z.boolean(),
	makeLatest: z.boolean(),
};

export const createReleaseFn = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), ...releaseFields }))
	.handler(({ data }) =>
		writeWithAccess(data.repoId, (repo, user) =>
			plainErrors(async () => {
				const id = await createRelease(repo, user.id, {
					tagName: data.tagName,
					targetCommitish: data.targetCommitish,
					name: data.name.trim() || null,
					body: data.body || null,
					draft: data.draft,
					prerelease: data.prerelease,
					makeLatest: data.makeLatest ? "true" : "legacy",
				});
				return { id, tagName: data.tagName };
			}),
		),
	);

export const updateReleaseFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			releaseId: z.number(),
			...releaseFields,
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (repo) => {
			const existing = await findRelease(repo.id, data.releaseId);
			if (!existing) throw notFound();
			await plainErrors(() =>
				updateRelease(repo, existing, {
					tagName: data.tagName,
					targetCommitish: data.targetCommitish,
					name: data.name.trim() || null,
					body: data.body || null,
					draft: data.draft,
					prerelease: data.prerelease,
					makeLatest: data.makeLatest ? "true" : "legacy",
				}),
			);
			return { id: existing.id, tagName: data.tagName };
		}),
	);

export const deleteReleaseFn = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), releaseId: z.number() }))
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (repo) => {
			if (!(await deleteRelease(repo, data.releaseId))) throw notFound();
		}),
	);

export const generateReleaseNotesFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			tagName,
			targetCommitish: safeRefNameSchema.optional(),
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, (repo) =>
			plainErrors(() =>
				generateReleaseNotes(repo, {
					tagName: data.tagName,
					targetCommitish: data.targetCommitish,
				}),
			),
		),
	);

const assetFields = {
	repoId: z.number(),
	releaseId: z.number(),
	name: z.string().trim().min(1).max(MAX_RELEASE_ASSET_NAME_CHARS),
	contentType: z.string().max(255),
};

/** A small file, sent as base64 in the request (≤ `MAX_RELEASE_ASSET_INLINE_BYTES`). */
export const uploadReleaseAssetFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			...assetFields,
			content: z
				.string()
				.max(maxBase64CharsForBytes(MAX_RELEASE_ASSET_INLINE_BYTES)),
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (repo, user) => {
			if (!(await findRelease(repo.id, data.releaseId))) throw notFound();
			await plainErrors(() =>
				uploadAssetBytes(repo, {
					releaseId: data.releaseId,
					uploaderId: user.id,
					name: data.name,
					label: null,
					contentType: data.contentType || "application/octet-stream",
					bytes: new Uint8Array(Buffer.from(data.content, "base64")),
				}),
			);
		}),
	);

/** A large file: the asset row and the presigned URL to PUT it to. */
export const startReleaseAssetUploadFn = createServerFn({ method: "POST" })
	.validator(z.object({ ...assetFields, size: z.number().int().positive() }))
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (repo, user) => {
			if (!(await findRelease(repo.id, data.releaseId))) throw notFound();
			const { id, uploadUrl } = await plainErrors(() =>
				startAssetUpload(repo, {
					releaseId: data.releaseId,
					uploaderId: user.id,
					name: data.name,
					label: null,
					contentType: data.contentType || "application/octet-stream",
					size: data.size,
				}),
			);
			return { assetId: id, uploadUrl };
		}),
	);

export const finishReleaseAssetUploadFn = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), assetId: z.number() }))
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (repo) => {
			const asset = await findAsset(repo.id, data.assetId);
			if (!asset) throw notFound();
			await plainErrors(() => finishAssetUpload(repo, asset));
		}),
	);

export const deleteReleaseAssetFn = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), assetId: z.number() }))
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (repo) => {
			const asset = await findAsset(repo.id, data.assetId);
			if (!asset) throw notFound();
			await deleteAsset(repo, asset.id);
		}),
	);
