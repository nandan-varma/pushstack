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
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "#/db";
import { organizations, type Repository, repositories } from "#/db/app-schema";
import { user } from "#/db/schema";
import { perfContext } from "./perf-log";
import { evictRepositoryById, getAccessForRepository } from "./repo-access";
import {
	publicUserColumns,
	type RepositoryOwner,
	repositoryOwnerOf,
} from "./repository-owner";
import { getCurrentUserOptional } from "./session";
import { createTtlCoalescedCache } from "./ttl-cache";

export type {
	PublicUser,
	RepositoryOwner,
} from "./repository-owner";
export {
	publicUserColumns,
	publicUserFields,
	repoOwnerColumns,
	repositoryOwnerOf,
} from "./repository-owner";

const ownerJoin = {
	owner: publicUserColumns,
	organization: {
		id: organizations.id,
		login: organizations.login,
		name: organizations.name,
	},
};

export type RepositoryRowWithOwner = Repository & {
	owner: RepositoryOwner;
};

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
			.select({ repo: repositories, ...ownerJoin })
			.from(repositories)
			.leftJoin(user, eq(repositories.ownerId, user.id))
			.leftJoin(
				organizations,
				eq(repositories.organizationId, organizations.id),
			)
			.where(
				and(
					or(
						eq(user.username, ownerUsername),
						eq(organizations.login, ownerUsername),
					),
					eq(repositories.name, repoName),
				),
			)
			.limit(1);
		return row ? { ...row.repo, owner: repositoryOwnerOf(row) } : null;
	});
}

export function findRepositoryById(
	repoId: number,
): Promise<RepositoryRowWithOwner | null> {
	return db
		.select({ repo: repositories, ...ownerJoin })
		.from(repositories)
		.leftJoin(user, eq(repositories.ownerId, user.id))
		.leftJoin(organizations, eq(repositories.organizationId, organizations.id))
		.where(eq(repositories.id, repoId))
		.limit(1)
		.then(([row]) =>
			row ? { ...row.repo, owner: repositoryOwnerOf(row) } : null,
		);
}

/**
 * A server function body for reads addressed by URL (`/{owner}/{name}/…`):
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

/** Drop a repository's cached rows (by name and by id) after it changes. */
export function evictRepoByName(
	ownerUsername: string,
	repoName: string,
	repoId: number,
): void {
	repoByNameCache.delete(`${ownerUsername}/${repoName}`);
	evictRepositoryById(repoId);
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
