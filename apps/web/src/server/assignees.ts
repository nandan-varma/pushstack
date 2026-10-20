/** Server functions for issue assignees. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { issues, repositories, threadAssignees } from "#/db/app-schema";
import { user } from "#/db/schema";
import { MAX_ASSIGNEES } from "#/lib/limits";
import { listAssignableUsers, replaceThreadAssignees } from "./assignees-store";
import { perfContext } from "./perf-log";
import {
	readableRepositoriesCondition,
	readWithAccess,
	requireWriteAccess,
} from "./repo-access";
import { getCurrentUser } from "./session";
import { findIssueById, findPullRequestById } from "./thread-store";

/** Who can be assigned in a repository: its owner and write/admin collaborators. */
export const getAssignableUsers = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(({ data }) =>
		readWithAccess("getAssignableUsers", data.repoId, () =>
			listAssignableUsers(data.repoId),
		),
	);

/** Set an issue's assignees (needs write access, as on GitHub). */
export const setIssueAssignees = createServerFn({ method: "POST" })
	.validator(
		z.object({
			issueId: z.number(),
			usernames: z.array(z.string().max(100)).max(MAX_ASSIGNEES * 4),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const issue = await findIssueById(data.issueId);
		if (!issue) throw notFound();
		await requireWriteAccess(issue.repoId, currentUser.id);
		return replaceThreadAssignees(issue, data.usernames, currentUser.id);
	});

/** Set a pull request's assignees with the same triage permissions as issues. */
export const setPullRequestAssignees = createServerFn({ method: "POST" })
	.validator(
		z.object({
			pullRequestId: z.number(),
			usernames: z.array(z.string().max(100)).max(MAX_ASSIGNEES * 4),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const pr = await findPullRequestById(data.pullRequestId);
		if (!pr) throw notFound();
		await requireWriteAccess(pr.repoId, currentUser.id);
		return replaceThreadAssignees(pr, data.usernames, currentUser.id);
	});

/** The viewer's latest 20 open assigned threads across readable repositories. */
export const getAssignedThreads = createServerFn({ method: "GET" }).handler(
	() =>
		perfContext("getAssignedThreads", async () => {
			const viewer = await getCurrentUser();
			const readable = readableRepositoriesCondition(viewer.id);
			return db
				.select({
					kind: sql<
						"issue" | "pull_request"
					>`case when ${issues.isPullRequest} then 'pull_request' else 'issue' end`,
					number: issues.number,
					title: issues.title,
					updatedAt: issues.updatedAt,
					owner: user.username,
					name: repositories.name,
				})
				.from(issues)
				.innerJoin(
					threadAssignees,
					and(
						eq(threadAssignees.issueId, issues.id),
						eq(threadAssignees.userId, viewer.id),
					),
				)
				.innerJoin(repositories, eq(repositories.id, issues.repoId))
				.innerJoin(user, eq(user.id, repositories.ownerId))
				.where(and(eq(issues.status, "open"), readable))
				.orderBy(
					desc(issues.updatedAt),
					asc(user.username),
					asc(repositories.name),
					asc(issues.number),
				)
				.limit(20);
		}),
);
