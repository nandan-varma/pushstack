/** Server functions for issue assignees. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "#/db";
import { MAX_ASSIGNEES } from "#/lib/limits";
import { listAssignableUsers, replaceIssueAssignees } from "./assignees-store";
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
		return replaceIssueAssignees(issue, data.usernames, currentUser.id);
	});
