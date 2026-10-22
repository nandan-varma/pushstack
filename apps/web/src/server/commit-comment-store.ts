/**
 * Commit comments (GitHub's `…/comments` and `…/commits/{sha}/comments`),
 * shared by the REST API and the commit page's server functions. Plain
 * server-only module: permission checks return booleans and each caller turns
 * them into its own error.
 */
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import { commitComments } from "#/db/app-schema";
import { canWriteRepo, getRepositoryAccess } from "./repo-access";
import { publicUserFields } from "./repository-lookup";

export type CommitComment = typeof commitComments.$inferSelect;

export interface CommitCommentAnchor {
	path?: string | null;
	position?: number | null;
	line?: number | null;
}

export function findCommitComment(repoId: number, commentId: number) {
	return db.query.commitComments.findFirst({
		where: { id: commentId, repoId },
		with: { author: publicUserFields },
	});
}

/** One page of comments, oldest first: a commit's, or the repository's. */
export function listCommitComments(
	repoId: number,
	commitSha: string | undefined,
	options?: { limit?: number; offset?: number },
) {
	return db.query.commitComments.findMany({
		where:
			commitSha === undefined ? { repoId } : { repoId, commitSha: commitSha },
		with: { author: publicUserFields },
		orderBy: (table) => [table.createdAt, table.id],
		...(options?.limit !== undefined && { limit: options.limit }),
		...(options?.offset !== undefined && { offset: options.offset }),
	});
}

export async function countCommitComments(
	repoId: number,
	commitSha?: string,
): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(commitComments)
		.where(
			commitSha === undefined
				? eq(commitComments.repoId, repoId)
				: and(
						eq(commitComments.repoId, repoId),
						eq(commitComments.commitSha, commitSha),
					),
		);
	return row?.total ?? 0;
}

/** `comment_count` for each of `shas` (absent = 0), in one query. */
export async function commitCommentCounts(
	repoId: number,
	shas: string[],
): Promise<Map<string, number>> {
	const unique = [...new Set(shas)];
	if (unique.length === 0) return new Map();
	const rows = await db
		.select({ sha: commitComments.commitSha, total: count() })
		.from(commitComments)
		.where(
			and(
				eq(commitComments.repoId, repoId),
				inArray(commitComments.commitSha, unique),
			),
		)
		.groupBy(commitComments.commitSha);
	return new Map(rows.map((row) => [row.sha, row.total]));
}

export async function createCommitComment(input: {
	repoId: number;
	commitSha: string;
	authorId: string;
	body: string;
	anchor?: CommitCommentAnchor;
}): Promise<CommitComment> {
	const [row] = await db
		.insert(commitComments)
		.values({
			repoId: input.repoId,
			commitSha: input.commitSha,
			authorId: input.authorId,
			body: input.body,
			path: input.anchor?.path ?? null,
			position: input.anchor?.position ?? null,
			line: input.anchor?.line ?? null,
		})
		.returning();
	if (!row) throw new Error("Commit comment insert returned no row");
	return row;
}

/**
 * GitHub's rule: the author (while they can still participate) or a write
 * collaborator moderating.
 */
export async function canEditCommitComment(
	comment: CommitComment,
	userId: string,
): Promise<boolean> {
	if (comment.authorId === userId) {
		return (
			(await getRepositoryAccess(comment.repoId, userId))?.canParticipate ??
			false
		);
	}
	return canWriteRepo(comment.repoId, userId);
}

export async function updateCommitCommentBody(
	comment: CommitComment,
	body: string,
): Promise<CommitComment> {
	if (body === comment.body) return comment;
	const now = new Date();
	const [row] = await db
		.update(commitComments)
		.set({ body, editedAt: now, updatedAt: now })
		.where(eq(commitComments.id, comment.id))
		.returning();
	if (!row) throw new Error("Commit comment update returned no row");
	return row;
}

export async function deleteCommitComment(comment: CommitComment) {
	await db.delete(commitComments).where(eq(commitComments.id, comment.id));
}
