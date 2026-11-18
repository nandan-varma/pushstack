/**
 * Gists in GraphQL: `User.gists` and the `Gist`, `GistFile`, `GistComment`
 * and `Language` types (what `gh gist list` reads). Rows come from
 * `gist-store.ts`, files from `gist-git.ts`; a secret gist is unlisted, not
 * private, so it is absent from another user's connection but readable by id.
 */
import { detectLanguage, getMimeType } from "#/lib/language-detection";
import { htmlUrl, isoTimestamp } from "../../api/http";
import { readGistFiles } from "../../gist-git";
import {
	countGistComments,
	countGistStars,
	findGistById,
	findGistCommentById,
	type GistCommentWithAuthor,
	type GistRowWithOwner,
	isGistStarred,
	listGistComments,
	listGistForks,
	listGistStargazers,
	listGistsForOwner,
} from "../../gist-store";
import { countedConnection, offsetConnection } from "../connection";
import type { GraphQLContext } from "../context";
import { encodeGlobalNodeId, encodeNodeId, rowIdOfNodeKey } from "../node-id";
import { loadUser, type UserNode, userNode } from "./core";
import type {
	GistCommentsArgs,
	GistFilesArgs,
	GistFileTextArgs,
	GistForksArgs,
	GistStargazersArgs,
	Resolvers,
	UserGistsArgs,
} from "./generated";
import type { NodeLoader } from "./types";

export interface GistNode {
	__typename: "Gist";
	id: string;
	row: GistRowWithOwner;
}

export interface GistFileNode {
	__typename: "GistFile";
	path: string;
	size: number;
	truncated: boolean;
	content: Uint8Array | null;
}

export interface GistCommentNode {
	__typename: "GistComment";
	id: string;
	row: GistCommentWithAuthor;
	gist: GistNode;
}

export interface LanguageNode {
	__typename: "Language";
	id: string;
	name: string;
}

function gistNode(row: GistRowWithOwner): GistNode {
	return {
		__typename: "Gist",
		id: encodeGlobalNodeId("Gist", row.owner.apiId, row.id),
		row,
	};
}

const commentNode = (
	row: GistCommentWithAuthor,
	gist: GistNode,
): GistCommentNode => ({
	__typename: "GistComment",
	id: encodeNodeId("GistComment", row.id),
	row,
	gist,
});

const languageNode = (name: string): LanguageNode => ({
	__typename: "Language",
	id: encodeNodeId("Language", name),
	name,
});

const gistOrder = (args: UserGistsArgs) => ({
	field:
		args.orderBy?.field === "CREATED_AT"
			? ("createdAt" as const)
			: args.orderBy?.field === "PUSHED_AT"
				? ("pushedAt" as const)
				: ("updatedAt" as const),
	direction:
		args.orderBy?.direction === "ASC" ? ("asc" as const) : ("desc" as const),
});

async function ownerOf(
	ctx: GraphQLContext,
	source: GistNode,
): Promise<UserNode | null> {
	const row = await loadUser(ctx, source.row.ownerId);
	return row ? userNode(row) : null;
}

export const userGistFields = {
	gists: async (source: UserNode, args: UserGistsArgs, ctx) => {
		const viewer = source.userId === ctx.caller.userId;
		const privacy = args.privacy ?? "ALL";
		// Another user's secret gists are never listed.
		if (!viewer && privacy === "SECRET") {
			return offsetConnection(args, 0, async () => []);
		}
		const visibility = viewer
			? privacy === "PUBLIC"
				? ("public" as const)
				: privacy === "SECRET"
					? ("secret" as const)
					: undefined
			: ("public" as const);
		return countedConnection(args, async (offset, limit) => {
			const page = await listGistsForOwner(source.userId, {
				limit,
				offset,
				visibility,
				order: gistOrder(args),
			});
			return {
				items: page.gists.map((row) => gistNode(row)),
				total: page.total,
			};
		});
	},
} satisfies Resolvers["User"];

export const gistTypeResolvers = {
	Gist: {
		name: (source) => source.row.id,
		description: (source) => source.row.description,
		isPublic: (source) => source.row.visibility === "public",
		isFork: (source) => source.row.isFork,
		createdAt: (source) => isoTimestamp(source.row.createdAt),
		updatedAt: (source) => isoTimestamp(source.row.updatedAt),
		pushedAt: (source) => isoTimestamp(source.row.pushedAt),
		url: (source) => htmlUrl(`/${source.row.owner.username}/${source.row.id}`),
		resourcePath: (source) => `/${source.row.owner.username}/${source.row.id}`,
		owner: (source, _args, ctx) => ownerOf(ctx, source),
		files: async (source, args: GistFilesArgs, ctx) => {
			const revision = args.oid ?? "HEAD";
			const files = await ctx.memo(
				`gist-files:${source.row.id}:${revision}`,
				() => readGistFiles(source.row.id, revision),
			);
			return files.slice(0, args.limit ?? 10).map((file) => ({
				__typename: "GistFile" as const,
				path: file.path,
				size: file.size,
				truncated: file.truncated,
				content: file.content,
			}));
		},
		comments: async (source, args: GistCommentsArgs) => {
			const total = await countGistComments(source.row.id);
			return offsetConnection(args, total, async (offset, limit) =>
				(await listGistComments(source.row.id, { limit, offset })).map((row) =>
					commentNode(row, source),
				),
			);
		},
		forks: async (source, args: GistForksArgs) =>
			countedConnection(args, async (offset, limit) => {
				const page = await listGistForks(source.row.id, { limit, offset });
				return {
					items: page.gists.map((row) => gistNode(row)),
					total: page.total,
				};
			}),
		stargazerCount: (source) => countGistStars(source.row.id),
		viewerHasStarred: (source, _args, ctx) =>
			isGistStarred(source.row.id, ctx.caller.userId),
		stargazers: async (source, args: GistStargazersArgs, ctx) => {
			const total = await countGistStars(source.row.id);
			const connection = await offsetConnection(
				args,
				total,
				async (offset, limit) =>
					Promise.all(
						(await listGistStargazers(source.row.id, { limit, offset })).map(
							async ({ user, starredAt }) => {
								const row = await loadUser(ctx, user.id);
								if (!row) throw new Error("Gist stargazer missing");
								return {
									node: userNode(row),
									starredAt: isoTimestamp(starredAt),
								};
							},
						),
					),
			);
			return {
				...connection,
				nodes: connection.nodes.map((entry) => entry.node),
				edges: connection.edges.map((edge) => ({
					cursor: edge.cursor,
					starredAt: edge.node.starredAt,
					node: edge.node.node,
				})),
			};
		},
	},
	GistFile: {
		name: (source: GistFileNode) => source.path,
		encodedName: (source: GistFileNode) => encodeURIComponent(source.path),
		extension: (source: GistFileNode) => {
			const name = source.path.split("/").pop() ?? "";
			const dot = name.lastIndexOf(".");
			return dot > 0 ? name.slice(dot + 1) : null;
		},
		isImage: (source: GistFileNode) =>
			getMimeType(source.path).startsWith("image/"),
		isTruncated: (source: GistFileNode) => source.truncated,
		size: (source: GistFileNode) => source.size,
		language: (source: GistFileNode) => {
			const name = detectLanguage(source.path);
			return name === "plaintext" ? null : languageNode(name);
		},
		text: (source: GistFileNode, args: GistFileTextArgs) => {
			if (source.content === null) return null;
			const text = new TextDecoder().decode(source.content);
			return args.truncate == null ? text : text.slice(0, args.truncate);
		},
	},
	GistComment: {
		author: async (source, _args, ctx) => {
			const row = await loadUser(ctx, source.row.userId);
			return row ? userNode(row) : null;
		},
		body: (source) => source.row.body,
		bodyText: (source) => source.row.body,
		createdAt: (source) => isoTimestamp(source.row.createdAt),
		updatedAt: (source) => isoTimestamp(source.row.updatedAt),
		databaseId: (source) => source.row.id,
		gist: (source) => source.gist,
		includesCreatedEdit: () => false,
		viewerDidAuthor: (source, _args, ctx) =>
			source.row.userId === ctx.caller.userId,
		viewerCanUpdate: (source, _args, ctx) =>
			source.row.userId === ctx.caller.userId,
		viewerCanDelete: (source, _args, ctx) =>
			source.row.userId === ctx.caller.userId,
	},
	Language: {
		name: (source: LanguageNode) => source.name,
	},
} satisfies Resolvers;

const loadGistNode: NodeLoader = async (key) => {
	const row = await findGistById(key);
	return row ? gistNode(row) : null;
};

const loadGistCommentNode: NodeLoader = async (key) => {
	const commentId = rowIdOfNodeKey(key);
	if (commentId === null) return null;
	const row = await findGistCommentById(commentId);
	if (!row) return null;
	const gist = await findGistById(row.gistId);
	return gist ? commentNode(row, gistNode(gist)) : null;
};

const loadLanguageNode: NodeLoader = async (key) => languageNode(key);

export const gistNodes = {
	Gist: loadGistNode,
	GistComment: loadGistCommentNode,
	Language: loadLanguageNode,
};
