/**
 * Per-repository write lock: a Postgres lease row (`repo_locks`), since
 * serverless instances share no memory. Every write — push, repack, commit,
 * branch/HEAD change, merge, create, rename, delete — runs under it. Not
 * reentrant: a locked function must never take the lock for the same repo
 * again (it would wait out the acquire timeout and throw).
 */
import { and, eq, lt } from "drizzle-orm";
import { db } from "#/db";
import { repoLocks } from "#/db/app-schema";
import { logError } from "./perf-log";

/** A live holder renews every LOCK_RENEW_MS; a killed one's lease lapses. */
const LOCK_LEASE_MS = 60_000;
const LOCK_RENEW_MS = 20_000;
const LOCK_POLL_BASE_MS = 200;
// Just over one lease, so a waiter always outlasts a lease minted right
// before it started waiting.
const LOCK_ACQUIRE_TIMEOUT_MS = 65_000;

/**
 * One atomic statement: insert our lease, or take over the row only when its
 * lease has expired (`ON CONFLICT ... WHERE expires_at < now()` returns no
 * row while someone else holds it). Works over Neon's stateless HTTP driver,
 * which can't hold advisory locks or open transactions.
 */
async function acquireRepoLock(repoKey: string): Promise<string> {
	const holder = crypto.randomUUID();
	const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
	for (;;) {
		const now = new Date();
		const expiresAt = new Date(now.getTime() + LOCK_LEASE_MS);
		const rows = await db
			.insert(repoLocks)
			.values({ repoKey, holder, expiresAt })
			.onConflictDoUpdate({
				target: repoLocks.repoKey,
				set: { holder, expiresAt },
				setWhere: lt(repoLocks.expiresAt, now),
			})
			.returning({ holder: repoLocks.holder });
		if (rows.length > 0) return holder;
		if (Date.now() >= deadline) {
			throw new Error(
				`Timed out waiting for repository lock on ${repoKey} (held by another writer)`,
			);
		}
		await new Promise((resolve) =>
			setTimeout(resolve, LOCK_POLL_BASE_MS * (1 + Math.random())),
		);
	}
}

const heldBy = (repoKey: string, holder: string) =>
	and(eq(repoLocks.repoKey, repoKey), eq(repoLocks.holder, holder));

/** Extend our lease; false when it lapsed and another writer took over. */
async function renewRepoLock(
	repoKey: string,
	holder: string,
): Promise<boolean> {
	const rows = await db
		.update(repoLocks)
		.set({ expiresAt: new Date(Date.now() + LOCK_LEASE_MS) })
		.where(heldBy(repoKey, holder))
		.returning({ holder: repoLocks.holder });
	return rows.length > 0;
}

export async function withRepositoryLock<T>(
	ownerKey: string,
	repoName: string,
	fn: () => Promise<T>,
): Promise<T> {
	const repoKey = `${ownerKey}/${repoName}`;
	const holder = await acquireRepoLock(repoKey);
	const heartbeat = setInterval(() => {
		renewRepoLock(repoKey, holder).then(
			(held) => {
				if (!held) {
					logError(
						"git-repo-lock",
						`Lost the repo lock for ${repoKey} mid-operation`,
						new Error("repo lock lease lost"),
					);
				}
			},
			(err: unknown) =>
				logError(
					"git-repo-lock",
					`Failed to renew repo lock for ${repoKey}`,
					err,
				),
		);
	}, LOCK_RENEW_MS);
	try {
		return await fn();
	} finally {
		clearInterval(heartbeat);
		// Holder-scoped: never deletes a lease someone else took over.
		await db
			.delete(repoLocks)
			.where(heldBy(repoKey, holder))
			.catch((err: unknown) =>
				logError(
					"git-repo-lock",
					`Failed to release repo lock for ${repoKey} (its lease will lapse)`,
					err,
				),
			);
	}
}

/**
 * Several repositories' locks at once, taken in one global order (by
 * `ownerKey/repoName`), each distinct repository once. Two callers that need
 * the same pair in opposite roles would otherwise hold one lock each and wait
 * for the other until the acquire timeout. A repository named twice (a
 * repository forked into its own name) is locked once, since the lock is not
 * reentrant.
 */
export function withRepositoryLocks<T>(
	repos: ReadonlyArray<{ ownerKey: string; repoName: string }>,
	fn: () => Promise<T>,
): Promise<T> {
	const byKey = new Map<string, { ownerKey: string; repoName: string }>();
	for (const repo of repos) {
		byKey.set(`${repo.ownerKey}/${repo.repoName}`, repo);
	}
	const ordered = [...byKey.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([, repo]) => repo);
	const run = (index: number): Promise<T> =>
		index === ordered.length
			? fn()
			: withRepositoryLock(
					ordered[index].ownerKey,
					ordered[index].repoName,
					() => run(index + 1),
				);
	return run(0);
}
