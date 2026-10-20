/** @vitest-environment node */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/pglite-db";
import { repositories } from "../app-schema";
import { user } from "../schema";

describe("app timestamps", () => {
	// `createTestDb` pushes the whole schema with drizzle-kit: ~0.8s alone, but
	// several seconds when the workers contend for CPU, which tripped the default
	// 5s timeout. The test itself never waits, so this stays tight.
	it("read back correctly when the database fills them under a non-UTC session", {
		timeout: 20_000,
	}, async () => {
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
