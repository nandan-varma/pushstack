/**
 * Per-repository write lock: one RepositoryLock Durable Object per repository
 * (src/server/repository-lock/), so every Worker isolate, in any location,
 * queues behind the same holder. Every write — push, repack, commit,
 * branch/HEAD change, merge, create, rename, delete — runs under it. Not
 * reentrant: a locked function must never take the lock for the same repo
 * again (it would wait out the acquire timeout and throw).
 */
import { env } from "./env";
import { logError } from "./perf-log";
import {
	LOCK_ACQUIRE_TIMEOUT_MS,
	LOCK_RENEW_MS,
} from "./repository-lock/settings";

export async function withRepositoryLock<T>(
	ownerKey: string,
	repoName: string,
	fn: () => Promise<T>,
): Promise<T> {
	const repoKey = `${ownerKey}/${repoName}`;
	const lock = env.REPO_LOCK.get(env.REPO_LOCK.idFromName(repoKey));
	const token = await lock.acquire(LOCK_ACQUIRE_TIMEOUT_MS);
	// The lease lapses unless renewed, so a crashed writer cannot wedge the repo.
	const heartbeat = setInterval(() => {
		lock.renew(token).then(
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
		await lock
			.release(token)
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
