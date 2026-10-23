/**
 * Releases in the repository domain: `Repository.releases`/`release`/
 * `latestRelease`, `Release` and `ReleaseAsset` (what `gh release list` and
 * `view` read). Drafts are only visible to writers, as everywhere; the types
 * are served from release-store.ts, the same rows as the REST API.
 */
import { db } from "#/db";
import { htmlUrl, isoTimestamp } from "../../api/http";
import {
	countReleases,
	findLatestRelease,
	findRelease,
	findReleaseByTag,
	listReleases,
	type ReleaseWithAssets,
} from "../../release-store";
import { offsetConnection } from "../connection";
import type { GraphQLContext } from "../context";
import { encodeNodeId, rowIdOfNodeKey } from "../node-id";
import { loadUser, userNode } from "./core";
import type {
	ReleaseOrder,
	ReleaseReleaseAssetsArgs,
	RepositoryReleasesArgs,
} from "./generated";
import type { RepositoryNode } from "./repository";
import type { NodeLoader } from "./types";

type AssetRow = ReleaseWithAssets["assets"][number];

export interface ReleaseAssetNode {
	__typename: "ReleaseAsset";
	id: string;
	name: string;
	contentType: string;
	size: number;
	downloadCount: number;
	createdAt: string;
	updatedAt: string;
	url: string;
	downloadUrl: string;
	row: AssetRow;
	release: ReleaseNode;
}

export interface ReleaseNode {
	__typename: "Release";
	id: string;
	databaseId: number;
	name: string | null;
	tagName: string;
	description: string | null;
	isDraft: boolean;
	isLatest: boolean;
	isPrerelease: boolean;
	immutable: false;
	createdAt: string;
	publishedAt: string | null;
	updatedAt: string;
	url: string;
	resourcePath: string;
	row: ReleaseWithAssets;
	repo: RepositoryNode;
}

const encodePath = (path: string) =>
	path.split("/").map(encodeURIComponent).join("/");

const canWrite = (repo: RepositoryNode) =>
	repo.role === "owner" || repo.role === "admin" || repo.role === "write";

function releaseNode(
	repo: RepositoryNode,
	row: ReleaseWithAssets,
	latestId: number | null,
): ReleaseNode {
	const path = `/${repo.nameWithOwner}/releases/tag/${encodePath(row.tagName)}`;
	return {
		__typename: "Release",
		id: encodeNodeId("Release", row.id),
		databaseId: row.id,
		name: row.name,
		tagName: row.tagName,
		description: row.body,
		isDraft: row.draft,
		isLatest: row.id === latestId,
		isPrerelease: row.prerelease,
		immutable: false,
		createdAt: isoTimestamp(row.createdAt),
		publishedAt: row.publishedAt ? isoTimestamp(row.publishedAt) : null,
		updatedAt: isoTimestamp(row.updatedAt),
		url: htmlUrl(path),
		resourcePath: path,
		row,
		repo,
	};
}

function assetNode(release: ReleaseNode, row: AssetRow): ReleaseAssetNode {
	const download = `/${release.repo.nameWithOwner}/releases/download/${encodePath(release.tagName)}/${encodeURIComponent(row.name)}`;
	return {
		__typename: "ReleaseAsset",
		id: encodeNodeId("ReleaseAsset", row.id),
		name: row.name,
		contentType: row.contentType,
		size: row.size,
		downloadCount: row.downloadCount,
		createdAt: isoTimestamp(row.createdAt),
		updatedAt: isoTimestamp(row.updatedAt),
		url: htmlUrl(download),
		downloadUrl: htmlUrl(download),
		row,
		release,
	};
}

const latestIdOf = async (ctx: GraphQLContext, repo: RepositoryNode) =>
	ctx
		.loader<number, number | null>("latest-release-id", async (ids) => {
			const entries = await Promise.all(
				ids.map(
					async (id) =>
						[id, (await findLatestRelease(id))?.id ?? null] as const,
				),
			);
			return new Map(entries);
		})
		.load(repo.row.id)
		.then((id) => id ?? null);

function order(orderBy: ReleaseOrder | null | undefined) {
	return {
		field:
			orderBy?.field === "NAME" ? ("name" as const) : ("createdAt" as const),
		direction:
			orderBy?.direction === "ASC" ? ("asc" as const) : ("desc" as const),
	};
}

/** The fields this module adds to `Repository`. */
export const repositoryReleaseFields = {
	releases: async (
		source: RepositoryNode,
		args: RepositoryReleasesArgs,
		ctx: GraphQLContext,
	) => {
		const includeDrafts = canWrite(source);
		const latestId = await latestIdOf(ctx, source);
		const total = await countReleases(source.row.id, includeDrafts);
		return offsetConnection(args, total, async (offset, limit) =>
			(
				await listReleases(source.row.id, {
					includeDrafts,
					limit,
					offset,
					order: order(args.orderBy),
				})
			).map((row) => releaseNode(source, row, latestId)),
		);
	},
	release: async (
		source: RepositoryNode,
		args: { tagName: string },
		ctx: GraphQLContext,
	) => {
		const row = await findReleaseByTag(source.row.id, args.tagName);
		return row ? releaseNode(source, row, await latestIdOf(ctx, source)) : null;
	},
	latestRelease: async (source: RepositoryNode) => {
		const row = await findLatestRelease(source.row.id);
		return row ? releaseNode(source, row, row.id) : null;
	},
};

export const releaseTypeResolvers = {
	Release: {
		author: async (
			source: ReleaseNode,
			_args: unknown,
			ctx: GraphQLContext,
		) => {
			const row = await loadUser(ctx, source.row.authorId);
			return row ? userNode(row) : null;
		},
		repository: (source: ReleaseNode) => source.repo,
		releaseAssets: (source: ReleaseNode, args: ReleaseReleaseAssetsArgs) => {
			const rows = args.name
				? source.row.assets.filter((asset) => asset.name === args.name)
				: source.row.assets;
			return offsetConnection(args, rows.length, async (offset, limit) =>
				rows.slice(offset, offset + limit).map((row) => assetNode(source, row)),
			);
		},
	},
	ReleaseAsset: {
		release: (source: ReleaseAssetNode) => source.release,
		uploadedBy: async (
			source: ReleaseAssetNode,
			_args: unknown,
			ctx: GraphQLContext,
		) => {
			const row = await loadUser(ctx, source.row.uploaderId);
			if (!row) throw new Error("Asset uploader missing");
			return userNode(row);
		},
	},
};

/** `node(id:)` loaders; `loadRepository` resolves a readable repository by row id. */
export function releaseNodeLoaders(loadRepository: NodeLoader): {
	Release: NodeLoader;
	ReleaseAsset: NodeLoader;
} {
	const loadRelease = async (
		ctx: GraphQLContext,
		wanted: { releaseId?: number; assetId?: number },
	) => {
		const id = wanted.releaseId ?? wanted.assetId;
		if (id === undefined) return null;
		const release =
			wanted.releaseId !== undefined
				? await db.query.releases.findFirst({
						where: { id },
						columns: { id: true, repoId: true },
					})
				: (
						await db.query.releaseAssets.findFirst({
							where: { id },
							with: { release: { columns: { id: true, repoId: true } } },
						})
					)?.release;
		if (!release) return null;
		const repo = (await loadRepository(
			String(release.repoId),
			ctx,
		)) as RepositoryNode | null;
		if (!repo) return null;
		const row = await findRelease(repo.row.id, release.id);
		if (!row || (row.draft && !canWrite(repo))) return null;
		const node = releaseNode(repo, row, (await latestIdOf(ctx, repo)) ?? null);
		if (wanted.assetId === undefined) return node;
		const asset = row.assets.find((value) => value.id === wanted.assetId);
		return asset ? assetNode(node, asset) : null;
	};
	return {
		Release: async (key, ctx) => {
			const id = rowIdOfNodeKey(key);
			return id === null ? null : loadRelease(ctx, { releaseId: id });
		},
		ReleaseAsset: async (key, ctx) => {
			const id = rowIdOfNodeKey(key);
			return id === null ? null : loadRelease(ctx, { assetId: id });
		},
	};
}
