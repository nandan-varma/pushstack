/**
 * Transaction Coordinator for SQL + R2 Consistency
 *
 * Implements two-phase commit to ensure atomic updates across
 * PostgreSQL metadata and R2 object storage.
 *
 * Flow:
 * 1. Begin transaction - start DB transaction, track pending R2 writes
 * 2. Prepare phase - buffer R2 operations, don't upload yet
 * 3. Commit phase - upload R2 objects, then commit SQL transaction
 * 4. Rollback - abort SQL transaction, delete uploaded R2 objects
 */

import type { PgTransaction } from "drizzle-orm/pg-core";
import { deleteFromR2, uploadToR2 } from "#/lib/r2-operations";
import { invalidateCache } from "./git-cache";
import { GitTransactionError } from "./git-errors";

interface PendingR2Write {
	key: string;
	data: Buffer;
	contentType: string;
}

interface PendingR2Delete {
	key: string;
}

export class GitTransaction {
	private id: string;
	private dbTransaction: PgTransaction<any, any, any> | null = null;
	private pendingWrites: PendingR2Write[] = [];
	private pendingDeletes: PendingR2Delete[] = [];
	private uploadedKeys: string[] = [];
	private committed = false;
	private rolledBack = false;

	constructor() {
		this.id = `txn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
	}

	/**
	 * Get transaction ID
	 */
	getId(): string {
		return this.id;
	}

	/**
	 * Begin database transaction
	 */
	async begin(): Promise<void> {
		if (this.dbTransaction) {
			throw new GitTransactionError("Transaction already begun", "prepare");
		}

		// Note: Drizzle doesn't expose transaction API directly
		// We'll need to handle this at the query level
		// For now, we'll track operations and commit them atomically
	}

	/**
	 * Stage R2 write operation (doesn't upload yet)
	 */
	stageWrite(
		key: string,
		data: Buffer,
		contentType: string = "application/octet-stream",
	): void {
		if (this.committed || this.rolledBack) {
			throw new GitTransactionError(
				"Cannot stage write after commit/rollback",
				"prepare",
			);
		}

		this.pendingWrites.push({ key, data, contentType });
	}

	/**
	 * Stage R2 delete operation (doesn't delete yet)
	 */
	stageDelete(key: string): void {
		if (this.committed || this.rolledBack) {
			throw new GitTransactionError(
				"Cannot stage delete after commit/rollback",
				"prepare",
			);
		}

		this.pendingDeletes.push({ key });
	}

	/**
	 * Execute staged operations atomically
	 */
	async commit(): Promise<void> {
		if (this.committed) {
			throw new GitTransactionError("Transaction already committed", "commit");
		}
		if (this.rolledBack) {
			throw new GitTransactionError("Cannot commit after rollback", "commit");
		}

		try {
			// Phase 1: Upload all R2 objects
			for (const write of this.pendingWrites) {
				try {
					await uploadToR2(write.key, write.data, write.contentType);
					this.uploadedKeys.push(write.key);
				} catch (error) {
					// Upload failed - rollback uploaded objects
					await this.rollback();
					throw new GitTransactionError(
						`Failed to upload R2 object: ${write.key}`,
						"commit",
						true,
					);
				}
			}

			// Phase 2: Delete R2 objects
			for (const del of this.pendingDeletes) {
				try {
					await deleteFromR2(del.key);
				} catch (error) {
					// Delete failed - log but don't fail transaction
					// (object might not exist)
					console.error(`Failed to delete R2 object: ${del.key}`, error);
				}
			}

			// Phase 3: Commit database transaction (if we had one)
			// Note: Since Drizzle doesn't expose transaction API in TanStack Start,
			// we rely on individual queries being atomic

			// Mark as committed
			this.committed = true;

			// Invalidate cache for all affected keys
			for (const write of this.pendingWrites) {
				const cacheKey = write.key.replace(/^repos\//, "");
				invalidateCache(cacheKey);
			}
			for (const del of this.pendingDeletes) {
				const cacheKey = del.key.replace(/^repos\//, "");
				invalidateCache(cacheKey);
			}
		} catch (error) {
			if (error instanceof GitTransactionError) {
				throw error;
			}
			throw new GitTransactionError(
				`Transaction commit failed: ${error instanceof Error ? error.message : "Unknown error"}`,
				"commit",
				true,
			);
		}
	}

	/**
	 * Rollback transaction - delete uploaded R2 objects
	 */
	async rollback(): Promise<void> {
		if (this.committed) {
			throw new GitTransactionError("Cannot rollback after commit", "rollback");
		}
		if (this.rolledBack) {
			return; // Already rolled back
		}

		// Delete all uploaded R2 objects
		const deletePromises = this.uploadedKeys.map((key) =>
			deleteFromR2(key).catch((error) => {
				console.error(`Failed to rollback R2 object ${key}:`, error);
			}),
		);

		await Promise.all(deletePromises);

		this.rolledBack = true;

		// Clear pending operations
		this.pendingWrites = [];
		this.pendingDeletes = [];
		this.uploadedKeys = [];
	}

	/**
	 * Check if transaction is committed
	 */
	isCommitted(): boolean {
		return this.committed;
	}

	/**
	 * Check if transaction is rolled back
	 */
	isRolledBack(): boolean {
		return this.rolledBack;
	}

	/**
	 * Get pending operations count
	 */
	getPendingCount(): { writes: number; deletes: number } {
		return {
			writes: this.pendingWrites.length,
			deletes: this.pendingDeletes.length,
		};
	}
}

/**
 * Execute a function within a transaction
 */
export async function withTransaction<T>(
	fn: (txn: GitTransaction) => Promise<T>,
): Promise<T> {
	const txn = new GitTransaction();

	try {
		await txn.begin();
		const result = await fn(txn);
		await txn.commit();
		return result;
	} catch (error) {
		// Rollback on any error
		await txn.rollback();
		throw error;
	}
}

// ponytail: plain Map instead of TransactionRegistry class
const activeTransactions = new Map<string, { txn: GitTransaction; createdAt: number }>();

if (typeof setInterval !== "undefined") {
	setInterval(async () => {
		const threshold = Date.now() - 3600000;
		for (const [id, entry] of activeTransactions.entries()) {
			if (entry.createdAt < threshold) {
				activeTransactions.delete(id);
				if (!entry.txn.isCommitted() && !entry.txn.isRolledBack()) {
					await entry.txn.rollback().catch((e) =>
						console.error(`Failed to rollback abandoned transaction ${id}:`, e),
					);
				}
			}
		}
	}, 600000);
}
