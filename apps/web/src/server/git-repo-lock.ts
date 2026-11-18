/**
 * Named leases in Postgres (`repo_locks`), since serverless instances share no
 * memory. Every git write — push, repack, commit, branch/HEAD change, merge,
 * create, rename, delete — runs under the `ownerKey/repoName` lease; a
 * per-repository capacity check takes its own `caps/<repoId>/lock` lease (see
 * `repository-capacity.ts`), which no git operation holds. Not reentrant: a
 * locked function must never take the same lease again (it would wait out the
 * acquire timeout and throw).
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
async function acquireLock(lockKey: string): Promise<string> {
	const holder = crypto.randomUUID();
	const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
	for (;;) {
		const now = new Date();
		const expiresAt = new Date(now.getTime() + LOCK_LEASE_MS);
		const rows = await db
			.insert(repoLocks)
			.values({ repoKey: lockKey, holder, expiresAt })
			.onConflictDoUpdate({
				target: repoLocks.repoKey,
				set: { holder, expiresAt },
				setWhere: lt(repoLocks.expiresAt, now),
			})
			.returning({ holder: repoLocks.holder });
		if (rows.length > 0) return holder;
		if (Date.now() >= deadline) {
			throw new Error(
				`Timed out waiting for the lock ${lockKey} (held by another writer)`,
			);
		}
		await new Promise((resolve) =>
			setTimeout(resolve, LOCK_POLL_BASE_MS * (1 + Math.random())),
		);
	}
}

const heldBy = (lockKey: string, holder: string) =>
	and(eq(repoLocks.repoKey, lockKey), eq(repoLocks.holder, holder));

/** Extend our lease; false when it lapsed and another writer took over. */
async function renewLock(lockKey: string, holder: string): Promise<boolean> {
	const rows = await db
		.update(repoLocks)
		.set({ expiresAt: new Date(Date.now() + LOCK_LEASE_MS) })
		.where(heldBy(lockKey, holder))
		.returning({ holder: repoLocks.holder });
	return rows.length > 0;
}

/**
 * Run `fn` holding the lease named `lockKey`; waiters poll until the holder's
 * lease lapses. Callers use `withRepositoryLock` (git writes) or the capacity
 * lock in `repository-capacity.ts`, each with its own key namespace.
 */
export async function withLockKey<T>(
	lockKey: string,
	fn: () => Promise<T>,
): Promise<T> {
	const holder = await acquireLock(lockKey);
	const heartbeat = setInterval(() => {
		renewLock(lockKey, holder).then(
			(held) => {
				if (!held) {
					logError(
						"git-repo-lock",
						`Lost the lock ${lockKey} mid-operation`,
						new Error("repo lock lease lost"),
					);
				}
			},
			(err: unknown) =>
				logError("git-repo-lock", `Failed to renew lock ${lockKey}`, err),
		);
	}, LOCK_RENEW_MS);
	try {
		return await fn();
	} finally {
		clearInterval(heartbeat);
		// Holder-scoped: never deletes a lease someone else took over.
		await db
			.delete(repoLocks)
			.where(heldBy(lockKey, holder))
			.catch((err: unknown) =>
				logError(
					"git-repo-lock",
					`Failed to release lock ${lockKey} (its lease will lapse)`,
					err,
				),
			);
	}
}

/** The git write lock for one repository. */
export function withRepositoryLock<T>(
	ownerKey: string,
	repoName: string,
	fn: () => Promise<T>,
): Promise<T> {
	return withLockKey(`${ownerKey}/${repoName}`, fn);
}

/**
 * The git write lock for one gist: its key is the gist's storage prefix, and
 * `gists` is a reserved username so no repository can share it.
 */
export function withGistLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
	return withLockKey(`gists/${id}`, fn);
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
