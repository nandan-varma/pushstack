/**
 * Gist web pages: the index, one gist with its files at a revision, comments,
 * forks, stars, and the mutations the page's buttons call. A gist's rows and
 * reads come from `gist-store.ts` and `gist-git.ts`, the same sources as REST.
 */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { isNotFoundError } from "git-fs-s3";
import { z } from "zod";
import { detectLanguage } from "#/lib/language-detection";
import {
	MAX_GIST_COMMENT_BODY_CHARS,
	MAX_GIST_DESCRIPTION_CHARS,
} from "#/lib/limits";
import { getAccessForGist } from "./gist-access";
import { gistCommitPage, listGistFilePaths, readGistFiles } from "./gist-git";
import {
	addGistStar,
	countGistStars,
	deleteGistCommentRow,
	findGistAtOwnerPath,
	findGistById,
	findGistComment,
	type GistCommentWithAuthor,
	insertGistComment,
	isGistStarred,
	listGistComments,
	listGistForks,
	listGistsForOwner,
	listPublicGists,
	removeGistStar,
} from "./gist-store";
import { GIST_ID_RE } from "./git-storage-naming";
import { readInput } from "./read-input";
import { getCurrentUser, getCurrentUserOptional } from "./session";

const INDEX_PAGE_SIZE = 10;
const FILES_PAGE_SIZE = 10;
const COMMENTS_PAGE_SIZE = 100;
const REVISIONS_PAGE_SIZE = 50;

const gistPath = z.object({
	owner: z.string(),
	id: z.string().regex(GIST_ID_RE),
});

const gistRevisionPath = gistPath.extend({
	revision: z.string().min(1).max(100).optional(),
});

async function loadGist(owner: string, id: string) {
	const row = await findGistAtOwnerPath(owner, id);
	if (!row) throw notFound();
	return row;
}

const fileView = (file: {
	path: string;
	size: number;
	truncated: boolean;
	content: Uint8Array | null;
}) => {
	const language = detectLanguage(file.path);
	return {
		path: file.path,
		size: file.size,
		truncated: file.truncated,
		language: language === "plaintext" ? null : language,
		content:
			file.content === null ? null : new TextDecoder().decode(file.content),
	};
};

const commentView = (comment: GistCommentWithAuthor, viewerId?: string) => ({
	id: comment.id,
	body: comment.body,
	createdAt: comment.createdAt.toISOString(),
	author: {
		username: comment.author.username,
		name: comment.author.name,
		image: comment.author.image,
	},
	canDelete: comment.userId === viewerId,
});

/** `GET /{owner}/{id}`: files at `revision` (HEAD by default) with comments. */
export const getGistPage = createServerFn({ method: "GET" })
	.validator(readInput(gistRevisionPath))
	.handler(async ({ data }) => {
		const row = await loadGist(data.owner, data.id);
		const viewer = await getCurrentUserOptional();
		const revision = data.revision ?? "HEAD";
		try {
			const [files, comments, forks, revisions, starCount, parent] =
				await Promise.all([
					readGistFiles(row.id, revision),
					listGistComments(row.id, { limit: COMMENTS_PAGE_SIZE, offset: 0 }),
					listGistForks(row.id, { limit: FILES_PAGE_SIZE, offset: 0 }),
					gistCommitPage(row.id, REVISIONS_PAGE_SIZE),
					countGistStars(row.id),
					row.forkOfId ? findGistById(row.forkOfId) : null,
				]);
			return {
				gist: {
					id: row.id,
					description: row.description,
					visibility: row.visibility,
					isFork: row.isFork,
					createdAt: row.createdAt.toISOString(),
					updatedAt: row.updatedAt.toISOString(),
					pushedAt: row.pushedAt.toISOString(),
					owner: {
						username: row.owner.username,
						name: row.owner.name,
						image: row.owner.image,
					},
					forkOf: parent
						? {
								id: parent.id,
								owner: { username: parent.owner.username },
							}
						: null,
				},
				files: files.map(fileView),
				comments: comments.map((comment) => commentView(comment, viewer?.id)),
				forks: forks.gists.map((fork) => ({
					id: fork.id,
					description: fork.description,
					updatedAt: fork.updatedAt.toISOString(),
					owner: { username: fork.owner.username },
				})),
				revisions: revisions.map((entry) => ({
					sha: entry.commit.oid,
					createdAt: new Date(
						entry.commit.commit.author.timestamp * 1000,
					).toISOString(),
				})),
				revision,
				starCount,
				isStarred: viewer ? await isGistStarred(row.id, viewer.id) : false,
				canWrite: getAccessForGist(row, viewer?.id).canWrite,
			};
		} catch (error) {
			// A revision or path the gist's git data does not have is a URL that
			// names nothing: GitHub answers 404, not 500.
			if (isNotFoundError(error)) throw notFound();
			throw error;
		}
	});

/** `/gist`: the caller's own gists, or recent public ones when signed out. */
export const getGistIndex = createServerFn({ method: "GET" }).handler(
	async () => {
		const viewer = await getCurrentUserOptional();
		const page = viewer
			? await listGistsForOwner(viewer.id, {
					limit: INDEX_PAGE_SIZE,
					offset: 0,
				})
			: await listPublicGists({ limit: INDEX_PAGE_SIZE, offset: 0 });
		const gists = await Promise.all(
			page.gists.map(async (row) => ({
				id: row.id,
				description: row.description,
				visibility: row.visibility,
				updatedAt: row.updatedAt.toISOString(),
				owner: {
					username: row.owner.username,
					name: row.owner.name,
					image: row.owner.image,
				},
				files: await listGistFilePaths(row.id),
			})),
		);
		return { signedIn: viewer !== null, gists, total: page.total };
	},
);

/**
 * Whether `/{owner}/{name}` names a gist (so the repository lookup's miss
 * becomes GitHub's 301 to the `/gist/…` page) or a repository.
 */
export const gistPathTarget = createServerFn({ method: "GET" })
	.validator(
		readInput(
			z.object({
				owner: z.string(),
				name: z.string().max(MAX_GIST_DESCRIPTION_CHARS),
			}),
		),
	)
	.handler(async ({ data }) => {
		const row = await findGistAtOwnerPath(data.owner, data.name);
		return row ? ("gist" as const) : ("repository" as const);
	});

export const toggleGistStar = createServerFn({ method: "POST" })
	.validator(gistPath)
	.handler(async ({ data }) => {
		const viewer = await getCurrentUser();
		const row = await loadGist(data.owner, data.id);
		const starred = await isGistStarred(row.id, viewer.id);
		if (starred) await removeGistStar(row.id, viewer.id);
		else await addGistStar(row.id, viewer.id);
		const starCount = await countGistStars(row.id);
		return { isStarred: !starred, starCount };
	});

const commentBody = z.string().trim().min(1).max(MAX_GIST_COMMENT_BODY_CHARS);

export const createGistComment = createServerFn({ method: "POST" })
	.validator(gistPath.extend({ body: commentBody }))
	.handler(async ({ data }) => {
		const viewer = await getCurrentUser();
		const row = await loadGist(data.owner, data.id);
		const created = await insertGistComment({
			gistId: row.id,
			userId: viewer.id,
			body: data.body,
		});
		const comment = await findGistComment(row.id, created.id);
		if (!comment) throw new Error("Gist comment missing after insert");
		return commentView(comment, viewer.id);
	});

export const deleteGistComment = createServerFn({ method: "POST" })
	.validator(gistPath.extend({ commentId: z.number().int().positive() }))
	.handler(async ({ data }) => {
		const viewer = await getCurrentUser();
		const row = await loadGist(data.owner, data.id);
		const comment = await findGistComment(row.id, data.commentId);
		if (!comment || comment.userId !== viewer.id) throw notFound();
		await deleteGistCommentRow(comment.id);
		return { deleted: true as const };
	});
