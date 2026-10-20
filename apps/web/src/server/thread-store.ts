/**
 * Issue/PR thread lookups. Issues and pull requests share one `#N` sequence
 * per repository, so a thread is addressed by its number whichever kind it is
 * (the REST API's `/issues/{number}` looks both up). Plain server-only module
 * (see repository-lookup.ts for why this is not a server-function file).
 */
import { db } from "#/db";

export type ThreadKind = "issue" | "pull_request";

/** The issue or pull request a `#N` names. */
export interface ThreadRef {
	kind: ThreadKind;
	/** The row id (`issues.id` or `pull_requests.id`). */
	id: number;
	repoId: number;
	number: number;
	title: string;
	body: string | null;
}

const threadColumns = {
	id: true,
	repoId: true,
	number: true,
	title: true,
	body: true,
} as const;

/** The thread whose row id is `issueId` or `pullRequestId`, or null. */
export async function findThreadById(
	id: { issueId: number } | { pullRequestId: number },
): Promise<ThreadRef | null> {
	if ("issueId" in id) {
		const row = await db.query.issues.findFirst({
			columns: threadColumns,
			where: { id: id.issueId },
		});
		return row ? { kind: "issue", ...row } : null;
	}
	const row = await db.query.pullRequests.findFirst({
		columns: threadColumns,
		where: { id: id.pullRequestId },
	});
	return row ? { kind: "pull_request", ...row } : null;
}

/** The thread numbered `number` in `repoId`, or null. */
export async function findThreadByNumber(
	repoId: number,
	number: number,
): Promise<ThreadRef | null> {
	const issue = await db.query.issues.findFirst({
		columns: threadColumns,
		where: { repoId, number },
	});
	if (issue) return { kind: "issue", ...issue };
	const pullRequest = await db.query.pullRequests.findFirst({
		columns: threadColumns,
		where: { repoId, number },
	});
	return pullRequest ? { kind: "pull_request", ...pullRequest } : null;
}
