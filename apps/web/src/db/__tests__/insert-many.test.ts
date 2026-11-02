// @vitest-environment node
import { count, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { repositories } from "../app-schema";
import { user } from "../schema";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/test-db")).createTestDb(),
}));

const { db } = await import("#/db");
const { insertMany } = await import("../insert-many");

describe("insertMany", () => {
	it("inserts more rows than fit in one statement", async () => {
		await db.insert(user).values({
			id: "u1",
			name: "U",
			email: "u@example.com",
			emailVerified: true,
			username: "u1",
			createdAt: new Date(0),
			updatedAt: new Date(0),
		});
		await insertMany(
			repositories,
			Array.from({ length: 120 }, (_, i) => ({ ownerId: "u1", name: `r${i}` })),
		);
		const [total] = await db.select({ n: count() }).from(repositories);
		expect(total?.n).toBe(120);
	});

	it("does nothing for no rows", async () => {
		await expect(insertMany(repositories, [])).resolves.toBeUndefined();
	});

	it("keeps every row or none when one statement fails", async () => {
		const [before] = await db.select({ n: count() }).from(repositories);
		await expect(
			insertMany(
				repositories,
				Array.from({ length: 30 }, (_, i) => ({
					ownerId: "u1",
					// A duplicate of an existing (owner, name) violates a unique index
					// in the last statement of the batch.
					name: i === 29 ? "r0" : `fresh-${i}`,
				})),
			),
		).rejects.toThrow();
		const [after] = await db.select({ n: count() }).from(repositories);
		expect(after?.n).toBe(before?.n);
	});

	it("skips or updates colliding rows through onConflict", async () => {
		await insertMany(repositories, [
			{ ownerId: "u1", name: "dup", description: "first" },
		]);
		await insertMany(
			repositories,
			[{ ownerId: "u1", name: "dup", description: "second" }],
			{ onConflict: (insert) => insert.onConflictDoNothing() },
		);
		const [kept] = await db
			.select({ description: repositories.description })
			.from(repositories)
			.where(eq(repositories.name, "dup"));
		expect(kept?.description).toBe("first");

		await insertMany(
			repositories,
			[{ ownerId: "u1", name: "dup", description: "third" }],
			{
				onConflict: (insert) =>
					insert.onConflictDoUpdate({
						target: [repositories.ownerId, repositories.name],
						set: { description: "third" },
					}),
			},
		);
		const [updated] = await db
			.select({ description: repositories.description })
			.from(repositories)
			.where(eq(repositories.name, "dup"));
		expect(updated?.description).toBe("third");
	});
});
