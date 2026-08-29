/**
 * A minimal write-ahead log for git writes, backed by the `git_transactions`
 * table (github-schema.ts) — that table existed already but was never
 * written to anywhere in the app. withRepositoryLock (git-repo-storage.ts)
 * is the single choke point every write path goes through (push, commit,
 * branch ops, merge, rename), so it records one row here per critical
 * section: `pending` right after the lock is acquired, `committed` once the
 * wrapped operation succeeds, `rolled_back` if it throws.
 *
 * This is provenance/diagnostics, not this app's durability mechanism —
 * git objects in R2 (or local disk) remain the actual source of truth, and
 * a WAL write failing here never blocks or fails the real git operation
 * (same "best-effort bookkeeping" pattern as
 * updateRepositoryBackupMetadata in git-repo-storage.ts). Its concrete
 * value: findAbandonedGitTransactions can point at exactly which repo had a
 * write in flight when its holder's function was killed mid-critical-section
 * (Vercel's execution limit) — a `pending` row older than the lock lease
 * itself ever legitimately outlives is unambiguous evidence of that, not a
 * race with an operation that might still be running.
 *
 * `objectKeys` isn't populated at this layer — only syncRepositoryToR2's
 * caller actually knows which R2 keys a given write touched, and threading
 * that back through every withRepositoryLock caller isn't worth it for what
 * this WAL is actually for here (crash detection + provenance, not
 * object-level replay). It's left `[]`, satisfying the column's NOT NULL
 * constraint.
 */

import { and, eq, lt } from "drizzle-orm";
import { db } from "#/db";
import { gitTransactions } from "#/db/github-schema";
import { logError } from "./perf-log";

function generateTransactionId(): string {
	return `txn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function beginGitTransaction(
	ownerKey: string,
	repoName: string,
): Promise<string | null> {
	const id = generateTransactionId();
	try {
		await db.insert(gitTransactions).values({
			id,
			status: "pending",
			objectKeys: [],
			metadata: { ownerKey, repoName },
			// Set explicitly rather than relying on the column's `defaultNow()`:
			// that evaluates Postgres's own `now()` in the session's timezone,
			// which doesn't reliably round-trip back through drizzle as the same
			// instant `new Date()` here does — findAbandonedGitTransactions
			// compares this column against a JS-clock threshold, so both sides
			// need to come from the same clock to be meaningfully comparable.
			createdAt: new Date(),
		});
		return id;
	} catch (err) {
		logError(
			"git-transactions",
			`Failed to record pending WAL entry for ${ownerKey}/${repoName} (write proceeds regardless)`,
			err,
		);
		return null;
	}
}

export async function commitGitTransaction(id: string): Promise<void> {
	try {
		await db
			.update(gitTransactions)
			.set({ status: "committed", completedAt: new Date() })
			.where(eq(gitTransactions.id, id));
	} catch (err) {
		logError(
			"git-transactions",
			`Failed to mark WAL entry ${id} committed`,
			err,
		);
	}
}

export async function rollbackGitTransaction(id: string): Promise<void> {
	try {
		await db
			.update(gitTransactions)
			.set({ status: "rolled_back", completedAt: new Date() })
			.where(eq(gitTransactions.id, id));
	} catch (err) {
		logError(
			"git-transactions",
			`Failed to mark WAL entry ${id} rolled back`,
			err,
		);
	}
}

export type AbandonedGitTransaction = {
	id: string;
	metadata: unknown;
	createdAt: Date;
};

// A `pending` row older than a write's lock could ever legitimately still be
// holding (LOCK_LEASE_MS in git-repo-storage.ts, plus slack for the update
// itself) means that write's holder is gone — the lease self-expired and
// released the repo already, but nothing ever came back to close out this
// WAL entry. Not wired into a scheduled job (no cron infra exists in this
// app yet) — call this from a maintenance script or admin page as needed.
export async function findAbandonedGitTransactions(
	olderThanMs = 5 * 60_000,
): Promise<AbandonedGitTransaction[]> {
	return db
		.select({
			id: gitTransactions.id,
			metadata: gitTransactions.metadata,
			createdAt: gitTransactions.createdAt,
		})
		.from(gitTransactions)
		.where(
			and(
				eq(gitTransactions.status, "pending"),
				lt(gitTransactions.createdAt, new Date(Date.now() - olderThanMs)),
			),
		);
}
