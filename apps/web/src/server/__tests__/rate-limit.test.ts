/**
 * @vitest-environment node
 *
 * The rate limiter's counters live in the database (src/server/rate-limit.ts)
 * rather than in Better Auth's default per-instance `Map`, so that the window
 * is shared by every serverless instance. These tests run the real storage
 * against pglite — real SQL, real atomic upsert — and then assert the auth
 * config actually uses it, since silently falling back to the Map is exactly
 * the regression this guards.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

const RULE = { window: 60, max: 3 };

beforeAll(async () => {
	process.env.BETTER_AUTH_SECRET ??=
		"test-better-auth-secret-with-32-plus-characters";
});

beforeEach(async () => {
	const { sql } = await import("drizzle-orm");
	const { db } = await import("../../db");
	await db.execute(sql`delete from rate_limits`);
});

describe("rateLimitStorage", () => {
	it("allows exactly `max` requests in a window, then refuses with a retryAfter", async () => {
		const { rateLimitStorage } = await import("../rate-limit");

		for (let attempt = 1; attempt <= RULE.max; attempt++) {
			await expect(
				rateLimitStorage.consume("ip:1.2.3.4:/sign-in/email", RULE),
			).resolves.toEqual({ allowed: true, retryAfter: null });
		}

		const refused = await rateLimitStorage.consume(
			"ip:1.2.3.4:/sign-in/email",
			RULE,
		);
		expect(refused.allowed).toBe(false);
		expect(refused.retryAfter).toBeGreaterThan(0);
		expect(refused.retryAfter).toBeLessThanOrEqual(RULE.window);
	});

	it("counts each key separately", async () => {
		const { rateLimitStorage } = await import("../rate-limit");

		for (let attempt = 1; attempt <= RULE.max; attempt++) {
			await rateLimitStorage.consume("ip:1.1.1.1:/sign-in/email", RULE);
		}

		await expect(
			rateLimitStorage.consume("ip:2.2.2.2:/sign-in/email", RULE),
		).resolves.toEqual({ allowed: true, retryAfter: null });
	});

	it("keeps the counter in a table, so every instance reads the same window", async () => {
		const { sql } = await import("drizzle-orm");
		const { db } = await import("../../db");
		const { rateLimitStorage } = await import("../rate-limit");

		await rateLimitStorage.consume("ip:9.9.9.9:/sign-up/email", RULE);
		await rateLimitStorage.consume("ip:9.9.9.9:/sign-up/email", RULE);

		const result = await db.execute<{ count: number }>(
			sql`select count from rate_limits where key = ${"ip:9.9.9.9:/sign-up/email"}`,
		);
		expect(result.rows[0]?.count).toBe(2);
	});

	it("lets the caller back in once the window has elapsed", async () => {
		const { sql } = await import("drizzle-orm");
		const { db } = await import("../../db");
		const { rateLimitStorage } = await import("../rate-limit");
		const key = "ip:5.5.5.5:/sign-in/email";

		for (let attempt = 1; attempt <= RULE.max; attempt++) {
			await rateLimitStorage.consume(key, RULE);
		}
		expect((await rateLimitStorage.consume(key, RULE)).allowed).toBe(false);

		await db.execute(
			sql`update rate_limits set window_started_at = now() - interval '10 minutes'`,
		);

		await expect(rateLimitStorage.consume(key, RULE)).resolves.toEqual({
			allowed: true,
			retryAfter: null,
		});
	});

	it("is the storage the auth config actually uses", async () => {
		const { auth } = await import("../../lib/auth");
		const { rateLimitStorage } = await import("../rate-limit");

		expect(auth.options.rateLimit?.customStorage).toBe(rateLimitStorage);
		expect(auth.options.rateLimit?.enabled).toBe(true);
	});
});
