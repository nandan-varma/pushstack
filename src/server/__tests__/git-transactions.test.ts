/**
 * Tests for git-transactions.ts — the WAL wired into withRepositoryLock.
 * Same pattern as repo-access.test.ts: real queries against an in-memory
 * embedded Postgres (pglite), seeded with the project's actual schema,
 * rather than hand-mocking db.insert/update/select return values — this
 * module's whole job is running specific SQL correctly, so that's exactly
 * what should be under test.
 */

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", async () => {
	const { PGlite } = await import("@electric-sql/pglite");
	const { drizzle } = await import("drizzle-orm/pglite");
	const { pushSchema } = await import("drizzle-kit/api");
	const schema = await import("../../db/schema");

	const client = new PGlite();
	const db = drizzle(client, { schema });
	const { apply } = await pushSchema(
		schema as unknown as Record<string, unknown>,
		db as unknown as Parameters<typeof pushSchema>[1],
	);
	await apply();

	return { db };
});

vi.mock("../perf-log", () => ({
	logError: vi.fn(),
}));

describe("git-transactions", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		const { db } = await import("../../db");
		const { gitTransactions } = await import("../../db/schema");
		await db.delete(gitTransactions);
	});

	it("records a pending row and returns its id", async () => {
		const { beginGitTransaction } = await import("../git-transactions");
		const { db } = await import("../../db");
		const { gitTransactions } = await import("../../db/schema");

		const id = await beginGitTransaction("owner", "repo");
		expect(id).not.toBeNull();

		const rows = await db.select().from(gitTransactions);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id,
			status: "pending",
			objectKeys: [],
			metadata: { ownerKey: "owner", repoName: "repo" },
		});
		expect(rows[0].completedAt).toBeNull();
	});

	it("marks a transaction committed", async () => {
		const { beginGitTransaction, commitGitTransaction } = await import(
			"../git-transactions"
		);
		const { db } = await import("../../db");
		const { gitTransactions } = await import("../../db/schema");

		const id = await beginGitTransaction("owner", "repo");
		await commitGitTransaction(id as string);

		const rows = await db.select().from(gitTransactions);
		expect(rows[0].status).toBe("committed");
		expect(rows[0].completedAt).not.toBeNull();
	});

	it("marks a transaction rolled back", async () => {
		const { beginGitTransaction, rollbackGitTransaction } = await import(
			"../git-transactions"
		);
		const { db } = await import("../../db");
		const { gitTransactions } = await import("../../db/schema");

		const id = await beginGitTransaction("owner", "repo");
		await rollbackGitTransaction(id as string);

		const rows = await db.select().from(gitTransactions);
		expect(rows[0].status).toBe("rolled_back");
		expect(rows[0].completedAt).not.toBeNull();
	});

	it("findAbandonedGitTransactions finds only old pending rows", async () => {
		const {
			beginGitTransaction,
			commitGitTransaction,
			findAbandonedGitTransactions,
		} = await import("../git-transactions");
		const { db } = await import("../../db");
		const { gitTransactions } = await import("../../db/schema");

		const now = Date.now();

		// Recent pending — not abandoned, still within its writer's lease.
		// beginGitTransaction sets createdAt explicitly from `new Date()`
		// rather than the column's `defaultNow()` (see its own comment), so
		// this is directly comparable against `now` below with no skew.
		await beginGitTransaction("owner", "recent-repo");

		// Old pending — the writer's lease has long since expired; abandoned.
		const oldId = await beginGitTransaction("owner", "stale-repo");
		await db
			.update(gitTransactions)
			.set({ createdAt: new Date(now - 10 * 60_000) })
			.where(eq(gitTransactions.id, oldId as string));

		// Old but committed — not abandoned, it finished.
		const oldCommittedId = await beginGitTransaction("owner", "done-repo");
		await commitGitTransaction(oldCommittedId as string);
		await db
			.update(gitTransactions)
			.set({ createdAt: new Date(now - 10 * 60_000) })
			.where(eq(gitTransactions.id, oldCommittedId as string));

		const abandoned = await findAbandonedGitTransactions(5 * 60_000);
		expect(abandoned).toHaveLength(1);
		expect(abandoned[0].id).toBe(oldId);
	});

	it("returns null and does not throw when the insert fails", async () => {
		const { db } = await import("../../db");
		vi.spyOn(db, "insert").mockImplementation(() => {
			throw new Error("connection refused");
		});

		const { beginGitTransaction } = await import("../git-transactions");
		const id = await beginGitTransaction("owner", "repo");
		expect(id).toBeNull();

		vi.restoreAllMocks();
	});
});
