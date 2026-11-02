/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/test-db";
import { repositories } from "../app-schema";
import { user } from "../schema";

describe("app timestamps", () => {
	it("read back as epoch milliseconds when the database fills them", async () => {
		const db = await createTestDb();
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
		// No createdAt: the column default (unixepoch() * 1000) fills it.
		const [repo] = await db
			.insert(repositories)
			.values({ ownerId: "u1", name: "r" })
			.returning();

		expect(
			Math.abs((repo?.createdAt.getTime() ?? 0) - Date.now()),
		).toBeLessThan(60_000);
	});
});
