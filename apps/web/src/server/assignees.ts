/** Server functions for issue assignees. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, exists, or, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "#/db";
import {
	issues,
	pullRequests,
	repositories,
	repositoryCollaborators,
	threadAssignees,
} from "#/db/app-schema";
import { user } from "#/db/schema";
import { MAX_ASSIGNEES } from "#/lib/limits";
import { listAssignableUsers, replaceThreadAssignees } from "./assignees-store";
import { perfContext } from "./perf-log";
import { readWithAccess, requireWriteAccess } from "./repo-access";
import { getCurrentUser } from "./session";

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
		const issue = await db.query.issues.findFirst({
			where: { id: data.issueId },
		});
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
		const pr = await db.query.pullRequests.findFirst({
			where: { id: data.pullRequestId },
		});
		if (!pr) throw notFound();
		await requireWriteAccess(pr.repoId, currentUser.id);
		return replaceThreadAssignees(pr, data.usernames, currentUser.id);
	});

/** The viewer's latest 20 open assigned threads across readable repositories. */
export const getAssignedThreads = createServerFn({ method: "GET" }).handler(
	() =>
		perfContext("getAssignedThreads", async () => {
			const viewer = await getCurrentUser();
			const readable = or(
				eq(repositories.visibility, "public"),
				eq(repositories.ownerId, viewer.id),
				exists(
					db
						.select({ one: sql`1` })
						.from(repositoryCollaborators)
						.where(
							and(
								eq(repositoryCollaborators.repoId, repositories.id),
								eq(repositoryCollaborators.userId, viewer.id),
							),
						),
				),
			);
			const selectThreads = (
				table: typeof issues | typeof pullRequests,
				kind: "issue" | "pull_request",
			) =>
				db
					.select({
						kind: sql<"issue" | "pull_request">`${kind}`.as("kind"),
						number: table.number,
						title: table.title,
						updatedAt: table.updatedAt,
						owner: user.username,
						name: repositories.name,
					})
					.from(table)
					.innerJoin(
						threadAssignees,
						and(
							eq(threadAssignees.repoId, table.repoId),
							eq(threadAssignees.number, table.number),
							eq(threadAssignees.userId, viewer.id),
						),
					)
					.innerJoin(repositories, eq(repositories.id, table.repoId))
					.innerJoin(user, eq(user.id, repositories.ownerId))
					.where(and(eq(table.status, "open"), readable));
			return unionAll(
				selectThreads(issues, "issue"),
				selectThreads(pullRequests, "pull_request"),
			)
				.orderBy(
					desc(sql`"updated_at"`),
					sql`"username"`,
					sql`"name"`,
					sql`"number"`,
				)
				.limit(20);
		}),
);
