/**
 * Repository lookups shared by server functions, API routes and the git
 * endpoint: plain server-only functions, deliberately kept out of
 * repositories.ts. A server-function file keeps its top-level imports in the
 * client bundle whenever it also exports plain values, which in dev (no tree
 * shaking) loads the database and AsyncLocalStorage in the browser and breaks
 * hydration. Server-function files export only `createServerFn`s; anything
 * else they share lives in a module like this one.
 */
import { notFound } from "@tanstack/react-router";
import { and, eq, sql } from "drizzle-orm";
import { db } from "#/db";
import { type Repository, repositories } from "#/db/app-schema";
import { user } from "#/db/schema";
import { perfContext } from "./perf-log";
import { getAccessForRepository } from "./repo-access";
import { getCurrentUserOptional } from "./session";
import { createTtlCoalescedCache } from "./ttl-cache";

/** The user columns safe to show anyone (never the email). */
export const publicUserColumns = {
	id: user.id,
	username: user.username,
	name: user.name,
	image: user.image,
};
/** The same projection for relational queries' `with: { author: … }`. */
export const publicUserFields = {
	columns: { id: true, username: true, name: true, image: true },
} as const;
export type PublicUser = {
	id: string;
	username: string;
	name: string;
	image: string | null;
};

export type RepositoryRowWithOwner = Repository & { owner: PublicUser };

/**
 * Repository + owner by URL coordinates. Every repo page and both requests of
 * every git operation start here, so it's cached for a few seconds (and
 * coalesced); renames, settings changes and deletes evict it.
 */
const repoByNameCache = createTtlCoalescedCache<RepositoryRowWithOwner | null>({
	ttlMs: 5000,
});

export function findRepositoryByName(
	ownerUsername: string,
	repoName: string,
): Promise<RepositoryRowWithOwner | null> {
	return repoByNameCache.get(`${ownerUsername}/${repoName}`, async () => {
		const [row] = await db
			.select({ repo: repositories, owner: publicUserColumns })
			.from(repositories)
			.innerJoin(user, eq(repositories.ownerId, user.id))
			.where(
				and(eq(user.username, ownerUsername), eq(repositories.name, repoName)),
			)
			.limit(1);
		return row ? { ...row.repo, owner: row.owner } : null;
	});
}

/**
 * A server function body for reads addressed by URL (`/repo/{owner}/{name}/…`):
 * perf context, the repository, read access (404 when missing or unreadable),
 * then `fn`.
 */
export function readRepoByName<T>(
	label: string,
	owner: string,
	name: string,
	fn: (repo: RepositoryRowWithOwner) => Promise<T>,
): Promise<T> {
	return perfContext(label, async () => {
		const [currentUser, repo] = await Promise.all([
			getCurrentUserOptional(),
			findRepositoryByName(owner, name),
		]);
		if (!repo) throw notFound();
		const access = await getAccessForRepository(repo, currentUser?.id);
		if (!access.canRead) throw notFound();
		return fn(repo);
	});
}

export function evictRepoByName(ownerUsername: string, repoName: string): void {
	repoByNameCache.delete(`${ownerUsername}/${repoName}`);
}

/**
 * Claim the next `#N` for an issue or PR (one shared sequence per repo). A
 * single-row UPDATE … RETURNING, so concurrent claims never collide.
 */
export async function claimNextIssueOrPrNumber(
	repoId: number,
): Promise<number> {
	const [row] = await db
		.update(repositories)
		.set({ nextIssueNumber: sql`${repositories.nextIssueNumber} + 1` })
		.where(eq(repositories.id, repoId))
		.returning({ next: repositories.nextIssueNumber });
	if (!row) throw new Error("Repository not found");
	return row.next - 1;
}
