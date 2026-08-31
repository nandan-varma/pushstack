/**
 * Per-repo distributed lock — backed by a Postgres lease row (`repo_locks`),
 * not an in-process mutex, since Vercel serverless instances share no memory
 * across invocations. Extracted out of git-repo-storage.ts: this is the one
 * piece of that file with no shared state (repoState/r2ListCache) with the
 * hydrate/sync/worktree logic that lives there.
 */
import { and, eq, lt } from "drizzle-orm";
import { db } from "#/db";
import { repoLocks } from "#/db/app-schema";
import { isR2Configured } from "#/lib/r2";
import {
	beginGitTransaction,
	commitGitTransaction,
	rollbackGitTransaction,
} from "./git-transactions";
import { logError } from "./perf-log";

export function getRepoKey(ownerKey: string, repoName: string): string {
	return `${ownerKey}/${repoName}`;
}

// Lease TTL, not a heartbeat-renewed lock — see repoLocks's comment in
// app-schema.ts. Must comfortably exceed how long a real push/hydrate/
// sync critical section can run; Vercel kills the function well before this
// anyway, so a stuck holder's lease always clears on its own.
const LOCK_LEASE_MS = 60_000;
const LOCK_POLL_BASE_MS = 200;
// Slightly over the lease so a caller that starts waiting right after
// another holder's lease was minted is guaranteed to see it expire within
// one wait window, instead of timing out one poll interval early.
const LOCK_ACQUIRE_TIMEOUT_MS = 65_000;

function randomLockHolderId(): string {
	return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Atomic single-round-trip acquire: `INSERT ... ON CONFLICT DO UPDATE ...
// WHERE expires_at < now()`. Postgres only applies the conflict UPDATE (and
// only then does RETURNING yield a row) when the WHERE holds, i.e. the
// existing lease has expired — a live lease held by someone else leaves the
// row untouched and this query returns zero rows. Works over Neon's
// stateless HTTP driver since it's one statement, no session/transaction
// needed, unlike a `pg_advisory_lock` or a held `SELECT ... FOR UPDATE`.
async function acquireRepoLock(repoKey: string): Promise<string> {
	const holder = randomLockHolderId();
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

		if (rows.length > 0) {
			return holder;
		}

		if (Date.now() >= deadline) {
			throw new Error(
				`Timed out waiting for repository lock on ${repoKey} (held by another writer)`,
			);
		}

		await new Promise((resolve) =>
			setTimeout(
				resolve,
				LOCK_POLL_BASE_MS + Math.random() * LOCK_POLL_BASE_MS,
			),
		);
	}
}

// Only deletes the row if we're still its holder — a release racing past our
// own lease's expiry must not delete whatever the *next* holder just wrote.
async function releaseRepoLock(repoKey: string, holder: string): Promise<void> {
	await db
		.delete(repoLocks)
		.where(and(eq(repoLocks.repoKey, repoKey), eq(repoLocks.holder, holder)));
}

export async function withRepositoryLock<T>(
	ownerKey: string,
	repoName: string,
	fn: () => Promise<T>,
): Promise<T> {
	const repoKey = getRepoKey(ownerKey, repoName);
	const holder = await acquireRepoLock(repoKey);
	// Best-effort WAL entry — see git-transactions.ts. A logging failure here
	// (txnId null) never blocks the actual write; only its own bookkeeping is
	// skipped.
	const txnId = await beginGitTransaction(ownerKey, repoName);

	try {
		const result = await fn();
		if (txnId) await commitGitTransaction(txnId);
		return result;
	} catch (err) {
		if (txnId) await rollbackGitTransaction(txnId);
		throw err;
	} finally {
		await releaseRepoLock(repoKey, holder).catch((err: unknown) => {
			logError(
				"git-repo-lock",
				`Failed to release repo lock for ${repoKey} (will self-expire via lease TTL)`,
				err,
			);
		});
	}
}

// Some writes (git-branch-ops.ts's createBranch/deleteBranch) go straight to
// R2 when configured, but fall back to getRepoOptions/syncRepositoryToR2 —
// which already take this same lock internally — on local disk. Since
// withRepositoryLock isn't reentrant, only the R2-direct path may take it
// here; call this instead of a hand-rolled `if (isR2Configured())` at each
// write call site, so that rule lives in one place instead of being
// re-derived (and re-risked) per call site.
export async function withRepositoryLockIfR2<T>(
	ownerKey: string,
	repoName: string,
	fn: () => Promise<T>,
): Promise<T> {
	return isR2Configured() ? withRepositoryLock(ownerKey, repoName, fn) : fn();
}
