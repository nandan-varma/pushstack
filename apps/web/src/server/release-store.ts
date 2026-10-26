/**
 * Releases and their assets (GitHub's `…/releases`), shared by the REST API,
 * the web pages' server functions and GraphQL. Plain server-only module:
 * callers check access first. Asset bytes are not touched here (see
 * `release-assets.ts`); deleting rows returns what the caller must delete
 * from storage.
 */
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "#/db";
import { releaseAssets, releases } from "#/db/app-schema";
import { isUniqueViolation } from "./db-errors";
import { logError } from "./perf-log";
import { publicUserFields } from "./repository-lookup";

export type ReleaseRow = typeof releases.$inferSelect;
export type ReleaseAssetRow = typeof releaseAssets.$inferSelect;

const releaseWith = {
	author: publicUserFields,
	assets: {
		where: { state: "uploaded" },
		orderBy: { id: "asc" },
		with: { uploader: publicUserFields },
	},
} as const;

export type ReleaseWithAssets = NonNullable<
	Awaited<ReturnType<typeof findRelease>>
>;

/** A published release already uses this tag. */
export class DuplicateReleaseError extends Error {
	constructor() {
		super("A release for this tag already exists");
	}
}

/** An asset of this name is already on the release. */
export class DuplicateAssetError extends Error {
	constructor() {
		super("An asset with this name already exists");
	}
}

export function findRelease(repoId: number, releaseId: number) {
	return db.query.releases.findFirst({
		where: { id: releaseId, repoId },
		with: releaseWith,
	});
}

/** The published release for `tag`; drafts are not addressable by tag. */
export function findReleaseByTag(repoId: number, tagName: string) {
	return db.query.releases.findFirst({
		where: { repoId, tagName, draft: false },
		with: releaseWith,
	});
}

/** A draft release for `tag` (writers' web page). */
export function findDraftReleaseByTag(repoId: number, tagName: string) {
	return db.query.releases.findFirst({
		where: { repoId, tagName, draft: true },
		with: releaseWith,
		orderBy: { createdAt: "desc", id: "desc" },
	});
}

/** Newest first; drafts only when `includeDrafts` (writers). */
export function listReleases(
	repoId: number,
	options: {
		includeDrafts: boolean;
		limit?: number;
		offset?: number;
		/** Default: newest first (GraphQL's `ReleaseOrder`). */
		order?: { field: "createdAt" | "name"; direction: "asc" | "desc" };
	},
) {
	const { field, direction } = options.order ?? {
		field: "createdAt",
		direction: "desc",
	};
	return db.query.releases.findMany({
		where: options.includeDrafts ? { repoId } : { repoId, draft: false },
		with: releaseWith,
		orderBy: { [field]: direction, id: direction },
		...(options.limit !== undefined && { limit: options.limit }),
		...(options.offset !== undefined && { offset: options.offset }),
	});
}

export async function countReleases(
	repoId: number,
	includeDrafts: boolean,
): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(releases)
		.where(
			includeDrafts
				? eq(releases.repoId, repoId)
				: and(eq(releases.repoId, repoId), eq(releases.draft, false)),
		);
	return row?.total ?? 0;
}

/**
 * The "latest" release: the published, non-prerelease one marked
 * `make_latest: true`, else the newest by creation that is not `false`.
 */
export async function findLatestRelease(repoId: number) {
	const explicit = await db.query.releases.findFirst({
		where: { repoId, draft: false, prerelease: false, makeLatest: "true" },
		with: releaseWith,
		orderBy: { publishedAt: "desc", id: "desc" },
	});
	if (explicit) return explicit;
	return db.query.releases.findFirst({
		where: {
			repoId,
			draft: false,
			prerelease: false,
			makeLatest: { ne: "false" },
		},
		with: releaseWith,
		orderBy: { createdAt: "desc", id: "desc" },
	});
}

export interface ReleaseInput {
	tagName: string;
	targetCommitish: string;
	name: string | null;
	body: string | null;
	draft: boolean;
	prerelease: boolean;
	makeLatest: "true" | "false" | "legacy";
}

/** `make_latest: true` takes the badge from every other release. */
/**
 * Clears `make_latest` on the repository's latest releases (but `exceptId`)
 * and returns their ids. One statement, so it either applies or does not.
 */
async function demoteLatest(repoId: number, exceptId?: number) {
	const rows = await db
		.update(releases)
		.set({ makeLatest: "legacy" })
		.where(
			and(
				eq(releases.repoId, repoId),
				eq(releases.makeLatest, "true"),
				exceptId === undefined ? undefined : ne(releases.id, exceptId),
			),
		)
		.returning({ id: releases.id });
	return rows.map((row) => row.id);
}

/**
 * Puts `make_latest` back on the releases `demoteLatest` cleared, when the
 * write that demoted them failed. There are no transactions on the Neon HTTP
 * driver, so this compensates. A failed restore is logged, not thrown: if the
 * database fails both writes, the repository can be left with no latest release
 * until one is set. Concurrent creates are not serialized, so two can still
 * clear the others before either inserts and leave two latest releases.
 */
async function restoreLatest(ids: number[]) {
	if (ids.length === 0) return;
	await db
		.update(releases)
		.set({ makeLatest: "true" })
		.where(inArray(releases.id, ids))
		.catch((cleanup: unknown) =>
			logError(
				"release-store",
				`Latest release(s) ${ids.join(", ")} were not restored after a failed write`,
				cleanup,
			),
		);
}

export async function createReleaseRow(
	repoId: number,
	authorId: string,
	input: ReleaseInput,
): Promise<number> {
	// The previous latest is cleared before the insert and restored if the insert
	// fails. Sequential failures leave the previous latest in place; see restoreLatest.
	const demoted = input.makeLatest === "true" ? await demoteLatest(repoId) : [];
	let row: { id: number } | undefined;
	try {
		[row] = await db
			.insert(releases)
			.values({
				repoId,
				authorId,
				...input,
				publishedAt: input.draft ? null : new Date(),
			})
			.returning({ id: releases.id });
	} catch (error) {
		await restoreLatest(demoted);
		throw isUniqueViolation(error) ? new DuplicateReleaseError() : error;
	}
	if (!row) {
		await restoreLatest(demoted);
		throw new Error("Release insert returned no row");
	}
	return row.id;
}

export async function updateReleaseRow(
	repoId: number,
	releaseId: number,
	existing: ReleaseRow,
	fields: Partial<ReleaseInput>,
): Promise<void> {
	const publishing = fields.draft === false && existing.draft;
	const draftAgain = fields.draft === true && !existing.draft;
	// As on create: the others are cleared first and restored if this update fails.
	const demoted =
		fields.makeLatest === "true" ? await demoteLatest(repoId, releaseId) : [];
	try {
		await db
			.update(releases)
			.set({
				...fields,
				// GitHub stamps `published_at` when a draft is published.
				...(publishing && { publishedAt: new Date() }),
				...(draftAgain && { publishedAt: null }),
				updatedAt: new Date(),
			})
			.where(and(eq(releases.repoId, repoId), eq(releases.id, releaseId)));
	} catch (error) {
		await restoreLatest(demoted);
		throw isUniqueViolation(error) ? new DuplicateReleaseError() : error;
	}
}

/** Delete the release; returns its asset ids for the caller to remove from storage. */
export async function deleteReleaseRow(
	repoId: number,
	releaseId: number,
): Promise<number[] | null> {
	const assets = await db
		.select({ id: releaseAssets.id })
		.from(releaseAssets)
		.innerJoin(releases, eq(releases.id, releaseAssets.releaseId))
		.where(and(eq(releases.repoId, repoId), eq(releases.id, releaseId)));
	const deleted = await db
		.delete(releases)
		.where(and(eq(releases.repoId, repoId), eq(releases.id, releaseId)))
		.returning({ id: releases.id });
	return deleted.length > 0 ? assets.map((asset) => asset.id) : null;
}

/** A deleted tag leaves its releases behind as drafts, as on GitHub. */
export async function draftReleasesForDeletedTag(
	repoId: number,
	tagName: string,
): Promise<void> {
	await db
		.update(releases)
		.set({ draft: true, publishedAt: null, updatedAt: new Date() })
		.where(
			and(
				eq(releases.repoId, repoId),
				eq(releases.tagName, tagName),
				eq(releases.draft, false),
			),
		);
}

// Assets ----------------------------------------------------------------

export function findAsset(repoId: number, assetId: number) {
	return db.query.releaseAssets.findFirst({
		where: { id: assetId, release: { repoId } },
		with: { uploader: publicUserFields, release: true },
	});
}

export function listAssets(
	releaseId: number,
	options?: { limit?: number; offset?: number },
) {
	return db.query.releaseAssets.findMany({
		where: { releaseId, state: "uploaded" },
		with: { uploader: publicUserFields },
		orderBy: { id: "asc" },
		...(options?.limit !== undefined && { limit: options.limit }),
		...(options?.offset !== undefined && { offset: options.offset }),
	});
}

export async function countAssets(releaseId: number): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(releaseAssets)
		.where(
			and(
				eq(releaseAssets.releaseId, releaseId),
				eq(releaseAssets.state, "uploaded"),
			),
		);
	return row?.total ?? 0;
}

/**
 * Insert an asset row. A same-named asset that never finished uploading
 * (`open`) is replaced; an uploaded one is a `DuplicateAssetError`.
 */
export async function createAssetRow(input: {
	releaseId: number;
	uploaderId: string;
	name: string;
	label: string | null;
	contentType: string;
	size: number;
	state: "open" | "uploaded";
}): Promise<{ id: number; replacedPending: number | null }> {
	const existing = await db.query.releaseAssets.findFirst({
		where: { releaseId: input.releaseId, name: input.name },
	});
	let replacedPending: number | null = null;
	if (existing) {
		if (existing.state === "uploaded") throw new DuplicateAssetError();
		replacedPending = existing.id;
		await db.delete(releaseAssets).where(eq(releaseAssets.id, existing.id));
	}
	const [row] = await db
		.insert(releaseAssets)
		.values(input)
		.returning({ id: releaseAssets.id })
		.catch((error: unknown) => {
			throw isUniqueViolation(error) ? new DuplicateAssetError() : error;
		});
	if (!row) throw new Error("Asset insert returned no row");
	return { id: row.id, replacedPending };
}

/** Assets whose presigned upload was started before `before` and never finished. */
export function staleOpenAssets(releaseId: number, before: Date) {
	return db.query.releaseAssets.findMany({
		where: { releaseId, state: "open", createdAt: { lt: before } },
		columns: { id: true },
	});
}

export async function markAssetUploaded(
	assetId: number,
	size: number,
): Promise<void> {
	await db
		.update(releaseAssets)
		.set({ state: "uploaded", size, updatedAt: new Date() })
		.where(eq(releaseAssets.id, assetId));
}

export async function updateAssetRow(
	assetId: number,
	fields: { name?: string; label?: string | null },
): Promise<void> {
	await db
		.update(releaseAssets)
		.set({ ...fields, updatedAt: new Date() })
		.where(eq(releaseAssets.id, assetId))
		.catch((error: unknown) => {
			throw isUniqueViolation(error) ? new DuplicateAssetError() : error;
		});
}

/** Delete the row only while it is still `open`; false when it finished meanwhile. */
export async function deleteOpenAssetRow(assetId: number): Promise<boolean> {
	const deleted = await db
		.delete(releaseAssets)
		.where(and(eq(releaseAssets.id, assetId), eq(releaseAssets.state, "open")))
		.returning({ id: releaseAssets.id });
	return deleted.length > 0;
}

export async function deleteAssetRow(assetId: number): Promise<void> {
	await db.delete(releaseAssets).where(eq(releaseAssets.id, assetId));
}

export async function incrementDownloadCount(assetId: number): Promise<void> {
	await db
		.update(releaseAssets)
		.set({ downloadCount: sql`${releaseAssets.downloadCount} + 1` })
		.where(eq(releaseAssets.id, assetId));
}
