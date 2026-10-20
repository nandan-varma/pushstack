/** @vitest-environment node */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/pglite-db";
import { repositories } from "../app-schema";
import { user } from "../schema";

describe("app timestamps", () => {
	it("read back correctly when the database fills them under a non-UTC session", async () => {
		const db = await createTestDb();
		await db.execute(sql`set timezone = 'America/Los_Angeles'`);
		const now = new Date();
		await db.insert(user).values({
			id: "u1",
			name: "U",
			email: "u@example.test",
			emailVerified: true,
			username: "u1",
			createdAt: now,
			updatedAt: now,
		});
		const [repo] = await db
			.insert(repositories)
			.values({ ownerId: "u1", name: "r" })
			.returning();

		expect(
			Math.abs((repo?.createdAt.getTime() ?? 0) - Date.now()),
		).toBeLessThan(60_000);
	});
});
