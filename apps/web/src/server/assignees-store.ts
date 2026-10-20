/**
 * Thread assignees, GitHub's rules: only users with write access to the
 * repository can be assigned (the owner and write/admin collaborators), at most
 * {@link MAX_ASSIGNEES} per thread, and ineligible usernames are ignored. Plain
 * server-only helpers behind the server functions in `assignees.ts`.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import { repositoryCollaborators, threadAssignees } from "#/db/app-schema";
import { MAX_ASSIGNEES } from "#/lib/limits";
import { withRepositoryLock } from "./git-repo-lock";
import { type PublicUser, publicUserFields } from "./repository-lookup";
import { recordTimelineEvent } from "./timeline-store";

/** Users who can be assigned to a thread in the repository. */
export async function listAssignableUsers(
	repoId: number,
): Promise<PublicUser[]> {
	const repo = await db.query.repositories.findFirst({
		columns: { ownerId: true },
		where: { id: repoId },
	});
	if (!repo) return [];
	const collaborators = await db
		.select({ userId: repositoryCollaborators.userId })
		.from(repositoryCollaborators)
		.where(
			and(
				eq(repositoryCollaborators.repoId, repoId),
				inArray(repositoryCollaborators.role, ["write", "admin"]),
			),
		);
	const ids = [repo.ownerId, ...collaborators.map((c) => c.userId)];
	const users = await db.query.user.findMany({
		...publicUserFields,
		where: { id: { in: ids } },
	});
	return users.sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * Make `usernames` the thread's assignees: ineligible ones are dropped, the
 * rest beyond the cap are refused, and each addition or removal is recorded as
 * an `assigned`/`unassigned` timeline event by `actorId`.
 */
export async function replaceThreadAssignees(
	issue: { id: number; repoId: number },
	usernames: string[],
	actorId: string,
): Promise<PublicUser[]> {
	// Serialize replacements so concurrent assignments cannot combine beyond the cap
	// or record duplicate events. The @ namespace cannot be a repository owner,
	// so this lease is independent of git writes and other threads.
	return withRepositoryLock(
		"@thread-assignees",
		`issue-${issue.id}`,
		async () => {
			const assignable = await listAssignableUsers(issue.repoId);
			const wanted = assignable.filter((u) => usernames.includes(u.username));
			if (wanted.length > MAX_ASSIGNEES) {
				throw new Error(`A thread can have at most ${MAX_ASSIGNEES} assignees`);
			}
			const current = await db.query.threadAssignees.findMany({
				where: { issueId: issue.id },
				with: { user: publicUserFields },
			});
			const currentIds = new Set(current.map((a) => a.userId));
			const wantedIds = new Set(wanted.map((u) => u.id));
			const added = wanted.filter((u) => !currentIds.has(u.id));
			const removed = current.filter((a) => !wantedIds.has(a.userId));

			if (added.length > 0) {
				await db
					.insert(threadAssignees)
					.values(added.map((u) => ({ issueId: issue.id, userId: u.id })))
					.onConflictDoNothing();
			}
			if (removed.length > 0) {
				await db.delete(threadAssignees).where(
					and(
						eq(threadAssignees.issueId, issue.id),
						inArray(
							threadAssignees.userId,
							removed.map((a) => a.userId),
						),
					),
				);
			}
			for (const u of added) {
				await recordTimelineEvent(issue.id, actorId, {
					event: "assigned",
					assignee: { username: u.username, name: u.name },
				});
			}
			for (const a of removed) {
				await recordTimelineEvent(issue.id, actorId, {
					event: "unassigned",
					assignee: { username: a.user.username, name: a.user.name },
				});
			}
			return wanted;
		},
	);
}
