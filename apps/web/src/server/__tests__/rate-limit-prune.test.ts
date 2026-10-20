/**
 * @vitest-environment node
 *
 * The rate_limits table holds Better Auth's short windows and the request
 * limits' long ones; pruning from one family must not delete the other's
 * live buckets.
 */
import { expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

it("a Better Auth consume + prune leaves live gh: buckets alone", async () => {
	const { sql } = await import("drizzle-orm");
	const { db } = await import("../../db");
	const { rateLimitStorage } = await import("../rate-limit");
	await db.execute(sql`
		insert into rate_limits (key, count, window_started_at) values
		('gh:core:ip:1.1.1.1', 5, now() - interval '120 seconds'),
		('gh:core:ip:2.2.2.2', 5, now() - interval '2 hours'),
		('1.1.1.1|/sign-in/email', 5, now() - interval '120 seconds')`);
	await rateLimitStorage.consume("fresh", { window: 60, max: 3 });
	const keys = (
		await db.execute<{ key: string }>(sql`select key from rate_limits`)
	).rows.map((row) => row.key);
	expect(keys).toContain("gh:core:ip:1.1.1.1");
	expect(keys).not.toContain("gh:core:ip:2.2.2.2");
	expect(keys).not.toContain("1.1.1.1|/sign-in/email");
	expect(keys).toContain("fresh");
});
