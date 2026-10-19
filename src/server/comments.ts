/** Server functions for comments on issues and pull requests. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { comments, issues, pullRequests } from "#/db/app-schema";
import { MAX_BODY_CHARS } from "#/lib/limits";
import { recordActivity } from "./activity";
import {
	getAccessForRepository,
	requireParticipateAccess,
} from "./repo-access";
import { publicUserFields } from "./repository-lookup";
import { getCurrentUser, getCurrentUserOptional } from "./session";
import { recordCrossReferences } from "./timeline-store";

/** Exactly one of an issue id or a pull request id (row ids, not `#N`). */
const threadSchema = z.union([
	z.object({ issueId: z.number(), pullRequestId: z.undefined().optional() }),
	z.object({ pullRequestId: z.number(), issueId: z.undefined().optional() }),
]);
type Thread = z.infer<typeof threadSchema>;

/** The thread's repository and `#N`; 404 when it doesn't exist. */
async function findThread(thread: Thread) {
	const row =
		thread.issueId !== undefined
			? await db.query.issues.findFirst({
					columns: { number: true, title: true },
					where: eq(issues.id, thread.issueId),
					with: { repository: true },
				})
			: await db.query.pullRequests.findFirst({
					columns: { number: true, title: true },
					where: eq(pullRequests.id, thread.pullRequestId),
					with: { repository: true },
				});
	if (!row) throw notFound();
	return row;
}

export const createComment = createServerFn({ method: "POST" })
	.validator(
		z
			.object({ body: z.string().trim().min(1).max(MAX_BODY_CHARS) })
			.and(threadSchema),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const { repository, number, title } = await findThread(data);
		await requireParticipateAccess(repository.id, currentUser.id);
		const [comment] = await db
			.insert(comments)
			.values({
				repoId: repository.id,
				issueId: data.issueId ?? null,
				pullRequestId: data.pullRequestId ?? null,
				authorId: currentUser.id,
				body: data.body,
			})
			.returning();
		await recordCrossReferences(
			repository.id,
			{
				kind: data.issueId !== undefined ? "issue" : "pull_request",
				number,
				title,
			},
			data.body,
			currentUser.id,
		);
		await recordActivity(currentUser.id, repository.id, {
			type: "comment",
			metadata: { on: data.issueId !== undefined ? "issue" : "pr", number },
		});
		return comment;
	});

export const getComments = createServerFn({ method: "GET" })
	.validator(threadSchema)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();
		const { repository } = await findThread(data);
		if (!(await getAccessForRepository(repository, currentUser?.id)).canRead) {
			throw notFound();
		}
		return db.query.comments.findMany({
			where:
				data.issueId !== undefined
					? eq(comments.issueId, data.issueId)
					: eq(comments.pullRequestId, data.pullRequestId),
			with: { author: publicUserFields },
			orderBy: [comments.createdAt],
		});
	});
